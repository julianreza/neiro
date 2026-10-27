import type { RoutingStatus, TaskStage } from "./types";

export type { TaskStage };
export type DemoTask = {
  id: string;
  title: string;
  stage: TaskStage;
  agent: string;
  model: string;
  tokens: number;
  depends: string[];
  approval?: boolean;
  retries: number;
  /** Task router (Laya) fields; absent when the task was never routed. */
  routingStatus?: RoutingStatus | null;
  layaAgentId?: string | null;
  humanAgentId?: string | null;
  routeUrgency?: number | null;
  routeNeedsHuman?: boolean | null;
  routeConfidence?: number | null;
  routeReason?: string | null;
};
export type DemoMission = {
  id: string;
  title: string;
  prompt: string;
  status: "running" | "awaiting_plan_approval" | "completed" | "cancelled";
  tasks: DemoTask[];
};
export const stages: TaskStage[] = [
  "Queued",
  "Awaiting routing",
  "Routed",
  "Coding",
  "QA check",
  "Final review",
  "Needs you",
  "Done",
];
export const initialMissions: DemoMission[] = [
  {
    id: "mission-01",
    title: "Build a customer feedback portal",
    prompt:
      "Build a customer feedback portal with voting, a public roadmap, and an admin moderation queue.",
    status: "running",
    tasks: [
      {
        id: "T1",
        title: "Define the product requirements and data model",
        stage: "Done",
        agent: "Spec writer",
        model: "claude-sonnet",
        tokens: 18400,
        depends: [],
        retries: 0,
      },
      {
        id: "T2",
        title: "Implement feedback API and vote constraints",
        stage: "Coding",
        agent: "Backend worker",
        model: "gpt-codex",
        tokens: 12800,
        depends: ["T1"],
        retries: 0,
      },
      {
        id: "T3",
        title: "Build the public feedback board",
        stage: "Coding",
        agent: "Frontend worker",
        model: "claude-sonnet",
        tokens: 9200,
        depends: ["T1"],
        retries: 1,
      },
      {
        id: "T4",
        title: "Verify authentication and duplicate voting",
        stage: "QA check",
        agent: "QA inspector",
        model: "gpt-codex",
        tokens: 6400,
        depends: ["T1"],
        retries: 0,
      },
      {
        id: "T5",
        title: "Review accessibility and API boundaries",
        stage: "Final review",
        agent: "Final reviewer",
        model: "claude-sonnet",
        tokens: 3100,
        depends: ["T4"],
        retries: 0,
      },
      {
        id: "T6",
        title: "Approve database migration command",
        stage: "Needs you",
        agent: "Backend worker",
        model: "gpt-codex",
        tokens: 1200,
        depends: ["T2"],
        approval: true,
        retries: 0,
      },
      {
        id: "T7",
        title: "Write deployment notes and release checklist",
        stage: "Queued",
        agent: "Spec writer",
        model: "claude-sonnet",
        tokens: 0,
        depends: ["T2", "T3"],
        retries: 0,
      },
      {
        id: "T8",
        title: "Add rate limiting to the vote endpoint",
        stage: "Routed",
        agent: "Forge Backend",
        model: "GPT-5.4",
        tokens: 0,
        depends: ["T2"],
        retries: 0,
        routingStatus: "routed",
        layaAgentId: "backend-worker",
        routeUrgency: 1,
        routeNeedsHuman: false,
        routeConfidence: 0.91,
      },
      {
        id: "T9",
        title: "Decide data retention for deleted feedback",
        stage: "Awaiting routing",
        agent: "Unassigned",
        model: "",
        tokens: 0,
        depends: ["T1"],
        retries: 0,
        routingStatus: "awaiting",
        layaAgentId: "spec-writer",
        routeUrgency: 2,
        routeNeedsHuman: true,
        routeConfidence: 0.54,
        routeReason: "Keyakinan 0.54 di bawah 0.7; Laya menandai perlu manusia",
      },
    ],
  },
];

export function updateDemoTask(
  mission: DemoMission,
  id: string,
  stage: TaskStage,
): DemoMission {
  const tasks = mission.tasks.map((task) =>
    task.id === id
      ? {
          ...task,
          stage,
          approval: false,
          retries: stage === "Queued" ? task.retries + 1 : task.retries,
        }
      : task,
  );
  return {
    ...mission,
    tasks,
    status: tasks.every((task) => task.stage === "Done")
      ? "completed"
      : "running",
  };
}

/** Agents a human can pick at the routing gate (mirrors the seeded agents). */
export type RouteAgentOption = { id: string; name: string; stage: string; model: string };
export const demoRouteAgents: RouteAgentOption[] = [
  { id: "pm-orchestrator", name: "Neiro PM", stage: "orchestrator", model: "Claude Opus 4.6" },
  { id: "spec-writer", name: "Scribe PRD", stage: "spec", model: "Claude Sonnet 4.6" },
  { id: "backend-worker", name: "Forge Backend", stage: "workers", model: "GPT-5.4" },
  { id: "frontend-worker", name: "Relay Frontend", stage: "workers", model: "Claude Sonnet 4.6" },
  { id: "qa-inspector", name: "Sentinel QA", stage: "qa", model: "GPT-5.4" },
  { id: "lead-reviewer", name: "Lens Reviewer", stage: "reviewer", model: "Claude Opus 4.6" },
];

/** Demo version of the routing gate: approve Laya's pick or take a human one. */
export function routeDemoTask(
  mission: DemoMission,
  id: string,
  agent: RouteAgentOption,
  how: "approved" | "overridden",
): DemoMission {
  return {
    ...mission,
    tasks: mission.tasks.map((task) =>
      task.id === id && task.stage === "Awaiting routing"
        ? {
            ...task,
            stage: "Routed",
            agent: agent.name,
            model: agent.model,
            routingStatus: how,
            humanAgentId: how === "overridden" ? agent.id : (task.humanAgentId ?? null),
          }
        : task,
    ),
  };
}
