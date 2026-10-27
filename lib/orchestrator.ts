/**
 * Neiro orchestrator: a poll-driven state machine.
 *
 * Every tick (browser auto-tick, VPS cron, or an API route) calls
 * advanceMission(). Ticks may overlap, so:
 *  - every state change is a guarded update on the state this tick observed
 *    (compare-and-set); losing the guard means another tick already did the
 *    work, and this tick stops touching that entity;
 *  - a stage first *claims* the entity with a `claim:<uuid>` token, then
 *    starts its Hermes run, then swaps the token for the real run id;
 *  - a run is only read on a later tick, and a transition happens only once
 *    Hermes reports the run terminal.
 *
 * Mission phases: planning → spec → executing → summarizing → done.
 * Task stages:    Queued → Coding → QA check → Final review → Done
 *                 (failed gates go back to Queued, or to "Needs you").
 */
import {
  createHermesSession,
  getHermesRun,
  startHermesRun,
  type HermesRunStatus,
  type HermesStartRunInput,
  type HermesStartRunResult,
} from "@/lib/hermes";
import {
  extractGateVerdict,
  extractPlanFromOrchestratorOutput,
  truncateMiddle,
} from "@/lib/orchestrator-parsers";
import {
  createSupabaseStore,
  type MissionGuard,
  type OrchestratorStore,
  type TaskGuard,
} from "@/lib/orchestrator-store";
import type {
  Agent,
  AgentStage,
  MissionDetailDTO,
  MissionPhase,
  MissionTask,
  TaskStage,
} from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Dependencies                                                        */
/* ------------------------------------------------------------------ */

export interface HermesClient {
  startRun(agent: Agent, input: HermesStartRunInput): Promise<HermesStartRunResult>;
  getRun(agent: Agent, runId: string): Promise<HermesRunStatus>;
  createSession(agent: Agent, title: string): Promise<string>;
}

export type OrchestratorDeps = {
  store: OrchestratorStore;
  hermes: HermesClient;
  now: () => Date;
  newId: () => string;
};

const realHermes: HermesClient = {
  startRun: startHermesRun,
  getRun: getHermesRun,
  createSession: createHermesSession,
};

function resolveDeps(deps?: Partial<OrchestratorDeps>): OrchestratorDeps {
  return {
    store: deps?.store ?? createSupabaseStore(),
    hermes: deps?.hermes ?? realHermes,
    now: deps?.now ?? (() => new Date()),
    newId: deps?.newId ?? (() => crypto.randomUUID()),
  };
}

export type AdvanceActiveMissionsResult = {
  advancedCount: number;
  errors: string[];
};

/* ------------------------------------------------------------------ */
/* Constants & small helpers                                           */
/* ------------------------------------------------------------------ */

const CLAIM_PREFIX = "claim:";
/** A claim older than this is assumed orphaned (crash between claim and start). */
const STALE_CLAIM_MS = 5 * 60 * 1000;
const MAX_ERROR_CHARS = 1000;
const MAX_PROMPT_CONTEXT_CHARS = 12_000;

const SUCCESS_STATUSES = new Set(["completed", "succeeded", "success"]);
const FAILURE_STATUSES = new Set([
  "failed",
  "error",
  "cancelled",
  "canceled",
  "expired",
  "expired_404",
]);

type RunOutcome = "pending" | "success" | "failure";

function classifyRun(status: string): RunOutcome {
  const s = status.toLowerCase();
  if (SUCCESS_STATUSES.has(s)) return "success";
  if (FAILURE_STATUSES.has(s)) return "failure";
  return "pending";
}

const isClaim = (runId: string | null): runId is string =>
  runId !== null && runId.startsWith(CLAIM_PREFIX);

function isStale(startedAt: string | null, now: Date): boolean {
  if (!startedAt) return true;
  const t = new Date(startedAt).getTime();
  return Number.isNaN(t) || now.getTime() - t > STALE_CLAIM_MS;
}

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/** Agent stage that runs each active task stage. */
const TASK_STAGE_AGENT: Partial<Record<TaskStage, AgentStage>> = {
  Coding: "workers",
  "QA check": "qa",
  "Final review": "reviewer",
};

const TASK_STAGE_KEY: Partial<Record<TaskStage, string>> = {
  Coding: "code",
  "QA check": "qa",
  "Final review": "review",
};

/** Per-pass context: problems worth surfacing on the mission as last_error. */
type PassContext = { problems: string[] };

/* ------------------------------------------------------------------ */
/* Agent selection                                                     */
/* ------------------------------------------------------------------ */

export async function pickStageAgent(
  stage: AgentStage,
  specialty?: string,
  deps?: Partial<OrchestratorDeps>,
): Promise<Agent | null> {
  const { store } = resolveDeps(deps);
  const agents = await store.listEnabledAgents(stage);
  if (agents.length === 0) return null;

  if (specialty) {
    const exact = agents.find((a) => a.specialty.toLowerCase() === specialty.toLowerCase());
    if (exact) return exact;
  }

  const fullstack = agents.find((a) => a.specialty.toLowerCase().includes("fullstack"));
  return fullstack ?? agents[0];
}

/** Agent for a task stage; coding falls back to the orchestrator like before. */
async function pickTaskAgent(
  stage: TaskStage,
  task: MissionTask,
  d: OrchestratorDeps,
): Promise<Agent | null> {
  const agentStage = TASK_STAGE_AGENT[stage];
  if (!agentStage) return null;
  const agent = await pickStageAgent(agentStage, stage === "Coding" ? task.agentName : undefined, d);
  if (agent || stage !== "Coding") return agent;
  return pickStageAgent("orchestrator", undefined, d);
}

/** The agent that owns a run (needed to reach its Hermes server). */
async function findRunAgent(
  runAgentId: string | null,
  stages: AgentStage[],
  d: OrchestratorDeps,
): Promise<Agent | null> {
  for (const stage of stages) {
    const agents = await d.store.listEnabledAgents(stage);
    const match = runAgentId ? agents.find((a) => a.id === runAgentId) : undefined;
    if (match) return match;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export async function getMissionDetail(
  missionId: string,
  deps?: Partial<OrchestratorDeps>,
): Promise<MissionDetailDTO> {
  return resolveDeps(deps).store.getMissionDetail(missionId);
}

/**
 * Advance one mission by at most one step per entity. Safe to call
 * concurrently: overlapping calls never duplicate a run, an artifact or a
 * retry. Missions that are not `running` (awaiting approval, completed,
 * cancelled) are left untouched.
 */
export async function advanceMission(
  missionId: string,
  deps?: Partial<OrchestratorDeps>,
): Promise<MissionDetailDTO> {
  const d = resolveDeps(deps);
  const detail = await d.store.getMissionDetail(missionId);

  if (detail.status !== "running") {
    return detail;
  }

  const ctx: PassContext = { problems: [] };

  switch (detail.phase) {
    case "planning":
    case "spec":
      await stepMissionRun(detail, d, ctx);
      break;
    case "executing":
      await stepTasks(detail, d, ctx);
      break;
    case "summarizing":
      await stepSummarize(detail, d);
      break;
    case "done":
      break;
  }

  if (ctx.problems.length > 0) {
    await d.store.setMissionError(missionId, ctx.problems.join("; ").slice(0, MAX_ERROR_CHARS));
  } else if (detail.lastError) {
    await d.store.setMissionError(missionId, null);
  }

  return d.store.getMissionDetail(missionId);
}

export async function advanceActiveMissions(
  deps?: Partial<OrchestratorDeps>,
): Promise<AdvanceActiveMissionsResult> {
  const d = resolveDeps(deps);
  let ids: string[];
  try {
    ids = await d.store.listActiveMissionIds();
  } catch (err: unknown) {
    return { advancedCount: 0, errors: [errorMessage(err)] };
  }

  let advancedCount = 0;
  const errors: string[] = [];

  for (const id of ids) {
    try {
      await advanceMission(id, d);
      advancedCount++;
    } catch (err: unknown) {
      errors.push(errorMessage(err));
      await reportAdvanceError(id, err, undefined, d);
    }
  }

  return { advancedCount, errors };
}

/**
 * Log an orchestration failure and store it on the mission so the UI and
 * operators can see it. Never throws: a failing error path must not break the
 * caller's response.
 */
export async function reportAdvanceError(
  missionId: string,
  err: unknown,
  taskId?: string,
  deps?: Partial<OrchestratorDeps>,
): Promise<void> {
  const message = errorMessage(err);
  console.error("[orchestrator] advance failed", { missionId, taskId, error: message });
  try {
    await resolveDeps(deps).store.setMissionError(missionId, message.slice(0, MAX_ERROR_CHARS));
  } catch (storeErr: unknown) {
    console.error("[orchestrator] could not record mission error", {
      missionId,
      error: errorMessage(storeErr),
    });
  }
}

/* ------------------------------------------------------------------ */
/* Mission-level runs: planning and spec                               */
/* ------------------------------------------------------------------ */

const MISSION_PHASE_AGENT: Record<"planning" | "spec", AgentStage> = {
  planning: "orchestrator",
  spec: "spec",
};

function planPrompt(m: MissionDetailDTO): string {
  return `Break down the following mission into sequential/parallel execution tasks in JSON format with fields: tasks: [{ taskKey: "T1", title: string, description: string, specialty: string, dependsOn: string[] }].\n\nMission Objective: ${m.prompt}`;
}

function specPrompt(m: MissionDetailDTO): string {
  const tasks = m.tasks.map((t) => ({ taskKey: t.taskKey, title: t.title, description: t.result }));
  return `Write a Product Requirements Document (PRD) for this mission:\n\nMission Objective: ${m.prompt}\n\nTasks:\n${JSON.stringify(tasks, null, 2)}`;
}

async function stepMissionRun(m: MissionDetailDTO, d: OrchestratorDeps, ctx: PassContext) {
  const phase = m.phase as "planning" | "spec";
  const guard: MissionGuard = { phase, runId: m.runId, status: "running" };
  const clearRun = { runId: null, runAgentId: null, runStartedAt: null };

  // 1. No run yet: claim, start, record.
  if (m.runId === null) {
    const agent = await pickStageAgent(MISSION_PHASE_AGENT[phase], undefined, d);
    if (!agent) {
      if (phase === "spec") {
        await enterExecuting(m, guard, d); // spec writer is optional
      } else {
        ctx.problems.push("No enabled orchestrator agent to plan this mission");
      }
      return;
    }

    const token = CLAIM_PREFIX + d.newId();
    const claimed = await d.store.updateMissionIf(m.id, guard, {
      runId: token,
      runAgentId: agent.id,
      runStartedAt: d.now().toISOString(),
    });
    if (!claimed) return;

    const claimGuard: MissionGuard = { phase, runId: token };
    let started: HermesStartRunResult;
    try {
      started = await d.hermes.startRun(agent, {
        prompt: phase === "planning" ? planPrompt(m) : specPrompt(m),
        // The claim token makes each attempt distinct (a failed run is not
        // replayed) while a retried start of the same claim stays deduped.
        idempotencyKey: `${phase}-${m.id}-${token.slice(CLAIM_PREFIX.length)}`,
      });
    } catch (err: unknown) {
      await d.store.updateMissionIf(m.id, claimGuard, clearRun);
      ctx.problems.push(`Could not start ${phase} run: ${errorMessage(err)}`);
      return;
    }

    if (started.kind === "deferred") {
      await d.store.updateMissionIf(m.id, claimGuard, clearRun);
      return;
    }

    await d.store.updateMissionIf(m.id, claimGuard, { runId: started.runId });
    return; // read the run on a later tick
  }

  // 2. Orphaned claim: release it so the next tick can start again.
  if (isClaim(m.runId)) {
    if (isStale(m.runStartedAt, d.now())) {
      await d.store.updateMissionIf(m.id, guard, clearRun);
    }
    return;
  }

  // 3. Poll the run; act only once it is terminal.
  const agent = await findRunAgent(m.runAgentId, [MISSION_PHASE_AGENT[phase]], d);
  if (!agent) {
    ctx.problems.push(`Agent ${m.runAgentId ?? "(unknown)"} for the ${phase} run is no longer enabled`);
    await d.store.updateMissionIf(m.id, guard, clearRun);
    return;
  }

  const run = await d.hermes.getRun(agent, m.runId);
  const outcome = classifyRun(run.status);
  if (outcome === "pending") return;

  const output = (run.output ?? "").trim();
  if (outcome === "failure" || !output) {
    ctx.problems.push(
      outcome === "failure"
        ? `${phase} run ${run.status}${run.error ? `: ${run.error}` : ""}`
        : `${phase} run completed with empty output`,
    );
    await d.store.updateMissionIf(m.id, guard, clearRun);
    return;
  }

  if (phase === "planning") {
    const plan = extractPlanFromOrchestratorOutput(output, m.prompt);
    const keys = new Set(plan.tasks.map((t) => t.taskKey));

    // Concurrent ticks may both get here: both inserts are conflict-ignoring.
    await d.store.insertTasks(
      plan.tasks.map((t) => ({
        id: d.newId(),
        missionId: m.id,
        taskKey: t.taskKey,
        title: t.title,
        agentName: t.specialty,
        model: agent.model,
        depends: t.dependsOn.filter((dep) => keys.has(dep)),
        result: t.description,
      })),
    );
    await d.store.insertArtifactOnce({
      missionId: m.id,
      title: "Task Breakdown Plan",
      kind: "task_plan",
      content: output,
      dedupeKey: `plan:${m.id}`,
    });
    await d.store.updateMissionIf(m.id, guard, { phase: "spec", ...clearRun });
    return;
  }

  await d.store.insertArtifactOnce({
    missionId: m.id,
    title: "Product Requirements Document (PRD)",
    kind: "prd",
    content: output,
    dedupeKey: `prd:${m.id}`,
  });
  await enterExecuting(m, guard, d);
}

/** spec → executing; pauses for operator approval when requested. */
async function enterExecuting(m: MissionDetailDTO, guard: MissionGuard, d: OrchestratorDeps) {
  await d.store.updateMissionIf(m.id, guard, {
    phase: "executing",
    runId: null,
    runAgentId: null,
    runStartedAt: null,
    ...(m.pauseAfterPlanning ? { status: "awaiting_plan_approval" as const } : {}),
  });
}

/* ------------------------------------------------------------------ */
/* Summary                                                             */
/* ------------------------------------------------------------------ */

async function stepSummarize(m: MissionDetailDTO, d: OrchestratorDeps) {
  await d.store.insertArtifactOnce({
    missionId: m.id,
    title: "Mission Summary",
    kind: "mission_summary",
    content: `Mission completed successfully. All ${m.tasks.length} tasks passed QA and final review.`,
    dedupeKey: `summary:${m.id}`,
  });
  await d.store.updateMissionIf(
    m.id,
    { phase: "summarizing", runId: null, status: "running" },
    { phase: "done" satisfies MissionPhase, status: "completed" },
  );
}

/* ------------------------------------------------------------------ */
/* Task-level runs                                                     */
/* ------------------------------------------------------------------ */

async function stepTasks(m: MissionDetailDTO, d: OrchestratorDeps, ctx: PassContext) {
  if (m.tasks.length > 0 && m.tasks.every((t) => t.stage === "Done")) {
    await d.store.updateMissionIf(
      m.id,
      { phase: "executing", runId: null, status: "running" },
      { phase: "summarizing" },
    );
    return;
  }

  const stageByKey = new Map<string, TaskStage>();
  for (const t of m.tasks) {
    if (t.taskKey) stageByKey.set(t.taskKey, t.stage);
  }

  for (const task of m.tasks) {
    if (task.stage === "Done" || task.stage === "Needs you") continue;
    try {
      await stepTask(m, task, stageByKey, d, ctx);
    } catch (err: unknown) {
      ctx.problems.push(`Task ${task.taskKey ?? task.id}: ${errorMessage(err)}`);
      console.error("[orchestrator] task step failed", {
        missionId: m.id,
        taskId: task.id,
        error: errorMessage(err),
      });
    }
  }
}

async function stepTask(
  m: MissionDetailDTO,
  task: MissionTask,
  stageByKey: Map<string, TaskStage>,
  d: OrchestratorDeps,
  ctx: PassContext,
) {
  const guard: TaskGuard = { stage: task.stage, runId: task.runId };
  const clearRun = { runId: null, runAgentId: null, runStartedAt: null };

  // Orphaned claim: release; the stage is kept, so the next tick restarts it.
  if (isClaim(task.runId)) {
    if (isStale(task.runStartedAt, d.now())) {
      await d.store.updateTaskIf(task.id, guard, clearRun);
    }
    return;
  }

  // Queued: wait for dependencies, then claim a worker slot.
  if (task.stage === "Queued") {
    if (task.depends.length > 0 && task.taskKey === null) {
      ctx.problems.push(
        `Legacy task "${task.title}" has dependencies but no task_key; resolve it manually`,
      );
      return;
    }
    const depsDone = task.depends.every((key) => stageByKey.get(key) === "Done");
    if (!depsDone) return;

    const token = CLAIM_PREFIX + d.newId();
    if (!(await d.store.claimTask(task.id, token))) return; // capacity or lost race
    await startTaskRun(m, { ...task, stage: "Coding", runId: token }, d, ctx);
    return;
  }

  // Active stage without a run: start that stage's run (or skip a missing gate).
  if (task.runId === null) {
    const agent = await pickTaskAgent(task.stage, task, d);
    if (!agent) {
      if (task.stage === "QA check") {
        await d.store.updateTaskIf(task.id, guard, { stage: "Final review" });
      } else if (task.stage === "Final review") {
        await d.store.updateTaskIf(task.id, guard, { stage: "Done" });
      } else {
        ctx.problems.push(`No enabled worker agent for task "${task.title}"`);
      }
      return;
    }

    const token = CLAIM_PREFIX + d.newId();
    const claimed = await d.store.updateTaskIf(task.id, guard, {
      runId: token,
      runStartedAt: d.now().toISOString(),
    });
    if (!claimed) return;
    await startTaskRun(m, { ...task, runId: token }, d, ctx, agent);
    return;
  }

  // Poll the run; act only once it is terminal.
  const agentStage = TASK_STAGE_AGENT[task.stage];
  const ownerStages: AgentStage[] = agentStage
    ? task.stage === "Coding"
      ? [agentStage, "orchestrator"]
      : [agentStage]
    : [];
  const agent = await findRunAgent(task.runAgentId, ownerStages, d);
  if (!agent) {
    ctx.problems.push(`Agent ${task.runAgentId ?? "(unknown)"} for task "${task.title}" is no longer enabled`);
    await d.store.updateTaskIf(task.id, guard, clearRun);
    return;
  }

  const run = await d.hermes.getRun(agent, task.runId);
  const outcome = classifyRun(run.status);
  if (outcome === "pending") return;

  const output = (run.output ?? "").trim();
  const tokens = task.tokens + (run.tokens ?? 0);

  if (outcome === "failure" || !output) {
    await failAttempt(m, task, guard, tokens, d);
    return;
  }

  if (task.stage === "Coding") {
    await d.store.updateTaskIf(task.id, guard, {
      stage: "QA check",
      resultOutput: output,
      tokens,
      ...clearRun,
    });
    return;
  }

  const isQa = task.stage === "QA check";
  await d.store.insertArtifactOnce({
    missionId: m.id,
    taskId: task.id,
    title: `${isQa ? "QA Report" : "Review Report"}: ${task.title}`,
    kind: isQa ? "qa_report" : "review_report",
    content: output,
    dedupeKey: `${isQa ? "qa" : "review"}:${task.id}:${task.retries}`,
  });

  const verdict = isQa
    ? extractGateVerdict(output, "PASS", "FAIL")
    : extractGateVerdict(output, "APPROVED", "CHANGES_REQUESTED");
  const passed = verdict.verdict === (isQa ? "PASS" : "APPROVED");

  if (!passed) {
    await failAttempt(m, task, guard, tokens, d);
    return;
  }

  await d.store.updateTaskIf(task.id, guard, {
    stage: isQa ? "Final review" : "Done",
    tokens,
    ...clearRun,
  });
}

/** Failed gate or run: retry while under the mission's cap, else escalate. */
async function failAttempt(
  m: MissionDetailDTO,
  task: MissionTask,
  guard: TaskGuard,
  tokens: number,
  d: OrchestratorDeps,
) {
  const clearRun = { runId: null, runAgentId: null, runStartedAt: null };
  if (task.retries < m.maxRetries) {
    await d.store.updateTaskIf(task.id, guard, {
      stage: "Queued",
      retries: task.retries + 1,
      tokens,
      ...clearRun,
    });
  } else {
    await d.store.updateTaskIf(task.id, guard, { stage: "Needs you", tokens, ...clearRun });
  }
}

function taskPrompt(m: MissionDetailDTO, task: MissionTask): string {
  const deliverable = truncateMiddle(task.resultOutput ?? "", MAX_PROMPT_CONTEXT_CHARS);
  switch (task.stage) {
    case "Coding":
      return [
        "Execute the following task:",
        `Title: ${task.title}`,
        `Requirements: ${task.result || task.title}`,
        m.workspacePath ? `Workspace: ${m.workspacePath}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    case "QA check":
      return `Verify the deliverables for task "${task.title}".\n\nRequirements: ${task.result || task.title}\n\nDeliverable:\n${deliverable}\n\nEnd your response with VERDICT: PASS or VERDICT: FAIL.`;
    default:
      return `Review security, accessibility, and quality for task "${task.title}".\n\nDeliverable:\n${deliverable}\n\nEnd with VERDICT: APPROVED or VERDICT: CHANGES_REQUESTED.`;
  }
}

/**
 * Start the Hermes run for a task that this tick has already claimed
 * (`task.runId` is our claim token), then swap the token for the run id.
 */
async function startTaskRun(
  m: MissionDetailDTO,
  task: MissionTask,
  d: OrchestratorDeps,
  ctx: PassContext,
  knownAgent?: Agent,
) {
  const claimGuard: TaskGuard = { stage: task.stage, runId: task.runId };
  const release = () =>
    d.store.updateTaskIf(task.id, claimGuard, { runId: null, runStartedAt: null });

  const agent = knownAgent ?? (await pickTaskAgent(task.stage, task, d));
  if (!agent) {
    await release();
    ctx.problems.push(`No enabled agent for ${task.stage} on task "${task.title}"`);
    return;
  }

  let sessionId: string | undefined;
  if (task.stage === "Coding") {
    try {
      sessionId = await d.hermes.createSession(agent, `Task: ${task.title}`);
    } catch {
      sessionId = undefined; // runs work without a session
    }
  }

  let started: HermesStartRunResult;
  try {
    started = await d.hermes.startRun(agent, {
      prompt: taskPrompt(m, task),
      sessionId,
      idempotencyKey: `${TASK_STAGE_KEY[task.stage]}-${task.id}-${task.retries}`,
    });
  } catch (err: unknown) {
    await release();
    throw err;
  }

  if (started.kind === "deferred") {
    await release();
    return;
  }

  await d.store.updateTaskIf(task.id, claimGuard, {
    runId: started.runId,
    runAgentId: agent.id,
    agentId: agent.id,
    agentName: agent.name,
    model: agent.model,
  });
}
