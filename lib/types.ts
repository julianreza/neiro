export type AppConfigErrorCode =
  | "missing_supabase_env"
  | "public_service_role_key"
  | "missing_hermes_env";

export class AppConfigError extends Error {
  readonly code: AppConfigErrorCode;

  constructor(code: AppConfigErrorCode, message?: string) {
    super(message ?? `Application configuration error: ${code}`);
    this.name = "AppConfigError";
    this.code = code;
  }
}

export type AgentStage =
  | "orchestrator"
  | "spec"
  | "workers"
  | "qa"
  | "reviewer"
  | "scheduled"
  | "ask";

export type Agent = {
  id: string;
  name: string;
  role: string;
  stage: AgentStage;
  specialty: string;
  model: string;
  profile: string;
  prompt: string;
  url: string;
  key_enc?: string | null;
  enabled: boolean;
  activeRun: boolean;
  /** Max tokens this agent may spend in one mission; null = no limit. */
  tokenBudget?: number | null;
  createdAt?: string;
  updatedAt?: string;
};

export type AgentPublic = Omit<Agent, "key_enc">;

export type MissionStatus =
  | "running"
  | "awaiting_plan_approval"
  | "completed"
  | "cancelled";

/** Engine phase, independent of the operator-facing status. */
export type MissionPhase =
  | "planning"
  | "spec"
  | "executing"
  | "summarizing"
  | "done";

export type Mission = {
  id: string;
  title: string;
  prompt: string;
  status: MissionStatus;
  phase: MissionPhase;
  pauseAfterPlanning: boolean;
  maxParallelWorkers: number;
  maxRetries: number;
  workspacePath: string | null;
  /** Branch the mission worktree was cut from (null = repo HEAD at creation). */
  baseBranch: string | null;
  /** Folder the agents work in: the worktree, or workspacePath when not isolated. */
  agentWorkspacePath: string | null;
  /** Mission branch (neiro/<mission>) when the workspace is a git worktree. */
  workBranch: string | null;
  worktreePath: string | null;
  repoRoot: string | null;
  /** Project (row in `projects`) this mission ran in; null before linking. */
  projectId?: string | null;
  /** Active Hermes run id, or a `claim:<uuid>` token while a run is being started. */
  runId: string | null;
  runAgentId: string | null;
  runStartedAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  /** Max tokens all tasks in this mission may use; null = no limit. */
  tokenBudget?: number | null;
  createdAt?: string;
  updatedAt?: string;
};

export type TaskStage =
  | "Queued"
  | "Awaiting routing"
  | "Routed"
  | "Coding"
  | "QA check"
  | "Final review"
  | "Needs you"
  | "Done";

/**
 * Task router (Laya) state. `null` = not routed yet; `routing` = a tick holds
 * the routing lock; the rest record how the agent was chosen.
 */
export type RoutingStatus =
  | "routing"
  | "routed"
  | "awaiting"
  | "fallback"
  | "approved"
  | "overridden";

/** Router fields on a task; all null until the router has looked at it. */
export type TaskRouting = {
  routingStatus: RoutingStatus | null;
  /** Laya's original pick; never overwritten. */
  layaAgentId: string | null;
  /** Operator's pick on "Ganti agen". */
  humanAgentId: string | null;
  /** 0 = low, 1 = medium, 2 = high. */
  routeUrgency: number | null;
  routeNeedsHuman: boolean | null;
  /** Laya's confidence in its agent_id answer, 0-1. */
  routeConfidence: number | null;
  /** Why the task is at the human gate, or the fallback error. */
  routeReason: string | null;
  routedAt: string | null;
};

/** Store-backed task: routing fields are always present (`null` until routed). */
export type MissionTask = TaskRouting & {
  id: string;
  missionId: string;
  title: string;
  stage: TaskStage;
  agentId?: string | null;
  agentName: string;
  model: string;
  tokens: number;
  depends: string[];
  approval: boolean;
  retries: number;
  result?: string | null;
  /** Planner key (e.g. "T1"); `depends` entries refer to these keys. Null on legacy rows. */
  taskKey: string | null;
  /** Active Hermes run id, or a `claim:<uuid>` token while a run is being started. */
  runId: string | null;
  runAgentId: string | null;
  runStartedAt: string | null;
  /** Output of the completed coding run. */
  resultOutput: string | null;
  /** Hermes session of the task's coding runs; reused on every retry. */
  sessionId: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type MissionArtifact = {
  id: string;
  missionId: string;
  taskId?: string | null;
  title: string;
  kind: string;
  content: string;
  dedupeKey: string | null;
  createdAt?: string;
};

export type MissionDetailDTO = Mission & {
  tasks: MissionTask[];
  artifacts: MissionArtifact[];
};

export type MissionSummaryDTO = Mission & {
  totalTasks: number;
  completedTasks: number;
  totalTokens: number;
};

export type GatewayServiceStatus = {
  name: string;
  status: "connected" | "degraded" | "disconnected";
  latencyMs?: number;
  detail?: string;
  error?: string;
};

export type GatewayConfiguredFlags = {
  supabase: boolean;
  hermes: boolean;
};

export type GatewayCronStatus = {
  lastTickAt: string | null;
  healthy: boolean;
};

export type GatewayProbeResult = {
  ok: boolean;
  latencyMs: number;
  error?: string;
};

export type AgentHealth = GatewayProbeResult & {
  agentId: string;
  name: string;
};

export type GatewayStatusDTO = {
  configured: GatewayConfiguredFlags;
  cron: GatewayCronStatus;
  supabase: GatewayServiceStatus;
  hermes: GatewayServiceStatus;
  defaultHermes: GatewayProbeResult;
  agentsHealth: AgentHealth[];
  checkedAt: string;
};
