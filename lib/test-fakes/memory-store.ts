/**
 * In-memory OrchestratorStore for engine tests. Not imported by app code.
 *
 * Every method yields one microtask before touching state, then runs its body
 * synchronously. That mirrors Postgres: each call is one atomic statement, and
 * two concurrent advanceMission() calls interleave between statements exactly
 * where they would against the real database.
 */
import type {
  NewArtifactRow,
  NewTaskRow,
  OrchestratorStore,
  MissionGuard,
  MissionPatch,
  TaskGuard,
  TaskPatch,
} from "../orchestrator-store";
import type {
  Agent,
  AgentStage,
  Mission,
  MissionArtifact,
  MissionDetailDTO,
  MissionTask,
} from "../types";

const yieldTick = () => Promise.resolve();

const ACTIVE_STAGES = new Set(["Coding", "QA check", "Final review"]);
const CLAIMABLE_STAGES = new Set(["Queued", "Routed"]);

export class MemoryStore implements OrchestratorStore {
  missions = new Map<string, Mission>();
  tasks = new Map<string, MissionTask>();
  artifacts: MissionArtifact[] = [];
  agents: Agent[] = [];
  private seq = 0;

  /* ---------- seeding helpers ---------- */

  seedAgent(stage: AgentStage, id = `${stage}-agent`, specialty = "fullstack"): Agent {
    const agent: Agent = {
      id,
      name: id,
      role: stage,
      stage,
      specialty,
      model: "test-model",
      profile: "default",
      prompt: "",
      url: "http://hermes.test",
      key_enc: null,
      enabled: true,
      activeRun: false,
    };
    this.agents.push(agent);
    return agent;
  }

  seedMission(partial: Partial<Mission> = {}): Mission {
    const mission: Mission = {
      id: partial.id ?? `mission-${++this.seq}`,
      title: "Test mission",
      prompt: "Build the thing",
      status: "running",
      phase: "planning",
      pauseAfterPlanning: false,
      maxParallelWorkers: 3,
      maxRetries: 2,
      workspacePath: null,
      runId: null,
      runAgentId: null,
      runStartedAt: null,
      lastError: null,
      lastErrorAt: null,
      ...partial,
    };
    this.missions.set(mission.id, mission);
    return mission;
  }

  seedTask(missionId: string, partial: Partial<MissionTask> = {}): MissionTask {
    const id = partial.id ?? `task-${++this.seq}`;
    const task: MissionTask = {
      id,
      missionId,
      title: `Task ${id}`,
      stage: "Queued",
      agentId: null,
      agentName: "",
      model: "",
      tokens: 0,
      depends: [],
      approval: false,
      retries: 0,
      result: null,
      taskKey: null,
      runId: null,
      runAgentId: null,
      runStartedAt: null,
      resultOutput: null,
      routingStatus: null,
      layaAgentId: null,
      humanAgentId: null,
      routeUrgency: null,
      routeNeedsHuman: null,
      routeConfidence: null,
      routeReason: null,
      routedAt: null,
      ...partial,
    };
    this.tasks.set(id, task);
    return task;
  }

  tasksOf(missionId: string): MissionTask[] {
    return [...this.tasks.values()].filter((t) => t.missionId === missionId);
  }

  artifactsOf(missionId: string, kind?: string): MissionArtifact[] {
    return this.artifacts.filter((a) => a.missionId === missionId && (!kind || a.kind === kind));
  }

  /* ---------- OrchestratorStore ---------- */

  async getMissionDetail(missionId: string): Promise<MissionDetailDTO> {
    await yieldTick();
    const mission = this.missions.get(missionId);
    if (!mission) throw new Error(`Mission ${missionId} not found`);
    return structuredClone({
      ...mission,
      tasks: this.tasksOf(missionId),
      artifacts: this.artifactsOf(missionId),
    });
  }

  async listActiveMissionIds(): Promise<string[]> {
    await yieldTick();
    return [...this.missions.values()].filter((m) => m.status === "running").map((m) => m.id);
  }

  async listEnabledAgents(stage: AgentStage): Promise<Agent[]> {
    await yieldTick();
    return structuredClone(this.agents.filter((a) => a.enabled && a.stage === stage));
  }

  async listAllEnabledAgents(): Promise<Agent[]> {
    await yieldTick();
    return structuredClone(this.agents.filter((a) => a.enabled));
  }

  async updateMissionIf(id: string, guard: MissionGuard, patch: MissionPatch): Promise<boolean> {
    await yieldTick();
    const m = this.missions.get(id);
    if (!m || m.phase !== guard.phase || m.runId !== guard.runId) return false;
    if (guard.status && m.status !== guard.status) return false;
    Object.assign(m, patch);
    return true;
  }

  async updateTaskIf(id: string, guard: TaskGuard, patch: TaskPatch): Promise<boolean> {
    await yieldTick();
    const t = this.tasks.get(id);
    if (!t || t.stage !== guard.stage || t.runId !== guard.runId) return false;
    if (guard.routingStatus !== undefined && (t.routingStatus ?? null) !== guard.routingStatus) {
      return false;
    }
    Object.assign(t, patch);
    return true;
  }

  /** Mirrors the neiro_claim_task SQL function. */
  async claimTask(taskId: string, token: string): Promise<boolean> {
    await yieldTick();
    const task = this.tasks.get(taskId);
    if (!task) return false;
    const mission = this.missions.get(task.missionId);
    if (!mission) return false;
    const active = this.tasksOf(task.missionId).filter(
      (t) => ACTIVE_STAGES.has(t.stage) || t.runId !== null,
    ).length;
    if (active >= mission.maxParallelWorkers) return false;
    // 'Awaiting routing' is never claimable: the human gate must approve first.
    if (!CLAIMABLE_STAGES.has(task.stage) || task.runId !== null) return false;
    task.stage = "Coding";
    task.runId = token;
    task.runStartedAt = new Date().toISOString();
    return true;
  }

  async insertTasks(rows: NewTaskRow[]): Promise<void> {
    await yieldTick();
    for (const row of rows) {
      const exists = this.tasksOf(row.missionId).some((t) => t.taskKey === row.taskKey);
      if (exists) continue; // ON CONFLICT (mission_id, task_key) DO NOTHING
      this.seedTask(row.missionId, {
        id: row.id,
        taskKey: row.taskKey,
        title: row.title,
        agentName: row.agentName,
        model: row.model,
        depends: [...row.depends],
        result: row.result,
      });
    }
  }

  async insertArtifactOnce(row: NewArtifactRow): Promise<void> {
    await yieldTick();
    if (this.artifacts.some((a) => a.dedupeKey === row.dedupeKey)) return;
    this.artifacts.push({
      id: `artifact-${++this.seq}`,
      missionId: row.missionId,
      taskId: row.taskId ?? null,
      title: row.title,
      kind: row.kind,
      content: row.content,
      dedupeKey: row.dedupeKey,
    });
  }

  async setMissionError(id: string, message: string | null): Promise<void> {
    await yieldTick();
    const m = this.missions.get(id);
    if (!m) return;
    m.lastError = message;
    m.lastErrorAt = message === null ? null : new Date().toISOString();
  }
}
