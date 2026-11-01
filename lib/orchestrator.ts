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
import path from "node:path";
import {
  type HermesRunStatus,
  type HermesStartRunResult,
} from "@/lib/hermes";
import {
  createSession as createAgentSession,
  forkSession as forkAgentSession,
  getCapabilities as getAgentCapabilities,
  getRun as getAgentRun,
  resolveUnknownRun as resolveAgentUnknownRun,
  startRun as startAgentRun,
  submitRunApproval as submitAgentApproval,
  type RunStartInput,
} from "@/lib/agent-runtime";
import { REPLY_SHAPES } from "@/lib/reply-format";
import { watchRunSteps } from "@/lib/run-steps-recorder";
import { diffWorkspace, snapshotWorkspace } from "@/lib/workspace-diff";
import type { HermesServerCapabilities } from "@/lib/hermes";
import {
  extractGateVerdict,
  extractPlanFromOrchestratorOutput,
  extractSkillBlock,
  truncateMiddle,
} from "@/lib/orchestrator-parsers";
import {
  createSupabaseStore,
  type MissionGuard,
  type OrchestratorStore,
  type TaskGuard,
  type TaskPatch,
} from "@/lib/orchestrator-store";
import {
  createConfiguredRouter,
  calibrateRouterThreshold,
  ROUTE_CONFIDENCE_THRESHOLD,
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
import { approvalActions, safeNotify, shortHash } from "@/lib/notifications";
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
import { hasPrProblem, prProblem, taskProblem, taskProblemFor } from "@/lib/needs-you";
import { readRepoRules, type RepoRules } from "@/lib/repo-rules";
import { loadReviewRulesText } from "@/lib/review-rules-store";
import { asRuntime, missionNeedsPr } from "@/lib/types";
import { getSupabaseAdmin } from "@/lib/supabase";
import { evaluateSafeApproval, guardExternalPrompt } from "@/lib/system-one-gate";
import { isSyntheticRequestId } from "@/lib/approvals";
import { writeWorktreeHermesContext, prepareTaskWorktree, mergeTaskWorktree, cleanupMergedTaskWorktree, TaskMergeConflict, type MissionWorkspace } from "@/lib/worktree";
import { localAgentProfile } from "@/lib/hermes-local-profile";
import { saveLearnedSkillFile } from "@/lib/hermes-skills";
import { estimateAgentRunCost } from "@/lib/usage-cost";
import { WORKTREE_REVIEW_PREFIX } from "@/lib/worktree-reviews";

/* ------------------------------------------------------------------ */
/* Dependencies                                                        */
/* ------------------------------------------------------------------ */

export interface HermesClient {
  startRun(agent: Agent, input: RunStartInput): Promise<HermesStartRunResult>;
  getRun(agent: Agent, runId: string): Promise<HermesRunStatus>;
  createSession(agent: Agent, title: string): Promise<string>;
  /** Releases a run Hermes reports as "unknown". Missing = cannot recover. */
  resolveUnknownRun?(
    agent: Agent,
    runId: string,
    details: { admissionId: string; executionGeneration: number },
  ): Promise<boolean>;
  forkSession?(agent: Agent, sessionId: string, title?: string): Promise<string>;
  getCapabilities?(agent: Agent): Promise<HermesServerCapabilities>;
  submitApproval?: typeof submitAgentApproval;
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
  /** The admin's edited review rules (null = default). Omit for the stored ones. */
  reviewRules?: () => Promise<string | null>;
  /**
   * Listen to a started run's steps and save them (run_steps). Omit for the
   * real listener; when a custom store is passed (tests) it defaults to none.
   */
  watchRun?: ((agent: Agent, runId: string) => void) | null;
  installLearnedSkill?: ((agentId: string, name: string, content: string) => Promise<void>) | null;
  writeWorktreeContext?: typeof writeWorktreeHermesContext | null;
  taskWorkspace?: { prepare: typeof prepareTaskWorktree; merge: typeof mergeTaskWorktree; cleanup?: typeof cleanupMergedTaskWorktree } | null;
  safeApproval?: typeof evaluateSafeApproval;
  guardPrText?: typeof guardExternalPrompt;
  runCost?: typeof estimateAgentRunCost | null;
  routerThreshold?: () => Promise<number>;
  /**
   * Git snapshots of the mission folder, for each coding attempt's diff.
   * Omit for real git; when a custom store is passed (tests) it defaults to none.
   */
  workspace?: {
    snapshot: typeof snapshotWorkspace;
    diff: typeof diffWorkspace;
  } | null;
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
  resolveUnknownRun: resolveAgentUnknownRun,
  forkSession: forkAgentSession,
  getCapabilities: getAgentCapabilities,
  submitApproval: submitAgentApproval,
};

let cachedCalibration: { until: number; threshold: number } | null = null;
async function calibratedThreshold(): Promise<number> {
  if (cachedCalibration && cachedCalibration.until > Date.now()) return cachedCalibration.threshold;
  try {
    const calibration = await calibrateRouterThreshold(getSupabaseAdmin());
    const threshold = calibration?.accept ?? ROUTE_CONFIDENCE_THRESHOLD;
    cachedCalibration = { threshold, until: Date.now() + 60 * 60_000 };
    return threshold;
  } catch {
    return ROUTE_CONFIDENCE_THRESHOLD;
  }
}

function resolveDeps(deps?: Partial<OrchestratorDeps>): OrchestratorDeps {
  return {
    store: deps?.store ?? createSupabaseStore(),
    hermes: deps?.hermes ?? realHermes,
    now: deps?.now ?? (() => new Date()),
    newId: deps?.newId ?? (() => crypto.randomUUID()),
    router:
      deps?.router !== undefined ? deps.router : isRouterEnabled() ? createConfiguredRouter() : null,
    notify: deps?.notify ?? (deps?.store ? undefined : supabaseNotifier),
    reviews: deps?.reviews !== undefined ? deps.reviews : deps?.store ? null : createCodeReviewStore(),
    github: deps?.github ?? { ensureMissionPr: realEnsureMissionPr, fetchPr: realFetchPr },
    reviewRules: deps?.reviewRules ?? (deps?.store ? async () => null : loadReviewRulesText),
    watchRun: deps?.watchRun !== undefined ? deps.watchRun : deps?.store ? null : watchRunSteps,
    installLearnedSkill: deps?.installLearnedSkill !== undefined ? deps.installLearnedSkill : deps?.store ? null : async (agentId, name, content) => {
      const profile = await localAgentProfile(agentId);
      await saveLearnedSkillFile(profile, name, content);
    },
    safeApproval: deps?.safeApproval ?? evaluateSafeApproval,
    guardPrText: deps?.guardPrText ?? (deps?.store ? async () => "unknown" : guardExternalPrompt),
    runCost: deps?.runCost !== undefined ? deps.runCost : deps?.store ? null : estimateAgentRunCost,
    routerThreshold: deps?.routerThreshold ?? (deps?.store ? async () => ROUTE_CONFIDENCE_THRESHOLD : calibratedThreshold),
    taskWorkspace: deps?.taskWorkspace !== undefined ? deps.taskWorkspace : deps?.store ? null : { prepare: prepareTaskWorktree, merge: mergeTaskWorktree, cleanup: cleanupMergedTaskWorktree },
    writeWorktreeContext: deps?.writeWorktreeContext !== undefined ? deps.writeWorktreeContext : deps?.store ? null : writeWorktreeHermesContext,
    workspace:
      deps?.workspace !== undefined
        ? deps.workspace
        : deps?.store
          ? null
          : { snapshot: snapshotWorkspace, diff: diffWorkspace },
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
  "interrupted",
  "stopped",
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

/**
 * Hermes long-term memory scope (X-Hermes-Session-Key): every agent on the
 * same project shares one, so what one learns the next can recall.
 */
export function memoryKey(m: Pick<MissionDetailDTO, "id" | "projectId">): string {
  return m.projectId ? `neiro:project:${m.projectId}` : `neiro:mission:${m.id}`;
}

/** Hermes lost track of this run (a crash between admission and finish). */
export const isUnknownRun = (run: HermesRunStatus): boolean => run.status.toLowerCase() === "unknown";

export type UnknownRunVerdict = "resolved" | "unresolved" | "unsupported";

/**
 * Releases a run Hermes reports as "unknown", so it can be started again
 * without the hung one ever finishing twice. `unsupported` = no recovery
 * details, or this Hermes cannot resolve unknown runs.
 */
async function resolveUnknown(agent: Agent, run: HermesRunStatus, d: OrchestratorDeps): Promise<UnknownRunVerdict> {
  if (!run.admission_id || typeof run.execution_generation !== "number" || !d.hermes.resolveUnknownRun) {
    return "unsupported";
  }
  if (d.hermes.getCapabilities) {
    const caps = await d.hermes.getCapabilities(agent).catch(() => null);
    if (caps?.available && caps.features.run_unknown_resolution === false) return "unsupported";
  }
  const ok = await d.hermes
    .resolveUnknownRun(agent, run.run_id, {
      admissionId: run.admission_id,
      executionGeneration: run.execution_generation,
    })
    .catch(() => false);
  return ok ? "resolved" : "unresolved";
}

const UNKNOWN_RUN_REASON: Record<Exclude<UnknownRunVerdict, "resolved">, string> = {
  unresolved: "Hermes could not resolve a run left in an unknown state",
  unsupported: "Run state is unknown and Hermes cannot recover it",
};

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
      await stepSummarize(detail, d, ctx);
      break;
    case "done":
      break;
  }

  const retainedTaskProblems = detail.tasks.flatMap((task) => {
    const reason = task.stage === "Needs you" ? taskProblemFor(detail.lastError, task.id) : null;
    return reason ? [taskProblem(task.id, reason)] : [];
  });
  if (ctx.problems.length > 0 || retainedTaskProblems.length > 0) {
    const message = [...new Set([...ctx.problems, ...retainedTaskProblems])].join("; ").slice(0, MAX_ERROR_CHARS);
    if (message !== detail.lastError) await d.store.setMissionError(missionId, message);
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

async function recordMissionRunUsage(m: MissionDetailDTO, agent: Agent, run: HermesRunStatus, stage: string, d: OrchestratorDeps) {
  if (!m.runId || (run.tokens ?? 0) <= 0) return;
  await d.store.recordTokenUsage({
    runId: m.runId, missionId: m.id, taskId: null, agentId: agent.id, agentName: agent.name,
    stage, tokens: run.tokens ?? 0, model: run.runtime?.model || agent.model || run.model || null,
    runtime: agent.runtime ?? "hermes", inputTokens: run.input_tokens,
    outputTokens: run.output_tokens, cacheReadTokens: run.cache_read_tokens,
    costUsd: await d.runCost?.(agent, run).catch(() => null) ?? null,
  });
}

async function recordGatewayDraining(missionId: string, taskId: string | null, runId: string, run: HermesRunStatus, d: OrchestratorDeps) {
  if (!run.shutdown_requested_at) return;
  try {
    await d.store.insertArtifactOnce({ missionId, taskId, title: "Hermes restarting", kind: "gateway_draining", content: "Hermes is draining for a restart; this run may be interrupted.", dedupeKey: `draining:${runId}`, runId });
  } catch (error) {
    console.warn("[orchestrator] could not record gateway restart", errorMessage(error));
  }
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
        sessionKey: memoryKey(m),
        // Screenshots go to the planner, which writes them into the tasks.
        images: phase === "planning" && m.attachments?.length ? m.attachments : undefined,
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

    const saved = await d.store.updateMissionIf(m.id, claimGuard, { runId: started.runId });
    // Keep the plan / spec run's steps too, with no one watching.
    if (saved) d.watchRun?.(agent, started.runId);
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
  await recordGatewayDraining(m.id, null, m.runId, run, d);
  if (isUnknownRun(run)) {
    const verdict = await resolveUnknown(agent, run, d);
    // Released: the next tick starts the phase again. Otherwise keep the run
    // and say why, so the operator can stop or retry it.
    if (verdict === "resolved") await d.store.updateMissionIf(m.id, guard, clearRun);
    else ctx.problems.push(`${phase} run: ${UNKNOWN_RUN_REASON[verdict]}`);
    return;
  }
  const outcome = classifyRun(run.status);
  if (outcome === "pending") {
    d.watchRun?.(agent, m.runId);
    return;
  }

  await recordMissionRunUsage(m, agent, run, phase, d);

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
      runId: m.runId,
      runStartedAt: m.runStartedAt,
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
    runId: m.runId,
    runStartedAt: m.runStartedAt,
  });
  await enterExecuting(m, guard, d, output);
}

/** spec → executing; pauses for operator approval when requested. */
async function enterExecuting(m: MissionDetailDTO, guard: MissionGuard, d: OrchestratorDeps, newPrd?: string) {
  if (m.worktreePath && d.writeWorktreeContext) {
    const latestPrd = newPrd ?? prdVersions(m.artifacts, m.id).at(-1)?.artifact.content ?? "";
    await d.writeWorktreeContext(m.worktreePath, `# Mission objective\n\n${m.prompt}\n\n# Product requirements\n\n${latestPrd || "No PRD available."}\n`);
  }
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
      actions: [{ id: "approve_plan", label: "Approve plan", target: m.id }],
    });
  }
}

/* ------------------------------------------------------------------ */
/* Summary                                                             */
/* ------------------------------------------------------------------ */

export const SKILL_PROMPT_LINES = [
  "After the summary, write a reusable skill from what worked in this mission.",
  "Put it in one fenced block that starts with ```skill and ends with ```.",
  "Inside: a SKILL.md with YAML frontmatter (--- name: <kebab-case>, description: <one line> ---),",
  "then numbered steps another agent can follow next time. No secrets, no file contents.",
];

function summaryPrompt(m: MissionDetailDTO): string {
  const tasks = m.tasks
    .map((t) => `- ${t.title}: ${truncateMiddle(t.resultOutput ?? t.result ?? "", 600)}`)
    .join("\n");
  return [
    `Summarize the finished mission "${m.title}" for the operator in at most 10 lines.`,
    `Goal: ${truncateMiddle(m.prompt, 2000)}`,
    "",
    "Tasks and what they delivered:",
    truncateMiddle(tasks, MAX_PROMPT_CONTEXT_CHARS),
    "",
    ...SKILL_PROMPT_LINES,
  ].join("\n");
}

async function stepSummarize(m: MissionDetailDTO, d: OrchestratorDeps, ctx?: PassContext) {
  const staticSummary = `Mission completed. ${m.tasks.length} tasks reached Done. See the recorded QA and review results for verification.`;
  let summary = staticSummary;

  // Learn a skill: one orchestrator run writes the summary and a SKILL.md.
  if (m.learnSkillOnDone) {
    const outcome = await stepSkillRun(m, d, ctx);
    if (outcome === "waiting") return;
    if (outcome) {
      summary = outcome.summary || staticSummary;
      if (outcome.skill) {
        await d.store.insertArtifactOnce({
          missionId: m.id,
          title: `Learned skill: ${outcome.skill.name}`,
          kind: "learned_skill",
          content: outcome.skill.content,
          dedupeKey: `skill:${m.id}`,
        });
        if (m.runAgentId && d.installLearnedSkill) {
          try { await d.installLearnedSkill(m.runAgentId, outcome.skill.name, outcome.skill.content); }
          catch (error) { console.warn("[orchestrator] learned skill not installed", { missionId: m.id, error: errorMessage(error) }); }
        }
      }
    }
  }

  await d.store.insertArtifactOnce({
    missionId: m.id,
    title: "Mission Summary",
    kind: "mission_summary",
    content: summary,
    dedupeKey: `summary:${m.id}`,
  });
  const done = await d.store.updateMissionIf(
    m.id,
    { phase: "summarizing", runId: m.runId, status: "running" },
    { phase: "done" satisfies MissionPhase, status: "completed", completedAt: d.now().toISOString(), runId: null, runAgentId: null, runStartedAt: null },
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

/**
 * The summarizing run of a learn-a-skill mission. "waiting" while it runs;
 * null when there is no agent or the run failed (the mission still finishes,
 * just without a skill).
 */
async function stepSkillRun(
  m: MissionDetailDTO,
  d: OrchestratorDeps,
  ctx?: PassContext,
): Promise<"waiting" | { summary: string; skill: ReturnType<typeof extractSkillBlock> } | null> {
  const guard: MissionGuard = { phase: "summarizing", runId: m.runId, status: "running" };
  if (m.runId === null) {
    const agent =
      (await pickStageAgent("orchestrator", undefined, d)) ?? (await pickStageAgent("reviewer", undefined, d));
    if (!agent) return null;
    const token = CLAIM_PREFIX + d.newId();
    const claimed = await d.store.updateMissionIf(m.id, guard, {
      runId: token,
      runAgentId: agent.id,
      runStartedAt: d.now().toISOString(),
    });
    if (!claimed) return "waiting";
    const claimGuard: MissionGuard = { phase: "summarizing", runId: token };
    try {
      const started = await d.hermes.startRun(agent, {
        prompt: summaryPrompt(m),
        cwd: m.agentWorkspacePath || m.workspacePath || undefined,
        sessionKey: memoryKey(m),
        idempotencyKey: `summary-${m.id}-${token.slice(CLAIM_PREFIX.length)}`,
      });
      if (started.kind === "deferred") {
        await d.store.updateMissionIf(m.id, claimGuard, { runId: null, runAgentId: null, runStartedAt: null });
        return "waiting";
      }
      await d.store.updateMissionIf(m.id, claimGuard, { runId: started.runId });
    } catch (err: unknown) {
      ctx?.problems.push(`Could not start the summary run: ${errorMessage(err)}`);
      // Give up on the skill rather than block the mission.
      await d.store.updateMissionIf(m.id, claimGuard, { runId: null, runAgentId: null, runStartedAt: null });
      return null;
    }
    return "waiting";
  }
  if (isClaim(m.runId)) {
    if (isStale(m.runStartedAt, d.now())) {
      await d.store.updateMissionIf(m.id, guard, { runId: null, runAgentId: null, runStartedAt: null });
    }
    return "waiting";
  }
  const agent = await findRunAgent(m.runAgentId, ["orchestrator", "reviewer"], d);
  if (!agent) return null;
  const run = await d.hermes.getRun(agent, m.runId);
  const outcome = classifyRun(run.status);
  if (outcome === "pending" && !isUnknownRun(run)) return "waiting";
  if (!isUnknownRun(run)) await recordMissionRunUsage(m, agent, run, "summarizing", d);
  if (outcome !== "success") return null;
  const output = (run.output ?? "").trim();
  const summary = output.replace(/```skill[\s\S]*?```/i, "").trim();
  return { summary, skill: extractSkillBlock(output) };
}

/* ------------------------------------------------------------------ */
/* Task-level runs                                                     */
/* ------------------------------------------------------------------ */

async function stepTasks(m: MissionDetailDTO, d: OrchestratorDeps, ctx: PassContext) {
  if (m.tasks.length > 0 && m.tasks.every((t) => t.stage === "Done")) {
    for (const task of m.tasks) {
      if (!task.taskWorktreePath && !task.taskBranch) continue;
      const mission = isolatedMissionWorkspace(m);
      if (!mission || !task.taskWorktreePath || !task.taskBranch || !d.taskWorkspace?.cleanup) {
        ctx.problems.push(`Task ${task.title} has an incomplete worktree cleanup configuration.`);
        return;
      }
      try {
        if (await d.taskWorkspace.cleanup(mission, { worktreePath: task.taskWorktreePath, branch: task.taskBranch }) === "busy") return;
        if (!(await d.store.updateTaskIf(task.id, { stage: "Done", runId: null }, { taskWorktreePath: null, taskBranch: null }))) return;
      } catch (error) {
        ctx.problems.push(`Task ${task.title} was merged, but cleanup needs attention: ${errorMessage(error)}`);
        return;
      }
    }
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

  const batched = new Set<string>();
  if (d.router?.decideMany) {
    const ready = m.tasks.filter((task) => task.stage === "Queued" && !task.routingStatus && !task.runId && (task.taskKey !== null || task.depends.length === 0) && task.depends.every((key) => stageByKey.get(key) === "Done"));
    const locked: MissionTask[] = [];
    for (const task of ready) {
      if (await lockRouting(task, d, ctx)) locked.push(task);
      batched.add(task.id);
    }
    if (locked.length) {
      let decisions: Map<string, import("@/lib/task-router").RouteDecision> | null = null;
      let failure: unknown = null;
      try { decisions = await d.router.decideMany(locked, await d.store.listAllEnabledAgents()); }
      catch (error) { failure = error; }
      for (const task of locked) {
        const decision = decisions?.get(task.id);
        const router: TaskRouter = { decide: async () => { if (!decision) throw failure ?? new Error("Router returned no decision"); return decision; } };
        await routeTask(task, router, d, ctx, true);
      }
    }
  }
  for (const task of m.tasks) {
    if (batched.has(task.id)) continue;
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

  // Review passed: merge an isolated task under its own guarded claim.
  if (task.stage === "Final review" && task.taskIntegrationPending && task.runId === null) {
    await integrateIsolatedTask(m, task, d, ctx);
    return;
  }

  // Active stage without a run: start that stage's run (or skip a missing gate).
  if (task.runId === null) {
    const qa = task.stage === "QA check";
    const isReview = task.stage === "Final review";
    if ((qa && m.skipQa) || (isReview && m.skipReview)) {
      await d.store.insertArtifactOnce({ missionId: m.id, taskId: task.id, title: `${qa ? "QA" : "Review"} skipped: ${task.title}`, kind: "gate_skipped", content: `The operator confirmed at preflight that ${qa ? "QA" : "review"} was unavailable and may be skipped.`, dedupeKey: `${qa ? "qa" : "review"}:${task.id}:${task.retries}` });
      await d.store.updateTaskIf(task.id, guard, isReview && task.taskWorktreePath ? { taskIntegrationPending: true } : { stage: qa ? "Final review" : "Done" });
      return;
    }
    const agent = await pickTaskAgent(task.stage, task, d);
    if (!agent) {
      if (qa || isReview) {
        const reason = `No enabled ${qa ? "QA" : "review"} agent is available. Enable an agent and retry.`;
        const parked = await d.store.updateTaskIf(task.id, guard, { stage: "Needs you", verificationWaitStage: qa ? "QA check" : "Final review" });
        if (parked) {
          ctx.problems.push(taskProblem(task.id, reason));
          await safeNotify(d.notify, { kind: "task_needs_you", missionId: m.id, taskId: task.id, title: "Verification needs attention", body: reason, dedupeKey: `verification:${task.id}:${task.retries}` });
        }
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
    if (task.stage === "Final review" && missionNeedsPr(m.mode) && !task.taskWorktreePath) {
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
  await recordGatewayDraining(m.id, task.id, task.runId, run, d);
  if (isUnknownRun(run)) {
    const verdict = await resolveUnknown(agent, run, d);
    if (verdict === "resolved") {
      // Released on the server: count it as a failed attempt so the next
      // tick schedules a fresh run, never a second copy of the hung one.
      await recordAttemptFailure(m, task, d, "The run stopped answering and was released on the server.");
      await failAttempt(m, task, guard, task.tokens, d, { pendingControls: [] });
    } else {
      await parkTask(m, task, guard, UNKNOWN_RUN_REASON[verdict], d, ctx);
    }
    return;
  }
  const outcome = classifyRun(run.status);
  if (outcome === "pending") {
    // Keep its steps for the task chat, even with no one watching (cron).
    d.watchRun?.(agent, task.runId);
    await trackPendingControls(m, task, guard, run, d, agent);
    return;
  }

  const output = (run.output ?? "").trim();
  const tokens = task.tokens + (run.tokens ?? 0);
  const facts = runFacts(task, run);

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
      // After a provider fallback the run's own model is the true one.
      model: run.runtime?.model || agent.model || run.model || null,
      runtime: agent.runtime ?? "hermes",
      inputTokens: run.input_tokens,
      outputTokens: run.output_tokens,
      cacheReadTokens: run.cache_read_tokens,
      costUsd: await d.runCost?.(agent, run).catch(() => null) ?? null,
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
    await recordAttemptFailure(m, task, d, run.error || (output ? `The run ended with status "${run.status}".` : "The agent returned an empty answer."));
    await failAttempt(m, task, guard, tokens, d, facts);
    return;
  }

  if (task.stage === "Coding") {
    await recordAttemptDiff(m, task, d);
    // Every attempt's output is kept, so the task chat can show old attempts.
    await d.store.insertArtifactOnce({
      missionId: m.id,
      taskId: task.id,
      title: `Coding output: ${task.title}`,
      kind: "coding_output",
      content: output,
      dedupeKey: `code:${task.id}:${task.retries}`,
      runId: task.runId,
      runStartedAt: task.runStartedAt,
    });
    await d.store.updateTaskIf(task.id, guard, {
      stage: "QA check",
      resultOutput: output,
      tokens,
      ...facts,
      ...clearRun,
    });
    return;
  }

  const isQa = task.stage === "QA check";
  await d.store.insertArtifactOnce({
    missionId: m.id,
    taskId: task.id,
    title: !isQa && task.taskWorktreePath ? `${WORKTREE_REVIEW_PREFIX}${task.title}` : `${isQa ? "QA Report" : "Review Report"}: ${task.title}`,
    kind: isQa ? "qa_report" : "review_report",
    content: output,
    dedupeKey: `${isQa ? "qa" : "review"}:${task.id}:${task.retries}`,
    runId: task.runId,
    runStartedAt: task.runStartedAt,
  });

  const verdict = isQa
    ? extractGateVerdict(output, "PASS", "FAIL")
    : extractGateVerdict(output, "APPROVED", "CHANGES_REQUESTED");
  let passed = verdict.verdict === (isQa ? "PASS" : "APPROVED");

  // Final review: a JSON answer (the PR review prompt) decides, and its
  // findings go to the task's row on /reviews.
  if (!isQa && missionNeedsPr(m.mode) && !task.taskWorktreePath) {
    const parsed = parseReviewOutput(output);
    if (parsed.ok) passed = reviewPassed(parsed.verdict, parsed.findings);
    await finishMissionReview(task, d, reviewPatchFrom(parsed, output, run.tokens ?? 0));
  }

  if (!passed) {
    await failAttempt(m, task, guard, tokens, d, facts);
    return;
  }

  await d.store.updateTaskIf(task.id, guard, {
    ...(!isQa && task.taskWorktreePath ? { taskIntegrationPending: true } : { stage: isQa ? "Final review" as const : "Done" as const }),
    tokens,
    ...facts,
    ...clearRun,
  });
}

/** Merge a reviewed task only once, then publish the mission PR under the same lock. */
async function integrateIsolatedTask(m: MissionDetailDTO, task: MissionTask, d: OrchestratorDeps, ctx: PassContext) {
  const mission = isolatedMissionWorkspace(m);
  if (!mission || !task.taskWorktreePath || !task.taskBranch || !d.taskWorkspace) {
    ctx.problems.push(`Task ${task.title} has an incomplete isolated worktree configuration.`);
    return;
  }
  const token = CLAIM_PREFIX + d.newId();
  const idle: TaskGuard = { stage: "Final review", runId: null };
  if (!(await d.store.updateTaskIf(task.id, idle, { runId: token, runStartedAt: d.now().toISOString() }))) return;
  const claimed: TaskGuard = { stage: "Final review", runId: token };
  let markedDone = false;
  try {
    const result = await d.taskWorkspace.merge(mission, { worktreePath: task.taskWorktreePath, branch: task.taskBranch }, task.title, async () => {
      if (missionNeedsPr(m.mode)) {
        const github = d.github ?? { ensureMissionPr: realEnsureMissionPr, fetchPr: realFetchPr };
        const pr = await github.ensureMissionPr(m, task.title);
        if (!(await d.store.updateMissionIf(m.id, { phase: "executing", runId: m.runId, status: "running" }, { prUrl: pr.url, prNumber: pr.number }))) throw new Error("Mission changed while opening its PR.");
      }
      markedDone = await d.store.updateTaskIf(task.id, claimed, { stage: "Done", runId: null, runAgentId: null, runStartedAt: null, taskIntegrationPending: false });
      if (!markedDone) throw new Error("Task changed while integrating its branch.");
    });
    if (result === "busy") { await d.store.updateTaskIf(task.id, claimed, { runId: null, runStartedAt: null }); return; }
    if (markedDone) await d.store.updateTaskIf(task.id, { stage: "Done", runId: null }, { taskWorktreePath: null, taskBranch: null });
  } catch (error) {
    const reason = error instanceof TaskMergeConflict ? `Merge conflict: ${error.files.join(", ")}` : errorMessage(error);
    if (markedDone) { ctx.problems.push(`Task ${task.title} was merged, but cleanup needs attention: ${reason}`); return; }
    const parked = await d.store.updateTaskIf(task.id, claimed, { stage: "Needs you", runId: null, runStartedAt: null });
    if (parked) {
      ctx.problems.push(taskProblem(task.id, reason));
      await safeNotify(d.notify, { kind: "task_needs_you", missionId: m.id, taskId: task.id, title: "Task integration needs you", body: reason, dedupeKey: `integration:${task.id}:${task.retries}` });
    }
  }
}

/** Cache tokens and the real provider/model of a finished run, added to the task. */
export function runFacts(task: MissionTask, run: HermesRunStatus): TaskPatch {
  const patch: TaskPatch = { pendingControls: [] };
  if (run.cache_read_tokens) patch.cacheReadTokens = (task.cacheReadTokens ?? 0) + run.cache_read_tokens;
  if (run.cache_write_tokens) patch.cacheWriteTokens = (task.cacheWriteTokens ?? 0) + run.cache_write_tokens;
  const model = run.runtime?.model ?? run.model;
  if (run.runtime?.provider) patch.runtimeProvider = run.runtime.provider;
  if (model) patch.runtimeModel = model;
  return patch;
}

/**
 * A run waiting on approvals: keep its controls on the task (so the card,
 * Needs you and chat apps can answer them) and announce each new request once.
 */
async function trackPendingControls(
  m: MissionDetailDTO,
  task: MissionTask,
  guard: TaskGuard,
  run: HermesRunStatus,
  d: OrchestratorDeps,
  agent: Agent,
) {
  const controls = run.controls ?? [];
  const before = (task.pendingControls ?? []).map((c) => c.requestId).join("|");
  const after = controls.map((c) => c.requestId).join("|");
  if (before === after) return;
  const saved = await d.store
    .updateTaskIf(task.id, guard, {
      pendingControls: controls,
      admissionId: run.admission_id ?? null,
      executionGeneration: run.execution_generation ?? null,
    })
    .catch(() => false);
  if (!saved) return;
  const known = new Set((task.pendingControls ?? []).map((c) => c.requestId));
  for (const control of controls) {
    if (control.kind !== "approval" || known.has(control.requestId)) continue;
    const what = control.command ? `${control.tool ?? "a tool"}: ${control.command}` : (control.tool ?? "a tool");
    if ((m.autoApproveSafeTools || process.env.NEIRO_AUTO_APPROVE_SAFE === "on") && task.runId && !isSyntheticRequestId(control.requestId) && control.choices.includes("once") && d.hermes.submitApproval && d.store.claimAutoApproval && d.safeApproval) {
      let approved = false;
      try {
        if (await d.safeApproval(control) && await d.store.claimAutoApproval(task.runId, control.requestId)) {
          approved = await d.hermes.submitApproval(agent, task.runId, "once", { requestId: control.requestId, executionGeneration: control.executionGeneration });
          if (approved) await d.store.insertArtifactOnce({ missionId: m.id, taskId: task.id, title: "Safe tool approved once", kind: "auto_approval", content: what, dedupeKey: `auto-approval:${task.runId}:${control.requestId}`, runId: task.runId });
        }
      } catch (error) { console.warn("[orchestrator] safe approval failed", errorMessage(error)); }
      if (approved) continue;
    }
    await safeNotify(d.notify, {
      kind: "task_needs_you",
      missionId: m.id,
      taskId: task.id,
      title: "An agent asks to use a tool",
      body: `"${task.title}" wants to run ${what}`,
      dedupeKey: `approval:${task.id}:${control.requestId}`,
      actions: approvalActions(task.id, control),
    });
  }
}

/** Parks a task in Needs you (run released) and tells the operator why. */
async function parkTask(
  m: MissionDetailDTO,
  task: MissionTask,
  guard: TaskGuard,
  reason: string,
  d: OrchestratorDeps,
  ctx: PassContext,
) {
  const parked = await d.store.updateTaskIf(task.id, guard, {
    stage: "Needs you",
    runId: null,
    runAgentId: null,
    runStartedAt: null,
    pendingControls: [],
  });
  if (!parked) return;
  ctx.problems.push(`${task.title}: ${reason}`);
  await safeNotify(d.notify, {
    kind: "task_needs_you",
    missionId: m.id,
    taskId: task.id,
    title: "A task needs you",
    body: `"${task.title}": ${reason}.`,
    dedupeKey: `unknown:${task.id}:${task.retries}`,
    actions: [{ id: "retry_task", label: "Retry task", target: task.id }],
  });
}

/** Failed gate or run: retry while under the mission's cap, else escalate. */
/** Save what this coding attempt changed (a git diff) for the task chat. */
async function recordAttemptDiff(m: MissionDetailDTO, task: MissionTask, d: OrchestratorDeps) {
  if (!d.workspace) return;
  try {
    const snap = m.artifacts.find((a) => a.dedupeKey === `snap:${task.id}:${task.retries}`)?.content ?? null;
    const taskMission = taskWorkspaceMission(m, task);
    const diff = await d.workspace.diff(taskMission.agentWorkspacePath || taskMission.workspacePath, snap);
    if (!diff) return;
    await d.store.insertArtifactOnce({
      missionId: m.id,
      taskId: task.id,
      title: `Changes: ${task.title}`,
      kind: "code_diff",
      content: diff.truncated ? `${diff.patch}\n… (diff cut, too long to show)` : diff.patch,
      dedupeKey: `diff:${task.id}:${task.retries}`,
      runId: task.runId,
      runStartedAt: task.runStartedAt,
    });
  } catch (err: unknown) {
    // A diff is extra: the task still moves on without it.
    console.warn("[orchestrator] could not record the attempt's diff", errorMessage(err));
  }
}

/** Save why a run failed, so the task chat says more than "failed". */
async function recordAttemptFailure(m: MissionDetailDTO, task: MissionTask, d: OrchestratorDeps, reason: string) {
  try {
    await d.store.insertArtifactOnce({
      missionId: m.id,
      taskId: task.id,
      title: `${task.stage} failed: ${task.title}`,
      kind: "run_failure",
      content: reason.slice(0, MAX_ERROR_CHARS),
      dedupeKey: `fail:${task.id}:${task.retries}:${TASK_STAGE_KEY[task.stage] ?? task.stage}`,
      runId: task.runId,
      runStartedAt: task.runStartedAt,
    });
  } catch (err: unknown) {
    console.warn("[orchestrator] could not record the failure reason", errorMessage(err));
  }
}

async function failAttempt(
  m: MissionDetailDTO,
  task: MissionTask,
  guard: TaskGuard,
  tokens: number,
  d: OrchestratorDeps,
  facts: TaskPatch = {},
) {
  const clearRun = { runId: null, runAgentId: null, runStartedAt: null };
  if (task.retries < m.maxRetries) {
    // A routed task keeps its route: back to Routed, never re-asking Laya.
    await d.store.updateTaskIf(task.id, guard, {
      stage: task.routingStatus ? "Routed" : "Queued",
      retries: task.retries + 1,
      tokens,
      ...facts,
      ...clearRun,
    });
  } else {
    const escalated = await d.store.updateTaskIf(task.id, guard, { stage: "Needs you", tokens, ...facts, ...clearRun });
    if (escalated) {
      await safeNotify(d.notify, {
        kind: "task_needs_you",
        missionId: m.id,
        taskId: task.id,
        title: "A task needs you",
        body: `"${task.title}" failed ${task.retries + 1} time(s) in ${task.stage}.`,
        dedupeKey: `needs:${task.id}:${task.retries}`,
        actions: [{ id: "retry_task", label: "Retry task", target: task.id }],
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
async function lockRouting(task: MissionTask, d: OrchestratorDeps, ctx: PassContext): Promise<boolean> {
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
    return false;
  }
  return locked;

}

async function routeTask(
  task: MissionTask,
  router: TaskRouter,
  d: OrchestratorDeps,
  ctx: PassContext,
  alreadyLocked = false,
) {
  if (!alreadyLocked && !(await lockRouting(task, d, ctx))) return;

  const lockGuard: TaskGuard = { stage: "Queued", runId: null, routingStatus: "routing" };

  try {
    const agents = await d.store.listAllEnabledAgents();
    const decision = await router.decide(task, agents);
    const agent = agents.find((a) => a.id === decision.agentId);
    if (!agent) throw new Error(`Laya picked an unknown agent: ${decision.agentId}`);
    const threshold = await d.routerThreshold?.().catch(() => ROUTE_CONFIDENCE_THRESHOLD) ?? ROUTE_CONFIDENCE_THRESHOLD;
    const outcome = routeOutcome(decision, threshold);

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
        actions: [{ id: "approve_route", label: "Approve route", target: task.id }],
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

/** The task chat shows these paths under each reply (splitAnswerFiles). */
const FILES_READ_RULE =
  'End with one line that starts with "Files read:" followed by the paths you opened, comma separated.';
const FILES_READ_BEFORE_VERDICT =
  'Just before the verdict line, add one line that starts with "Files read:" followed by the paths you opened, comma separated.';

/** The operator's newest "try this instead" note from a session fork. */
export function latestForkNote(m: Pick<MissionDetailDTO, "artifacts">, taskId: string): string | null {
  const notes = m.artifacts.filter((a) => a.kind === "fork_note" && a.taskId === taskId);
  return notes.length ? notes[notes.length - 1].content : null;
}

function forkNoteLines(m: MissionDetailDTO, task: MissionTask): string[] {
  const note = latestForkNote(m, task.id);
  return note ? ["", "Try this approach instead:", truncateMiddle(note, 4000)] : [];
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
        ...forkNoteLines(m, task),
        REPLY_SHAPES,
        FILES_READ_RULE,
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
        FILES_READ_BEFORE_VERDICT,
        "End your response with VERDICT: PASS or VERDICT: FAIL.",
      ].join("\n");
    default:
      return [
        `Review security, accessibility, and quality for task "${task.title}".`,
        ...workspaceLines(m, "Review"),
        "",
        `Deliverable:\n${deliverable}`,
        "",
        FILES_READ_BEFORE_VERDICT,
        "End with VERDICT: APPROVED or VERDICT: CHANGES_REQUESTED.",
      ].join("\n");
  }
}

function isolatedMissionWorkspace(m: MissionDetailDTO): Extract<MissionWorkspace, { kind: "worktree" }> | null {
  if (!m.worktreePath || !m.repoRoot || !m.workBranch || m.maxParallelWorkers <= 1) return null;
  return { kind: "worktree", path: m.agentWorkspacePath || m.worktreePath, worktreePath: m.worktreePath, repoRoot: m.repoRoot, branch: m.workBranch, baseRef: m.baseBranch || "HEAD" };
}

function taskWorkspaceMission(m: MissionDetailDTO, task: MissionTask): MissionDetailDTO {
  if (!task.taskWorktreePath || !task.taskBranch || !m.worktreePath) return m;
  const relative = path.relative(m.worktreePath, m.agentWorkspacePath || m.worktreePath);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("Mission workspace is outside its worktree.");
  return { ...m, agentWorkspacePath: path.join(task.taskWorktreePath, relative), worktreePath: task.taskWorktreePath, workBranch: task.taskBranch };
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

  const isolated = isolatedMissionWorkspace(m);
  const agent = knownAgent ?? (await pickTaskAgent(task.stage, task, d));
  if (!agent) {
    await release();
    ctx.problems.push(`No enabled agent for ${task.stage} on task "${task.title}"`);
    return;
  }
  if (isolated && asRuntime(agent.runtime) === "hermes") {
    const reason = "Hermes cannot enforce a separate working directory for this run. Use one worker or an Oh My Pi agent for parallel isolated tasks.";
    const parked = await d.store.updateTaskIf(task.id, claimGuard, { stage: "Needs you", runId: null, runStartedAt: null });
    if (parked) {
      ctx.problems.push(taskProblem(task.id, reason));
      await safeNotify(d.notify, { kind: "task_needs_you", missionId: m.id, taskId: task.id, title: "Task isolation needs attention", body: reason, dedupeKey: `isolation:${task.id}:${task.retries}` });
    }
    return;
  }
  if (task.stage === "Coding" && isolated && d.taskWorkspace && !task.taskWorktreePath) {
    try {
      const worktree = await d.taskWorkspace.prepare(isolated, task.id, task.taskKey);
      const saved = await d.store.updateTaskIf(task.id, claimGuard, { taskWorktreePath: worktree.worktreePath, taskBranch: worktree.branch });
      if (!saved) return;
      task = { ...task, taskWorktreePath: worktree.worktreePath, taskBranch: worktree.branch };
    } catch (error) {
      await release();
      throw error;
    }
  }
  const taskMission = taskWorkspaceMission(m, task);

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

  // Before the coding agent touches anything: remember the folder's state,
  // so the task chat can show exactly what this attempt changed.
  if (task.stage === "Coding" && d.workspace) {
    try {
      const snap = await d.workspace.snapshot(taskMission.agentWorkspacePath || taskMission.workspacePath);
      if (snap) {
        await d.store.insertArtifactOnce({
          missionId: m.id,
          taskId: task.id,
          title: `Workspace before: ${task.title}`,
          kind: "workspace_snapshot",
          content: snap,
          dedupeKey: `snap:${task.id}:${task.retries}`,
        });
      }
    } catch (err: unknown) {
      console.warn("[orchestrator] could not snapshot the workspace", errorMessage(err));
    }
  }

  let started: HermesStartRunResult;
  try {
    started = await d.hermes.startRun(agent, {
      prompt: review?.prompt ?? taskPrompt(taskMission, task),
      sessionId,
      sessionKey: memoryKey(m),
      cwd: taskMission.agentWorkspacePath || taskMission.workspacePath || undefined,
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

  if (updated) d.watchRun?.(agent, started.runId);

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

export function missionReviewPrompt(
  m: MissionDetailDTO,
  task: MissionTask,
  pr: MissionPr,
  data: PrData,
  repoRules: RepoRules | null = null,
  rules: string | null = null,
): string {
  const checkout = m.agentWorkspacePath || m.worktreePath;
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
      checkout: checkout ? { path: checkout, onHead: true } : null,
      repoRules,
      rules,
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

  if (await d.guardPrText?.(`${data.title}\n\n${data.body}`) === "flagged") {
    const reason = "The pull request text may contain instructions aimed at the reviewer. Inspect it before reviewing.";
    const parked = await d.store.updateTaskIf(task.id, claimGuard, { stage: "Needs you", runId: null, runAgentId: null, runStartedAt: null });
    if (parked) {
      ctx.problems.push(taskProblem(task.id, reason));
      await safeNotify(d.notify, { kind: "task_needs_you", missionId: m.id, taskId: task.id, title: "Pull request review needs attention", body: reason, dedupeKey: `pr-guard:${task.id}:${task.retries}` });
    }
    return null;
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

  const rules = await readRepoRules(m.worktreePath || m.agentWorkspacePath).catch(() => null);
  const reviewRules = d.reviewRules ? await d.reviewRules().catch(() => null) : null;
  return { prompt: missionReviewPrompt(m, task, pr, data, rules, reviewRules), reviewId };
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
