import type { MissionStatus, TaskStage } from "@/lib/types";

/**
 * One list of everything waiting on a human, across all missions.
 * Built from plain rows so it is unit-tested without Supabase.
 */

export type NeedsYouKind = "plan_approval" | "task_failed" | "pick_agent" | "budget" | "mission_error";

export type NeedsYouItem = {
  kind: NeedsYouKind;
  missionId: string;
  missionTitle: string;
  taskId: string | null;
  taskTitle: string | null;
  detail: string;
  since: string | null;
  /** For pick_agent: Laya's choice, used as the default in the picker. */
  suggestedAgentId?: string | null;
};

export type NeedsYouMission = {
  id: string;
  title: string;
  status: MissionStatus;
  lastError: string | null;
  lastErrorAt: string | null;
  updatedAt?: string;
};

export type NeedsYouTask = {
  id: string;
  missionId: string;
  title: string;
  stage: TaskStage;
  retries: number;
  routeReason: string | null;
  layaAgentId?: string | null;
  updatedAt?: string;
};

const ORDER: Record<NeedsYouKind, number> = {
  plan_approval: 0,
  pick_agent: 1,
  budget: 2,
  task_failed: 3,
  mission_error: 4,
};

export function buildNeedsYou(missions: NeedsYouMission[], tasks: NeedsYouTask[]): NeedsYouItem[] {
  const byId = new Map(missions.map((m) => [m.id, m]));
  const items: NeedsYouItem[] = [];

  for (const m of missions) {
    if (m.status === "awaiting_plan_approval") {
      items.push({
        kind: "plan_approval",
        missionId: m.id,
        missionTitle: m.title,
        taskId: null,
        taskTitle: null,
        detail: "The plan is ready. Approve it to start the work.",
        since: m.updatedAt ?? null,
      });
    }
  }

  const budgetMissions = new Set<string>();
  for (const t of tasks) {
    const m = byId.get(t.missionId);
    if (!m || m.status === "cancelled" || m.status === "completed") continue;
    if (t.stage === "Awaiting routing") {
      items.push({
        kind: "pick_agent",
        missionId: m.id,
        missionTitle: m.title,
        taskId: t.id,
        taskTitle: t.title,
        detail: t.routeReason ?? "Laya wants a human to choose the agent.",
        since: t.updatedAt ?? null,
        suggestedAgentId: t.layaAgentId ?? null,
      });
    } else if (t.stage === "Needs you") {
      const budget = /token budget/i.test(m.lastError ?? "");
      if (budget) budgetMissions.add(m.id);
      items.push({
        kind: budget ? "budget" : "task_failed",
        missionId: m.id,
        missionTitle: m.title,
        taskId: t.id,
        taskTitle: t.title,
        detail: budget ? (m.lastError as string) : `Failed after ${t.retries + 1} attempt(s). Retry it or mark it done.`,
        since: t.updatedAt ?? null,
      });
    }
  }

  for (const m of missions) {
    if (m.status !== "running" || !m.lastError || budgetMissions.has(m.id)) continue;
    items.push({
      kind: "mission_error",
      missionId: m.id,
      missionTitle: m.title,
      taskId: null,
      taskTitle: null,
      detail: m.lastError,
      since: m.lastErrorAt,
    });
  }

  return items.sort(
    (a, b) => ORDER[a.kind] - ORDER[b.kind] || String(a.since ?? "").localeCompare(String(b.since ?? ""))
  );
}
