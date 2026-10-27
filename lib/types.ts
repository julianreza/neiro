export type AppConfigErrorCode =
  | "missing_supabase_env"
  | "missing_hermes_env"
  | "missing_ninerouter_env";

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
  | "scheduled";

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
  createdAt?: string;
  updatedAt?: string;
};

export type AgentPublic = Omit<Agent, "key_enc">;

export type MissionStatus =
  | "running"
  | "awaiting_plan_approval"
  | "completed"
  | "cancelled";

export type Mission = {
  id: string;
  title: string;
  prompt: string;
  status: MissionStatus;
  createdAt?: string;
  updatedAt?: string;
};

export type TaskStage =
  | "Queued"
  | "Coding"
  | "QA check"
  | "Final review"
  | "Needs you"
  | "Done";

export type MissionTask = {
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

export type GatewayStatusDTO = {
  supabase: GatewayServiceStatus;
  hermes: GatewayServiceStatus;
  nineRouter: GatewayServiceStatus;
  checkedAt: string;
};
