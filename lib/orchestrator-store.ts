import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase";
import { asRuntime, MISSION_MODES } from "@/lib/types";
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
  RoutingStatus,
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
    sessionId: string | null;
  }
>;

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
    runStartedAt: str(row.run_started_at),
    lastError: str(row.last_error),
    lastErrorAt: str(row.last_error_at),
    tokenBudget: num(row.token_budget),
    mode: MISSION_MODES.includes(row.mode as MissionMode) ? (row.mode as MissionMode) : null,
    prUrl: str(row.pr_url),
    prNumber: num(row.pr_number),
    createdAt: str(row.created_at) ?? undefined,
    updatedAt: str(row.updated_at) ?? undefined,
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
    sessionId: str(row.session_id),
    ...mapRouting(row),
    createdAt: str(row.created_at) ?? undefined,
    updatedAt: str(row.updated_at) ?? undefined,
  };
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
  if (patch.sessionId !== undefined) row.session_id = patch.sessionId;
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
      const [mRes, tRes, aRes] = await Promise.all([
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
          .order("created_at", { ascending: true }),
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
      let query = db()
        .from("mission_tasks")
        .update({ ...taskPatchToRow(patch), updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("stage", guard.stage);
      query = guard.runId === null ? query.is("run_id", null) : query.eq("run_id", guard.runId);
      if (guard.routingStatus !== undefined) {
        query =
          guard.routingStatus === null
            ? query.is("routing_status", null)
            : query.eq("routing_status", guard.routingStatus);
      }
      const { data, error } = await query.select("id");
      if (error) throw new Error(error.message);
      return (data ?? []).length === 1;
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
      const { error } = await db()
        .from("mission_artifacts")
        .upsert(
          {
            id: crypto.randomUUID(),
            mission_id: row.missionId,
            task_id: row.taskId ?? null,
            title: row.title,
            kind: row.kind,
            content: row.content,
            dedupe_key: row.dedupeKey,
          },
          { onConflict: "dedupe_key", ignoreDuplicates: true },
        );
      if (error) throw new Error(error.message);
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
      const write = (values: Row) =>
        db().from("agent_token_usage").upsert(values, { onConflict: "run_id", ignoreDuplicates: true });
      let { error } = await write({ ...base, model: row.model ?? null, runtime: row.runtime ?? null });
      // Before the model/runtime migration those columns are missing; still record the tokens.
      if (error && (error.code === "PGRST204" || error.code === "42703")) ({ error } = await write(base));
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
