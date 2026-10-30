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
  type HermesRunStatus,
  type HermesStartRunResult,
} from "@/lib/hermes";
import {
  createSession as createAgentSession,
  getRun as getAgentRun,
  startRun as startAgentRun,
  type RunStartInput,
} from "@/lib/agent-runtime";
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
import {
  createLayaRouter,
  isRouterEnabled,
  routeOutcome,
  type TaskRouter,
} from "@/lib/task-router";
import type {
  Agent,
  AgentStage,
  MissionArtifact,
  MissionDetailDTO,
  MissionPhase,
  MissionTask,
  TaskStage,
} from "@/lib/types";
import { budgetBlock } from "@/lib/budget";
import { nextPrdVersion, prdKey, prdNotesFor, prdTitle, prdVersions } from "@/lib/prd";
import { safeNotify, shortHash } from "@/lib/notifications";
import type { Notifier } from "@/lib/notifications";
import { supabaseNotifier } from "@/lib/notifications-store";
import { buildReviewPrompt, parseReviewOutput, reviewPassed, type ParsedReview } from "@/lib/code-review";
import { createCodeReviewStore, type CodeReviewStore } from "@/lib/code-reviews-store";
import {
  ensureMissionPr as realEnsureMissionPr,
  fetchPr as realFetchPr,
  prSlug,
  type MissionPr,
  type PrData,
} from "@/lib/github-pr";
import { hasPrProblem, prProblem } from "@/lib/needs-you";
import { missionNeedsPr } from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Dependencies                                                        */
/* ------------------------------------------------------------------ */

export interface HermesClient {
  startRun(agent: Agent, input: RunStartInput): Promise<HermesStartRunResult>;
  getRun(agent: Agent, runId: string): Promise<HermesRunStatus>;
  createSession(agent: Agent, title: string): Promise<string>;
}

export type OrchestratorDeps = {
  store: OrchestratorStore;
  hermes: HermesClient;
  now: () => Date;
  newId: () => string;
  /**
   * Task router (Laya). `null` = off: Queued tasks are claimed directly, as
   * before the router existed. Omit to follow NEIRO_ROUTER /
   * NEIRO_LAYA_MODEL_PATH.
   */
  router?: TaskRouter | null;
  /**
   * Announces mission events (feed + webhook). Omit for the real notifier;
   * when a custom store is passed (tests) it defaults to none.
   */
  notify?: Notifier;
  /**
   * code_reviews rows for Build / Fix mission reviews, shown on /reviews.
   * `null` = not recorded. Omit for the Supabase store; when a custom store
   * is passed (tests) it defaults to none.
   */
  reviews?: CodeReviewStore | null;
  /** git + gh steps that give a Build / Fix mission its PR. */
  github?: MissionGitHub;
};

export type MissionGitHub = {
  ensureMissionPr: typeof realEnsureMissionPr;
  fetchPr: typeof realFetchPr;
};

// Each agent runs on Hermes or a local CLI; lib/agent-runtime.ts picks.
const realHermes: HermesClient = {
  startRun: startAgentRun,
  getRun: getAgentRun,
  createSession: createAgentSession,
};

function resolveDeps(deps?: Partial<OrchestratorDeps>): OrchestratorDeps {
  return {
    store: deps?.store ?? createSupabaseStore(),
    hermes: deps?.hermes ?? realHermes,
    now: deps?.now ?? (() => new Date()),
    newId: deps?.newId ?? (() => crypto.randomUUID()),
    router:
      deps?.router !== undefined ? deps.router : isRouterEnabled() ? createLayaRouter() : null,
    notify: deps?.notify ?? (deps?.store ? undefined : supabaseNotifier),
    reviews: deps?.reviews !== undefined ? deps.reviews : deps?.store ? null : createCodeReviewStore(),
    github: deps?.github ?? { ensureMissionPr: realEnsureMissionPr, fetchPr: realFetchPr },
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

export type RunOutcome = "pending" | "success" | "failure";

export function classifyRun(status: string): RunOutcome {
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
  // A routed task is coded by the agent the router (or a human) chose, any
  // stage, while that agent is still enabled.
  if (stage === "Coding" && task.routingStatus && task.agentId) {
    const routed = await findAnyEnabledAgent(task.agentId, d);
    if (routed) return routed;
  }
  const agentStage = TASK_STAGE_AGENT[stage];
  if (!agentStage) return null;
  const agent = await pickStageAgent(agentStage, stage === "Coding" ? task.agentName : undefined, d);
  if (agent || stage !== "Coding") return agent;
  return pickStageAgent("orchestrator", undefined, d);
}

async function findAnyEnabledAgent(
  agentId: string | null,
  d: OrchestratorDeps,
): Promise<Agent | null> {
  if (!agentId) return null;
  const agents = await d.store.listAllEnabledAgents();
  return agents.find((a) => a.id === agentId) ?? null;
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
  } else if (
    detail.lastError &&
    // A quiet tick must not erase the reason a task is still parked.
    !(
      (/token budget/i.test(detail.lastError) || hasPrProblem(detail.lastError)) &&
      detail.tasks.some((t) => t.stage === "Needs you")
    )
  ) {
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
  const d = resolveDeps(deps);
  try {
    await d.store.setMissionError(missionId, message.slice(0, MAX_ERROR_CHARS));
    await safeNotify(d.notify, {
      kind: "mission_error",
      missionId,
      taskId: taskId ?? null,
      title: "Mission is stuck",
      body: message.slice(0, 500),
      dedupeKey: `error:${missionId}:${shortHash(message)}`,
    });
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
  const base = `Write a Product Requirements Document (PRD) for this mission:\n\nMission Objective: ${m.prompt}\n\nTasks:\n${JSON.stringify(tasks, null, 2)}`;
  const version = nextPrdVersion(m.artifacts, m.id);
  if (version <= 1) return base;
  const previous = prdVersions(m.artifacts, m.id).find((v) => v.version === version - 1);
  const notes = prdNotesFor(m.artifacts, m.id, version - 1);
  return [
    base,
    "",
    `The operator reviewed PRD v${version - 1} and asked for changes.`,
    `Write the complete PRD v${version}: keep what is fine, fix every note below.`,
    "",
    `Operator notes:\n${notes?.content ?? "(none)"}`,
    "",
    `PRD v${version - 1}:\n${truncateMiddle(previous?.artifact.content ?? "", MAX_PROMPT_CONTEXT_CHARS)}`,
  ].join("\n");
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
        cwd: m.agentWorkspacePath || m.workspacePath || undefined,
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

  // A revision writes the next version; v1 and earlier versions stay.
  const version = nextPrdVersion(m.artifacts, m.id);
  await d.store.insertArtifactOnce({
    missionId: m.id,
    title: prdTitle(version),
    kind: "prd",
    content: output,
    dedupeKey: prdKey(m.id, version),
  });
  await enterExecuting(m, guard, d);
}

/** spec → executing; pauses for operator approval when requested. */
async function enterExecuting(m: MissionDetailDTO, guard: MissionGuard, d: OrchestratorDeps) {
  const moved = await d.store.updateMissionIf(m.id, guard, {
    phase: "executing",
    runId: null,
    runAgentId: null,
    runStartedAt: null,
    ...(m.pauseAfterPlanning ? { status: "awaiting_plan_approval" as const } : {}),
  });
  if (moved && m.pauseAfterPlanning) {
    await safeNotify(d.notify, {
      kind: "plan_ready",
      missionId: m.id,
      title: "Plan ready for your approval",
      body: m.title,
      dedupeKey: `plan:${m.id}`,
    });
  }
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
  const done = await d.store.updateMissionIf(
    m.id,
    { phase: "summarizing", runId: null, status: "running" },
    { phase: "done" satisfies MissionPhase, status: "completed" },
  );
  if (done) {
    await safeNotify(d.notify, {
      kind: "mission_completed",
      missionId: m.id,
      title: "Mission completed",
      body: `${m.title}: all ${m.tasks.length} tasks done.`,
      dedupeKey: `done:${m.id}`,
    });
  }
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
    if (task.stage === "Done" || task.stage === "Needs you" || task.stage === "Awaiting routing") {
      continue;
    }
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

  // Queued / Routed: wait for dependencies, route if needed, then claim a worker slot.
  if (task.stage === "Queued" || task.stage === "Routed") {
    if (task.depends.length > 0 && task.taskKey === null) {
      ctx.problems.push(
        `Legacy task "${task.title}" has dependencies but no task_key; resolve it manually`,
      );
      return;
    }
    const depsDone = task.depends.every((key) => stageByKey.get(key) === "Done");
    if (!depsDone) return;

    // With the router on, an unrouted Queued task is routed first and claimed
    // on a later tick. A Routed task is claimable even if the router was
    // switched off since, so nothing gets stuck.
    if (task.stage === "Queued" && d.router && !task.routingStatus) {
      await routeTask(task, d.router, d, ctx);
      return;
    }
    if (task.routingStatus === "routing") {
      await releaseStaleRouting(task, d);
      return;
    }

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
    const claimedTask = { ...task, runId: token };
    // Build / Fix: the task's work goes into the mission PR before it is reviewed.
    let review: MissionReviewRun | null = null;
    if (task.stage === "Final review" && missionNeedsPr(m.mode)) {
      review = await openMissionPr(m, claimedTask, d, ctx);
      if (!review) return;
    }
    await startTaskRun(m, claimedTask, d, ctx, agent, review);
    return;
  }

  // Poll the run; act only once it is terminal. A routed coding run may be
  // owned by an agent of any stage, so Coding looks across all enabled agents.
  const agentStage = TASK_STAGE_AGENT[task.stage];
  const agent =
    task.stage === "Coding"
      ? await findAnyEnabledAgent(task.runAgentId, d)
      : await findRunAgent(task.runAgentId, agentStage ? [agentStage] : [], d);
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

  // Credit this run's tokens to the agent that ran it. Before the task
  // moves on, so a failed write is retried by the next tick.
  if ((run.tokens ?? 0) > 0) {
    await d.store.recordTokenUsage({
      runId: task.runId,
      missionId: m.id,
      taskId: task.id,
      agentId: agent.id,
      agentName: agent.name,
      stage: task.stage,
      tokens: run.tokens ?? 0,
      model: agent.model || null,
      runtime: agent.runtime ?? "hermes",
    });
  }

  if (outcome === "failure" || !output) {
    if (task.stage === "Final review") {
      await finishMissionReview(task, d, {
        status: "failed",
        error: run.error || (output ? `The review run ended with status "${run.status}".` : "The reviewer returned an empty answer."),
        rawOutput: output || null,
        tokens: run.tokens ?? 0,
      });
    }
    await failAttempt(m, task, guard, tokens, d);
    return;
  }

  if (task.stage === "Coding") {
    // Every attempt's output is kept, so the task chat can show old attempts.
    await d.store.insertArtifactOnce({
      missionId: m.id,
      taskId: task.id,
      title: `Coding output: ${task.title}`,
      kind: "coding_output",
      content: output,
      dedupeKey: `code:${task.id}:${task.retries}`,
    });
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
  let passed = verdict.verdict === (isQa ? "PASS" : "APPROVED");

  // Final review: a JSON answer (the PR review prompt) decides, and its
  // findings go to the task's row on /reviews.
  if (!isQa && missionNeedsPr(m.mode)) {
    const parsed = parseReviewOutput(output);
    if (parsed.ok) passed = reviewPassed(parsed.verdict, parsed.findings);
    await finishMissionReview(task, d, reviewPatchFrom(parsed, output, run.tokens ?? 0));
  }

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
    // A routed task keeps its route: back to Routed, never re-asking Laya.
    await d.store.updateTaskIf(task.id, guard, {
      stage: task.routingStatus ? "Routed" : "Queued",
      retries: task.retries + 1,
      tokens,
      ...clearRun,
    });
  } else {
    const escalated = await d.store.updateTaskIf(task.id, guard, { stage: "Needs you", tokens, ...clearRun });
    if (escalated) {
      await safeNotify(d.notify, {
        kind: "task_needs_you",
        missionId: m.id,
        taskId: task.id,
        title: "A task needs you",
        body: `"${task.title}" failed ${task.retries + 1} time(s) in ${task.stage}.`,
        dedupeKey: `needs:${task.id}:${task.retries}`,
      });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Task routing (Laya)                                                 */
/* ------------------------------------------------------------------ */

export const ROUTING_MIGRATION_HINT =
  "Routing columns missing: run the Supabase migrations (bun run db:push) before enabling NEIRO_LAYA_MODEL_PATH";

/** Postgres 42703 / PostgREST PGRST204: a column the code writes is not in the table. */
function isMissingColumnError(err: unknown): boolean {
  const msg = errorMessage(err);
  return /column .* does not exist/i.test(msg) || /could not find the '.+' column/i.test(msg);
}

/**
 * Route one unrouted Queued task. Laya is asked at most once per task: the
 * tick first takes the `routing` lock with a guarded update, so an
 * overlapping tick that loses the race never calls the router.
 */
async function routeTask(
  task: MissionTask,
  router: TaskRouter,
  d: OrchestratorDeps,
  ctx: PassContext,
) {
  const now = d.now().toISOString();
  const unrouted: TaskGuard = { stage: "Queued", runId: null, routingStatus: null };
  let locked: boolean;
  try {
    locked = await d.store.updateTaskIf(task.id, unrouted, {
      routingStatus: "routing",
      routedAt: now,
    });
  } catch (err: unknown) {
    // The router is on but the migrations were never applied: say so plainly
    // instead of a generic per-task error on every tick.
    if (!isMissingColumnError(err)) throw err;
    console.error("[orchestrator] routing columns missing", { taskId: task.id, error: errorMessage(err) });
    if (!ctx.problems.includes(ROUTING_MIGRATION_HINT)) ctx.problems.push(ROUTING_MIGRATION_HINT);
    return;
  }
  if (!locked) return;

  const lockGuard: TaskGuard = { stage: "Queued", runId: null, routingStatus: "routing" };

  try {
    const agents = await d.store.listAllEnabledAgents();
    const decision = await router.decide(task, agents);
    const agent = agents.find((a) => a.id === decision.agentId);
    if (!agent) throw new Error(`Laya picked an unknown agent: ${decision.agentId}`);
    const outcome = routeOutcome(decision);

    const routed = await d.store.updateTaskIf(task.id, lockGuard, {
      stage: outcome.stage,
      routingStatus: outcome.routingStatus,
      layaAgentId: agent.id,
      routeUrgency: decision.urgency,
      routeNeedsHuman: decision.needsHuman,
      routeConfidence: decision.confidence,
      routeReason: outcome.reason,
      routedAt: d.now().toISOString(),
      // Only a task that routes straight through gets its agent now; a task at
      // the human gate is assigned when an operator approves or overrides.
      ...(outcome.stage === "Routed"
        ? { agentId: agent.id, agentName: agent.name, model: agent.model }
        : {}),
    });
    if (routed && outcome.stage === "Awaiting routing") {
      await safeNotify(d.notify, {
        kind: "routing_needs_you",
        missionId: task.missionId,
        taskId: task.id,
        title: "Pick an agent for a task",
        body: `"${task.title}": ${outcome.reason ?? "Laya wants a human to choose."}`,
        dedupeKey: `routing:${task.id}`,
      });
    }
  } catch (err: unknown) {
    const reason = errorMessage(err).slice(0, MAX_ERROR_CHARS);
    console.warn("[orchestrator] task routing failed; using the default agent", {
      taskId: task.id,
      error: reason,
    });

    const fallback = await pickStageAgent("workers", task.agentName, d);
    if (!fallback) {
      await d.store.updateTaskIf(task.id, lockGuard, { routingStatus: null, routedAt: null });
      ctx.problems.push(`No enabled worker agent to route task "${task.title}"`);
      return;
    }

    await d.store.updateTaskIf(task.id, lockGuard, {
      stage: "Routed",
      routingStatus: "fallback",
      agentId: fallback.id,
      agentName: fallback.name,
      model: fallback.model,
      routeReason: reason,
      routedAt: d.now().toISOString(),
    });
  }
}

/** A `routing` lock left by a crashed tick is released so routing can retry. */
async function releaseStaleRouting(task: MissionTask, d: OrchestratorDeps) {
  if (!isStale(task.routedAt ?? null, d.now())) return;
  await d.store.updateTaskIf(
    task.id,
    { stage: task.stage, runId: task.runId, routingStatus: "routing" },
    { routingStatus: null, routedAt: null },
  );
}

/* ------------------------------------------------------------------ */
/* Human gate: approve or override a route                             */
/* ------------------------------------------------------------------ */

export type RouteGateResult =
  | { ok: true; task: MissionTask }
  | { ok: false; status: 400 | 404 | 409; error: string };

const AWAITING_GUARD: TaskGuard = {
  stage: "Awaiting routing",
  runId: null,
  routingStatus: "awaiting",
};

async function findGateTask(
  missionId: string,
  taskId: string,
  d: OrchestratorDeps,
): Promise<MissionTask | null> {
  try {
    const detail = await d.store.getMissionDetail(missionId);
    return detail.tasks.find((t) => t.id === taskId) ?? null;
  } catch {
    return null; // mission not found
  }
}

async function assignFromGate(
  task: MissionTask,
  agent: Agent,
  patch: { routingStatus: "approved" | "overridden"; humanAgentId?: string },
  d: OrchestratorDeps,
): Promise<RouteGateResult> {
  const moved = await d.store.updateTaskIf(task.id, AWAITING_GUARD, {
    stage: "Routed",
    agentId: agent.id,
    agentName: agent.name,
    model: agent.model,
    routedAt: d.now().toISOString(),
    ...patch,
  });
  if (!moved) {
    return { ok: false, status: 409, error: "Task is no longer waiting for routing" };
  }
  return {
    ok: true,
    task: { ...task, stage: "Routed", agentId: agent.id, agentName: agent.name, model: agent.model, ...patch },
  };
}

/** "Setujui": accept Laya's pick. Laya's original choice stays in laya_agent_id. */
export async function approveRoute(
  missionId: string,
  taskId: string,
  deps?: Partial<OrchestratorDeps>,
): Promise<RouteGateResult> {
  const d = resolveDeps(deps);
  const task = await findGateTask(missionId, taskId, d);
  if (!task) return { ok: false, status: 404, error: "Task not found" };
  if (task.stage !== "Awaiting routing") {
    return { ok: false, status: 409, error: "Task is not waiting for routing" };
  }

  if (task.layaAgentId === null) {
    return { ok: false, status: 409, error: "No Laya pick to approve. Pakai Ganti agen." };
  }
  const agent = await findAnyEnabledAgent(task.layaAgentId, d);
  if (!agent) {
    return { ok: false, status: 409, error: "Laya's agent is no longer enabled. Pilih agen lain." };
  }
  return assignFromGate(task, agent, { routingStatus: "approved" }, d);
}

/** "Ganti agen": a human picks the agent. Both picks are kept for evaluation. */
export async function overrideRoute(
  missionId: string,
  taskId: string,
  agentId: unknown,
  deps?: Partial<OrchestratorDeps>,
): Promise<RouteGateResult> {
  if (typeof agentId !== "string" || agentId.trim() === "") {
    return { ok: false, status: 400, error: "Missing required 'agentId'" };
  }

  const d = resolveDeps(deps);
  const task = await findGateTask(missionId, taskId, d);
  if (!task) return { ok: false, status: 404, error: "Task not found" };
  if (task.stage !== "Awaiting routing") {
    return { ok: false, status: 409, error: "Task is not waiting for routing" };
  }

  const agent = await findAnyEnabledAgent(agentId, d);
  if (!agent) return { ok: false, status: 400, error: `Agent ${agentId} is not an enabled agent` };
  return assignFromGate(task, agent, { routingStatus: "overridden", humanAgentId: agent.id }, d);
}

/**
 * Where the work lives, for every stage's prompt. QA and Review get it too,
 * so they can inspect the real files instead of only the coder's summary.
 */
function workspaceLines(m: MissionDetailDTO, stage: "Coding" | "QA check" | "Review"): string[] {
  const folder = m.agentWorkspacePath || m.workspacePath;
  if (!folder) return [];
  const lines = [`Workspace: ${folder}`];
  if (m.workBranch) {
    lines.push(`Branch: ${m.workBranch} (a git worktree created for this mission)`);
    lines.push(
      stage === "Coding"
        ? `Commit your changes on ${m.workBranch} with clear messages. Do not switch, create, push or delete branches.`
        : `Inspect the files and \`git log\` on ${m.workBranch}. Do not modify or commit anything.`,
    );
  }
  return lines;
}

/**
 * The QA or review report that rejected the task's previous attempt, or null
 * on a first attempt (or when that attempt's coding run itself failed).
 * Reports are keyed by the attempt (`qa:<task>:<retries>`); review only runs
 * after QA passed, so a review report of that attempt is the rejection.
 */
export function lastRejection(m: MissionDetailDTO, task: MissionTask): MissionArtifact | null {
  if (task.retries < 1) return null;
  const attempt = task.retries - 1;
  const byKey = (key: string) => m.artifacts.find((a) => a.dedupeKey === key) ?? null;
  return byKey(`review:${task.id}:${attempt}`) ?? byKey(`qa:${task.id}:${attempt}`);
}

function rejectionLines(m: MissionDetailDTO, task: MissionTask): string[] {
  const report = lastRejection(m, task);
  if (!report) return [];
  const gate = report.kind === "review_report" ? "Final review" : "QA";
  return [
    "",
    `Your previous attempt was rejected by ${gate}. Fix every issue in this report:`,
    truncateMiddle(report.content, MAX_PROMPT_CONTEXT_CHARS),
  ];
}

function taskPrompt(m: MissionDetailDTO, task: MissionTask): string {
  const deliverable = truncateMiddle(task.resultOutput ?? "", MAX_PROMPT_CONTEXT_CHARS);
  switch (task.stage) {
    case "Coding":
      return [
        "Execute the following task:",
        `Title: ${task.title}`,
        `Requirements: ${task.result || task.title}`,
        ...workspaceLines(m, "Coding"),
        ...rejectionLines(m, task),
      ]
        .filter(Boolean)
        .join("\n");
    case "QA check":
      return [
        `Verify the deliverables for task "${task.title}".`,
        "",
        `Requirements: ${task.result || task.title}`,
        ...workspaceLines(m, "QA check"),
        "",
        `Deliverable:\n${deliverable}`,
        "",
        "End your response with VERDICT: PASS or VERDICT: FAIL.",
      ].join("\n");
    default:
      return [
        `Review security, accessibility, and quality for task "${task.title}".`,
        ...workspaceLines(m, "Review"),
        "",
        `Deliverable:\n${deliverable}`,
        "",
        "End with VERDICT: APPROVED or VERDICT: CHANGES_REQUESTED.",
      ].join("\n");
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
  review?: MissionReviewRun | null,
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

  // Only an agent with a budget needs its spend looked up.
  const agentUsed = agent.tokenBudget ? await d.store.agentMissionTokens(m.id, agent.id) : null;
  const overBudget = budgetBlock(m, agent, agentUsed);
  if (overBudget) {
    const parked = await d.store.updateTaskIf(task.id, claimGuard, {
      stage: "Needs you",
      runId: null,
      runAgentId: null,
      runStartedAt: null,
    });
    if (parked) {
      ctx.problems.push(overBudget.message);
      await safeNotify(d.notify, {
        kind: "budget_reached",
        missionId: m.id,
        taskId: task.id,
        title: "Token budget reached",
        body: overBudget.message,
        dedupeKey: `budget:${task.id}:${overBudget.scope}:${overBudget.limit}`,
      });
    }
    return;
  }

  // One task = one Hermes session: a retry continues the earlier attempt.
  let sessionId: string | undefined;
  if (task.stage === "Coding") {
    sessionId = task.sessionId ?? undefined;
    if (!sessionId) {
      try {
        sessionId = await d.hermes.createSession(agent, `Task: ${task.title}`);
      } catch {
        sessionId = undefined; // runs work without a session
      }
      if (sessionId) {
        try {
          await d.store.updateTaskIf(task.id, claimGuard, { sessionId });
        } catch {
          // session_id column not migrated yet: this attempt still runs in it.
        }
      }
    }
  }

  let started: HermesStartRunResult;
  try {
    started = await d.hermes.startRun(agent, {
      prompt: review?.prompt ?? taskPrompt(m, task),
      sessionId,
      cwd: m.agentWorkspacePath || m.workspacePath || undefined,
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

  const updated = await d.store.updateTaskIf(task.id, claimGuard, {
    runId: started.runId,
    runAgentId: agent.id,
    agentId: agent.id,
    agentName: agent.name,
    model: agent.model,
  });

  if (updated && review?.reviewId && d.reviews) {
    try {
      await d.reviews.updateReview(review.reviewId, {
        status: "reviewing",
        runId: started.runId,
        agentId: agent.id,
        model: agent.model || null,
        runtime: agent.runtime ?? "hermes",
        error: null,
      });
    } catch (err: unknown) {
      console.warn("[orchestrator] could not update the code review row", errorMessage(err));
    }
  }
}

/* ------------------------------------------------------------------ */
/* Mission PR + code review (Build / Fix)                              */
/* ------------------------------------------------------------------ */

/** What startTaskRun needs for a Final review of a mission PR. */
export type MissionReviewRun = { prompt: string; reviewId: string | null };

const PR_DELIVERABLE_CHARS = 4000;

export function missionReviewPrompt(m: MissionDetailDTO, task: MissionTask, pr: MissionPr, data: PrData): string {
  return buildReviewPrompt(
    {
      repo: prSlug(pr.ref),
      number: pr.number,
      url: pr.url,
      title: data.title,
      body: data.body,
      headRef: data.headRef,
      baseRef: data.baseRef,
      files: data.files,
      diff: data.diff,
      diffTruncated: data.diffTruncated,
    },
    [
      `This is the Final review of task "${task.title}" in the neiro mission "${m.title}".`,
      "The PR holds the whole mission so far. Judge whether this task is done right, and still report any blocker you see elsewhere in the diff.",
      `Task requirements: ${task.result || task.title}`,
      ...workspaceLines(m, "Review"),
      "",
      "The worker's notes:",
      truncateMiddle(task.resultOutput ?? "", PR_DELIVERABLE_CHARS) || "(none)",
      "",
      "After the json block, end with VERDICT: APPROVED or VERDICT: CHANGES_REQUESTED.",
    ],
  );
}

/**
 * Commit + push the mission branch and open (or reuse) its draft PR, then
 * record the review row. Null when the PR could not be made: the task is
 * parked in Needs you with the reason on the mission.
 */
async function openMissionPr(
  m: MissionDetailDTO,
  task: MissionTask,
  d: OrchestratorDeps,
  ctx: PassContext,
): Promise<MissionReviewRun | null> {
  const claimGuard: TaskGuard = { stage: task.stage, runId: task.runId };
  const github = d.github ?? { ensureMissionPr: realEnsureMissionPr, fetchPr: realFetchPr };

  let pr: MissionPr;
  let data: PrData;
  try {
    pr = await github.ensureMissionPr(m, task.title);
    data = await github.fetchPr(pr.ref);
  } catch (err: unknown) {
    const reason = errorMessage(err);
    const parked = await d.store.updateTaskIf(task.id, claimGuard, {
      stage: "Needs you",
      runId: null,
      runAgentId: null,
      runStartedAt: null,
    });
    if (parked) {
      ctx.problems.push(prProblem(task.title, reason));
      await safeNotify(d.notify, {
        kind: "task_needs_you",
        missionId: m.id,
        taskId: task.id,
        title: "A task needs you",
        body: `"${task.title}" is ready for Final review, but its PR could not be opened: ${reason}`,
        dedupeKey: `pr:${task.id}:${task.retries}`,
      });
    }
    return null;
  }

  if (m.prUrl !== pr.url || m.prNumber !== pr.number) {
    try {
      await d.store.updateMissionIf(m.id, { phase: m.phase, runId: m.runId }, { prUrl: pr.url, prNumber: pr.number });
    } catch (err: unknown) {
      // pr_url column not migrated yet: the PR still exists and is reviewed.
      console.warn("[orchestrator] could not save the mission PR", errorMessage(err));
    }
  }

  let reviewId: string | null = null;
  if (d.reviews) {
    const prFields = {
      prTitle: data.title || null,
      headRef: data.headRef || null,
      baseRef: data.baseRef || null,
      files: data.files,
    };
    try {
      const existing = await d.reviews.findReviewForTask(task.id, task.retries);
      if (existing) {
        await d.reviews.updateReview(existing.id, { ...prFields, status: "fetching", error: null });
        reviewId = existing.id;
      } else {
        const row = await d.reviews.createReview({
          repo: prSlug(pr.ref),
          prNumber: pr.number,
          prUrl: pr.url,
          source: "mission",
          missionId: m.id,
          taskId: task.id,
          taskAttempt: task.retries,
          status: "fetching",
          ...prFields,
        });
        reviewId = row.id;
      }
    } catch (err: unknown) {
      // The /reviews page is a view; the Final review gate still runs.
      console.warn("[orchestrator] could not record the code review", errorMessage(err));
    }
  }

  return { prompt: missionReviewPrompt(m, task, pr, data), reviewId };
}

type ReviewRowPatch = Parameters<CodeReviewStore["updateReview"]>[1];

function reviewPatchFrom(parsed: ParsedReview, output: string, tokens: number): ReviewRowPatch {
  if (!parsed.ok) return { status: "failed", error: parsed.error, rawOutput: output, tokens };
  return {
    status: "done",
    verdict: parsed.verdict,
    summary: parsed.summary || null,
    design: parsed.design,
    findings: parsed.findings,
    rawOutput: output,
    tokens,
    error: parsed.dropped > 0 ? `${parsed.dropped} finding(s) were not in the expected shape and were left out.` : null,
  };
}

/** Writes the Final review result to the task attempt's row, if it has one. */
async function finishMissionReview(task: MissionTask, d: OrchestratorDeps, patch: ReviewRowPatch) {
  if (!d.reviews) return;
  try {
    const row = await d.reviews.findReviewForTask(task.id, task.retries);
    if (row && row.status !== "done" && row.status !== "failed") await d.reviews.updateReview(row.id, patch);
  } catch (err: unknown) {
    console.warn("[orchestrator] could not save the code review result", errorMessage(err));
  }
}
