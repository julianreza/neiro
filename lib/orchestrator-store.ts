import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase";
import { writeDroppingMissing } from "@/lib/missing-column";
import { mapRunUsage } from "@/lib/run-usage";
import { APPROVAL_CHOICES, asReasoningEffort, asRuntime, MISSION_MODES } from "@/lib/types";
import type {
  Agent,
  AgentStage,
  Mission,
  MissionArtifact,
  MissionDetailDTO,
  MissionMode,
  MissionPhase,
  MissionStatus,
  MissionTask,
  ImageAttachment,
  PendingControl,
  RoutingStatus,
  SubagentRun,
  TaskRouting,
  TaskStage,
} from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Store contract                                                      */
/* ------------------------------------------------------------------ */

/** Observed state a guarded task update must still match. */
export type TaskGuard = {
  stage: TaskStage;
  runId: string | null;
  /** When present, routing_status must also match (null = not routed yet). */
  routingStatus?: RoutingStatus | null;
  pendingControls?: PendingControl[];
};

/** Observed state a guarded mission update must still match. */
export type MissionGuard = {
  phase: MissionPhase;
  runId: string | null;
  status?: MissionStatus;
};

export type MissionPatch = Partial<{
  status: MissionStatus;
  phase: MissionPhase;
  runId: string | null;
  runAgentId: string | null;
  runStartedAt: string | null;
  prUrl: string | null;
  prNumber: number | null;
  completedAt: string | null;
}>;

export type TaskPatch = Partial<
  TaskRouting & {
    stage: TaskStage;
    runId: string | null;
    runAgentId: string | null;
    runStartedAt: string | null;
    agentId: string | null;
    agentName: string;
    model: string;
    tokens: number;
    retries: number;
    resultOutput: string | null;
    taskWorktreePath: string | null;
    taskBranch: string | null;
    taskIntegrationPending: boolean;
    verificationWaitStage: "QA check" | "Final review" | null;
    sessionId: string | null;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    runtimeProvider: string | null;
    runtimeModel: string | null;
    pendingControls: PendingControl[];
    approval: boolean;
    admissionId: string | null;
    executionGeneration: number | null;
    subagentRuns: SubagentRun[];
  }
>;

/** mission_tasks columns added by 20261031000000_hermes_full_suite.sql. */
export const OPTIONAL_TASK_COLUMNS = [
  "cache_read_tokens",
  "cache_write_tokens",
  "runtime_provider",
  "runtime_model",
  "pending_controls",
  "admission_id",
  "execution_generation",
  "subagent_runs",
] as const;

export type NewTaskRow = {
  id: string;
  missionId: string;
  taskKey: string;
  title: string;
  agentName: string;
  model: string;
  depends: string[];
  result: string | null;
};

export type NewArtifactRow = {
  missionId: string;
  taskId?: string | null;
  title: string;
  kind: string;
  content: string;
  dedupeKey: string;
  /** The run that made it, so the task chat can show its tokens and time. */
  runId?: string | null;
  runStartedAt?: string | null;
};

/** Tokens one finished run spent, credited to the agent that ran it. */
export type TokenUsageRow = {
  runId: string;
  /** Null for runs outside a mission (a manual code review). */
  missionId: string | null;
  taskId: string | null;
  agentId: string | null;
  agentName: string;
  stage: string;
  tokens: number;
  model?: string | null;
  runtime?: string | null;
  /** In / out / cache-read split, when the run reports it. */
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  costUsd?: number | null;
};

export interface OrchestratorStore {
  getMissionDetail(missionId: string): Promise<MissionDetailDTO>;
  /** Missions the tick should advance: status 'running' only. */
  listActiveMissionIds(): Promise<string[]>;
  listEnabledAgents(stage: AgentStage): Promise<Agent[]>;
  /** Every enabled agent, any stage (the router's candidate set). */
  listAllEnabledAgents(): Promise<Agent[]>;
  /** Guarded update; resolves true only if exactly one row matched the guard. */
  updateMissionIf(id: string, guard: MissionGuard, patch: MissionPatch): Promise<boolean>;
  /** Guarded update; resolves true only if exactly one row matched the guard. */
  updateTaskIf(id: string, guard: TaskGuard, patch: TaskPatch): Promise<boolean>;
  /**
   * Atomically move a Queued, unclaimed task to Coding with `token` as its
   * run id, but only while the mission is under max_parallel_workers.
   */
  claimTask(taskId: string, token: string): Promise<boolean>;
  /** Insert planned tasks; rows whose (mission_id, task_key) exists are ignored. */
  insertTasks(rows: NewTaskRow[]): Promise<void>;
  /** Insert an artifact unless one with the same dedupe key exists. */
  insertArtifactOnce(row: NewArtifactRow): Promise<void>;
  /** Record a finished run's tokens; a run id already recorded is ignored. */
  recordTokenUsage(row: TokenUsageRow): Promise<void>;
  claimAutoApproval?(runId: string, requestId: string): Promise<boolean>;
  /**
   * Tokens this agent's own runs spent in this mission, from
   * agent_token_usage; null when that table cannot be read.
   */
  agentMissionTokens(missionId: string, agentId: string): Promise<number | null>;
  /** Record (message) or clear (null) the mission's last orchestration error. */
  setMissionError(id: string, message: string | null): Promise<void>;
}

/* ------------------------------------------------------------------ */
/* Row mappers                                                         */
/* ------------------------------------------------------------------ */

type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null =>
  v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);

const ROUTING_STATUSES = new Set<RoutingStatus>([
  "routing",
  "routed",
  "awaiting",
  "fallback",
  "approved",
  "overridden",
]);

function mapRouting(row: Row): TaskRouting {
  const status = str(row.routing_status);
  return {
    routingStatus:
      status && ROUTING_STATUSES.has(status as RoutingStatus) ? (status as RoutingStatus) : null,
    layaAgentId: str(row.laya_agent_id),
    humanAgentId: str(row.human_agent_id),
    routeUrgency: num(row.route_urgency),
    routeNeedsHuman: bool(row.route_needs_human),
    routeConfidence: num(row.route_confidence),
    routeReason: str(row.route_reason),
    routedAt: str(row.routed_at),
  };
}

export function mapAgentRow(row: Row): Agent {
  return {
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    role: String(row.role ?? ""),
    stage: (row.stage as AgentStage) || "workers",
    specialty: String(row.specialty ?? ""),
    model: String(row.model ?? "Claude Sonnet 4.6"),
    profile: String(row.profile ?? "default"),
    prompt: String(row.prompt ?? ""),
    url: String(row.url ?? ""),
    key_enc: str(row.key_enc),
    enabled: Boolean(row.enabled ?? true),
    activeRun: Boolean(row.active_run ?? false),
    tokenBudget: num(row.token_budget),
    runtime: asRuntime(row.runtime),
    effort: str(row.effort) ?? "",
    reasoningEffort: asReasoningEffort(row.reasoning_effort),
    serviceTier: str(row.service_tier),
    canonicalSessionId: str(row.canonical_session_id),
    botSection: str(row.bot_section),
    botHidden: Boolean(row.bot_hidden ?? false),
    createdAt: str(row.created_at) ?? undefined,
    updatedAt: str(row.updated_at) ?? undefined,
  };
}

export function mapMissionRow(row: Row): Mission {
  return {
    id: String(row.id ?? ""),
    title: String(row.title ?? ""),
    prompt: String(row.prompt ?? ""),
    status: (row.status as MissionStatus) || "running",
    phase: (row.phase as MissionPhase) || "planning",
    pauseAfterPlanning: Boolean(row.pause_after_planning ?? false),
    autoApproveSafeTools: Boolean(row.auto_approve_safe_tools ?? false),
    skipQa: Boolean(row.skip_qa ?? false),
    skipReview: Boolean(row.skip_review ?? false),
    maxParallelWorkers: Number(row.max_parallel_workers ?? 3),
    maxRetries: Number(row.max_retries ?? 2),
    workspacePath: str(row.workspace_path),
    baseBranch: str(row.base_branch),
    agentWorkspacePath: str(row.agent_workspace_path),
    workBranch: str(row.work_branch),
    worktreePath: str(row.worktree_path),
    repoRoot: str(row.repo_root),
    projectId: str(row.project_id),
    runId: str(row.run_id),
    runAgentId: str(row.run_agent_id),
    phaseChangedAt: str(row.phase_changed_at),
    runStartedAt: str(row.run_started_at),
    lastError: str(row.last_error),
    lastErrorAt: str(row.last_error_at),
    tokenBudget: num(row.token_budget),
    mode: MISSION_MODES.includes(row.mode as MissionMode) ? (row.mode as MissionMode) : null,
    prUrl: str(row.pr_url),
    prNumber: num(row.pr_number),
    learnSkillOnDone: Boolean(row.learn_skill_on_done ?? false),
    attachments: mapAttachments(row.attachments),
    createdAt: str(row.created_at) ?? undefined,
    updatedAt: str(row.updated_at) ?? undefined,
    completedAt: str(row.completed_at),
  };
}

export function mapTaskRow(row: Row): MissionTask {
  const rawDepends = row.depends;
  return {
    id: String(row.id ?? ""),
    missionId: String(row.mission_id ?? ""),
    title: String(row.title ?? ""),
    stage: (row.stage as TaskStage) || "Queued",
    agentId: str(row.agent_id),
    agentName: String(row.agent_name ?? ""),
    model: String(row.model ?? ""),
    tokens: Number(row.tokens ?? 0),
    depends: Array.isArray(rawDepends) ? rawDepends.map((d) => String(d)) : [],
    approval: Boolean(row.approval ?? false),
    retries: Number(row.retries ?? 0),
    result: str(row.result),
    taskKey: str(row.task_key),
    runId: str(row.run_id),
    runAgentId: str(row.run_agent_id),
    runStartedAt: str(row.run_started_at),
    resultOutput: str(row.result_output),
    taskWorktreePath: str(row.task_worktree_path),
    taskBranch: str(row.task_branch),
    taskIntegrationPending: Boolean(row.task_integration_pending ?? false),
    verificationWaitStage: row.verification_wait_stage === "QA check" || row.verification_wait_stage === "Final review" ? row.verification_wait_stage : null,
    sessionId: str(row.session_id),
    cacheReadTokens: Number(row.cache_read_tokens ?? 0) || 0,
    cacheWriteTokens: Number(row.cache_write_tokens ?? 0) || 0,
    runtimeProvider: str(row.runtime_provider),
    runtimeModel: str(row.runtime_model),
    pendingControls: mapPendingControls(row.pending_controls),
    admissionId: str(row.admission_id),
    executionGeneration: num(row.execution_generation),
    subagentRuns: mapSubagentRuns(row.subagent_runs),
    ...mapRouting(row),
    createdAt: str(row.created_at) ?? undefined,
    updatedAt: str(row.updated_at) ?? undefined,
  };
}

function mapAttachments(v: unknown): ImageAttachment[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((a) => {
    if (!a || typeof a !== "object") return [];
    const r = a as Row;
    return typeof r.dataUrl === "string" ? [{ name: String(r.name ?? "image"), dataUrl: r.dataUrl }] : [];
  });
}

/** Stored pending_controls rows (already normalized when written). */
export function mapPendingControls(v: unknown): PendingControl[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((c) => {
    if (!c || typeof c !== "object") return [];
    const r = c as Row;
    const requestId = str(r.requestId);
    if (!requestId || (r.kind !== "approval" && r.kind !== "clarify")) return [];
    const choices = Array.isArray(r.choices)
      ? r.choices.filter((x): x is PendingControl["choices"][number] =>
          APPROVAL_CHOICES.includes(x as PendingControl["choices"][number]))
      : [];
    return [{
      requestId,
      executionGeneration: num(r.executionGeneration),
      kind: r.kind === "clarify" ? "clarify" : "approval",
      tool: str(r.tool) ?? undefined,
      command: str(r.command) ?? undefined,
      choices: choices.length ? choices : ["once", "deny"],
    } satisfies PendingControl];
  });
}

function mapSubagentRuns(v: unknown): SubagentRun[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x) => {
    if (!x || typeof x !== "object") return [];
    const r = x as Row;
    const delegationId = str(r.delegationId);
    if (!delegationId) return [];
    const status = r.status === "completed" || r.status === "failed" ? r.status : "running";
    return [{
      delegationId,
      childSessionId: str(r.childSessionId) ?? undefined,
      sourceAgentId: str(r.sourceAgentId) ?? undefined,
      status,
      summary: str(r.summary) ?? undefined,
      durationSec: num(r.durationSec) ?? undefined,
      tokens: num(r.tokens) ?? undefined,
      startedAt: str(r.startedAt),
    } satisfies SubagentRun];
  });
}

export function mapArtifactRow(row: Row): MissionArtifact {
  return {
    id: String(row.id ?? ""),
    missionId: String(row.mission_id ?? ""),
    taskId: str(row.task_id),
    title: String(row.title ?? ""),
    kind: String(row.kind ?? "document"),
    content: String(row.content ?? ""),
    dedupeKey: str(row.dedupe_key),
    createdAt: str(row.created_at) ?? undefined,
    runId: str(row.run_id),
    runStartedAt: str(row.run_started_at),
  };
}

function missionPatchToRow(patch: MissionPatch): Row {
  const row: Row = {};
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.phase !== undefined) row.phase = patch.phase;
  if (patch.runId !== undefined) row.run_id = patch.runId;
  if (patch.runAgentId !== undefined) row.run_agent_id = patch.runAgentId;
  if (patch.runStartedAt !== undefined) row.run_started_at = patch.runStartedAt;
  if (patch.prUrl !== undefined) row.pr_url = patch.prUrl;
  if (patch.prNumber !== undefined) row.pr_number = patch.prNumber;
  if (patch.completedAt !== undefined) row.completed_at = patch.completedAt;
  return row;
}

function taskPatchToRow(patch: TaskPatch): Row {
  const row: Row = {};
  if (patch.stage !== undefined) row.stage = patch.stage;
  if (patch.runId !== undefined) row.run_id = patch.runId;
  if (patch.runAgentId !== undefined) row.run_agent_id = patch.runAgentId;
  if (patch.runStartedAt !== undefined) row.run_started_at = patch.runStartedAt;
  if (patch.agentId !== undefined) row.agent_id = patch.agentId;
  if (patch.agentName !== undefined) row.agent_name = patch.agentName;
  if (patch.model !== undefined) row.model = patch.model;
  if (patch.tokens !== undefined) row.tokens = patch.tokens;
  if (patch.retries !== undefined) row.retries = patch.retries;
  if (patch.resultOutput !== undefined) row.result_output = patch.resultOutput;
  if (patch.taskWorktreePath !== undefined) row.task_worktree_path = patch.taskWorktreePath;
  if (patch.taskBranch !== undefined) row.task_branch = patch.taskBranch;
  if (patch.taskIntegrationPending !== undefined) row.task_integration_pending = patch.taskIntegrationPending;
  if (patch.verificationWaitStage !== undefined) row.verification_wait_stage = patch.verificationWaitStage;
  if (patch.sessionId !== undefined) row.session_id = patch.sessionId;
  if (patch.cacheReadTokens !== undefined) row.cache_read_tokens = patch.cacheReadTokens;
  if (patch.cacheWriteTokens !== undefined) row.cache_write_tokens = patch.cacheWriteTokens;
  if (patch.runtimeProvider !== undefined) row.runtime_provider = patch.runtimeProvider;
  if (patch.runtimeModel !== undefined) row.runtime_model = patch.runtimeModel;
  if (patch.pendingControls !== undefined) row.pending_controls = patch.pendingControls;
  if (patch.approval !== undefined) row.approval = patch.approval;
  if (patch.admissionId !== undefined) row.admission_id = patch.admissionId;
  if (patch.executionGeneration !== undefined) row.execution_generation = patch.executionGeneration;
  if (patch.subagentRuns !== undefined) row.subagent_runs = patch.subagentRuns;
  if (patch.routingStatus !== undefined) row.routing_status = patch.routingStatus;
  if (patch.layaAgentId !== undefined) row.laya_agent_id = patch.layaAgentId;
  if (patch.humanAgentId !== undefined) row.human_agent_id = patch.humanAgentId;
  if (patch.routeUrgency !== undefined) row.route_urgency = patch.routeUrgency;
  if (patch.routeNeedsHuman !== undefined) row.route_needs_human = patch.routeNeedsHuman;
  if (patch.routeConfidence !== undefined) row.route_confidence = patch.routeConfidence;
  if (patch.routeReason !== undefined) row.route_reason = patch.routeReason;
  if (patch.routedAt !== undefined) row.routed_at = patch.routedAt;
  return row;
}

/* ------------------------------------------------------------------ */
/* Supabase implementation                                             */
/* ------------------------------------------------------------------ */

export function createSupabaseStore(client?: SupabaseClient): OrchestratorStore {
  const db = () => client ?? getSupabaseAdmin();

  return {
    async getMissionDetail(missionId) {
      const supabase = db();
      const [mRes, tRes, aRes, uRes] = await Promise.all([
        supabase.from("missions").select("*").eq("id", missionId).single(),
        supabase
          .from("mission_tasks")
          .select("*")
          .eq("mission_id", missionId)
          .order("created_at", { ascending: true }),
        supabase
          .from("mission_artifacts")
          .select("*")
          .eq("mission_id", missionId)
          .neq("kind", "run_cost_provenance")
          .order("created_at", { ascending: true }),
        // select("*") so a missing model column (older DB) still reads.
        supabase
          .from("agent_token_usage")
          .select("*")
          .eq("mission_id", missionId)
          .order("created_at", { ascending: true })
          .limit(5_000),
      ]);

      if (mRes.error || !mRes.data) {
        throw new Error(`Mission ${missionId} not found`);
      }
      if (tRes.error) throw new Error(tRes.error.message);
      if (aRes.error) throw new Error(aRes.error.message);

      return {
        ...mapMissionRow(mRes.data as Row),
        tasks: (tRes.data ?? []).map((r) => mapTaskRow(r as Row)),
        artifacts: (aRes.data ?? []).map((r) => mapArtifactRow(r as Row)),
        // Token usage is extra: a missing table just means no footer facts.
        runUsage: uRes.error
          ? []
          : (uRes.data ?? []).map((r) => mapRunUsage(r as Row)),
      };
    },

    async listActiveMissionIds() {
      const { data, error } = await db().from("missions").select("id").eq("status", "running");
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => String((r as Row).id));
    },

    async listEnabledAgents(stage) {
      const { data, error } = await db()
        .from("agents")
        .select("*")
        .eq("enabled", true)
        .eq("stage", stage);
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => mapAgentRow(r as Row));
    },

    async listAllEnabledAgents() {
      const { data, error } = await db().from("agents").select("*").eq("enabled", true);
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => mapAgentRow(r as Row));
    },

    async updateMissionIf(id, guard, patch) {
      let query = db()
        .from("missions")
        .update({ ...missionPatchToRow(patch), updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("phase", guard.phase);
      query = guard.runId === null ? query.is("run_id", null) : query.eq("run_id", guard.runId);
      if (guard.status) query = query.eq("status", guard.status);
      const { data, error } = await query.select("id");
      if (error) throw new Error(error.message);
      return (data ?? []).length === 1;
    },

    async updateTaskIf(id, guard, patch) {
      let matched = 0;
      const write = async (values: Row) => {
        let query = db()
          .from("mission_tasks")
          .update(values)
          .eq("id", id)
          .eq("stage", guard.stage);
        query = guard.runId === null ? query.is("run_id", null) : query.eq("run_id", guard.runId);
        if (guard.pendingControls !== undefined) query = query.eq("pending_controls", JSON.stringify(guard.pendingControls));
        if (guard.routingStatus !== undefined) {
          query =
            guard.routingStatus === null
              ? query.is("routing_status", null)
              : query.eq("routing_status", guard.routingStatus);
        }
        const { data, error } = await query.select("id");
        matched = (data ?? []).length;
        return { error };
      };
      // A column from a migration that was never run is dropped, not fatal.
      const { error } = await writeDroppingMissing(
        { ...taskPatchToRow(patch), updated_at: new Date().toISOString() },
        OPTIONAL_TASK_COLUMNS,
        write,
        "orchestrator-store",
      );
      if (error) throw new Error(error.message);
      return matched === 1;
    },

    async claimTask(taskId, token) {
      const { data, error } = await db().rpc("neiro_claim_task", {
        p_task_id: taskId,
        p_token: token,
      });
      if (error) throw new Error(error.message);
      return data === true;
    },

    async insertTasks(rows) {
      if (rows.length === 0) return;
      const { error } = await db()
        .from("mission_tasks")
        .upsert(
          rows.map((t) => ({
            id: t.id,
            mission_id: t.missionId,
            task_key: t.taskKey,
            title: t.title,
            stage: "Queued",
            agent_name: t.agentName,
            model: t.model,
            tokens: 0,
            depends: t.depends,
            approval: false,
            retries: 0,
            result: t.result,
          })),
          { onConflict: "mission_id,task_key", ignoreDuplicates: true },
        );
      if (error) throw new Error(error.message);
    },

    async insertArtifactOnce(row) {
      const base = {
        id: crypto.randomUUID(),
        mission_id: row.missionId,
        task_id: row.taskId ?? null,
        title: row.title,
        kind: row.kind,
        content: row.content,
        dedupe_key: row.dedupeKey,
      };
      const write = (values: Row) =>
        db().from("mission_artifacts").upsert(values, { onConflict: "dedupe_key", ignoreDuplicates: true });
      const run = row.runId ? { run_id: row.runId, run_started_at: row.runStartedAt ?? null } : {};
      let { error } = await write({ ...base, ...run });
      // Before 20261031000100_artifact_run.sql those columns are missing; still save the artifact.
      if (error && row.runId && (error.code === "PGRST204" || error.code === "42703")) ({ error } = await write(base));
      if (error) throw new Error(error.message);
    },

    async claimAutoApproval(runId, requestId) {
      const { data, error } = await db().from("auto_approval_claims")
        .upsert({ run_id: runId, request_id: requestId }, { onConflict: "run_id,request_id", ignoreDuplicates: true })
        .select("run_id");
      if (error) throw new Error(error.message);
      return Boolean(data?.length);
    },

    async recordTokenUsage(row) {
      const base = {
        run_id: row.runId,
        mission_id: row.missionId,
        task_id: row.taskId,
        agent_id: row.agentId,
        agent_name: row.agentName,
        stage: row.stage,
        tokens: Math.max(0, Math.round(row.tokens)),
      };
      const write = async (values: Row) =>
        await db().from("agent_token_usage").upsert(values, { onConflict: "run_id", ignoreDuplicates: true });
      const split = {
        ...(row.inputTokens !== undefined ? { input_tokens: row.inputTokens } : {}),
        ...(row.outputTokens !== undefined ? { output_tokens: row.outputTokens } : {}),
        ...(row.cacheReadTokens !== undefined ? { cache_read_tokens: row.cacheReadTokens } : {}),
      };
      // Columns from later migrations are dropped if missing; the tokens always land.
      const { error } = await writeDroppingMissing(
        { ...base, model: row.model ?? null, runtime: row.runtime ?? null, cost_usd: row.costUsd ?? null, ...split },
        ["model", "runtime", "input_tokens", "output_tokens", "cache_read_tokens", "cost_usd"],
        write,
        "token-usage",
      );
      if (error) throw new Error(error.message);
    },

    async agentMissionTokens(missionId, agentId) {
      const { data, error } = await db()
        .from("agent_token_usage")
        .select("tokens")
        .eq("mission_id", missionId)
        .eq("agent_id", agentId)
        .limit(10_000);
      if (error) return null;
      return (data ?? []).reduce((sum, r) => sum + (Number((r as Row).tokens) || 0), 0);
    },

    async setMissionError(id, message) {
      const { error } = await db()
        .from("missions")
        .update({
          last_error: message,
          last_error_at: message === null ? null : new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
  };
}
