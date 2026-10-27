export type TaskStage =
  "Queued" | "Coding" | "QA check" | "Final review" | "Needs you" | "Done";
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
