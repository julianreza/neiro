import { NextResponse } from "next/server";
import { connection } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildDashboard } from "@/lib/dashboard";
import type { PipeTask } from "@/lib/dashboard";
import { AppConfigError } from "@/lib/types";
import type { MissionPhase, MissionStatus, TaskStage } from "@/lib/types";

const TASK_COLUMNS = "id, mission_id, title, stage, tokens, updated_at";
const RECENT_LIMIT = 300;

function toTask(r: Record<string, unknown>): PipeTask {
  return {
    id: String(r.id),
    missionId: String(r.mission_id),
    title: String(r.title ?? ""),
    stage: r.stage as TaskStage,
    updatedAt: typeof r.updated_at === "string" ? r.updated_at : null,
    tokens: Number(r.tokens) || 0,
  };
}

/** The Dashboard: pipe, active missions, activity feed and recent tokens. */
export async function GET() {
  await connection();
  try {
    const db = getSupabaseAdmin();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const missionsRes = await db
      .from("missions")
      .select("id, title, status, phase")
      .in("status", ["running", "awaiting_plan_approval"])
      .order("updated_at", { ascending: false });
    if (missionsRes.error) return NextResponse.json({ error: missionsRes.error.message }, { status: 500 });

    const missions = (missionsRes.data ?? []).map((r) => ({
      id: String(r.id),
      title: String(r.title ?? ""),
      status: r.status as MissionStatus,
      phase: r.phase as MissionPhase,
    }));
    const openIds = missions.map((m) => m.id);

    const [openTasks, recentTasks] = await Promise.all([
      openIds.length === 0
        ? Promise.resolve({ data: [], error: null })
        : db.from("mission_tasks").select(TASK_COLUMNS).in("mission_id", openIds),
      db
        .from("mission_tasks")
        .select(TASK_COLUMNS)
        .gte("updated_at", since)
        .order("updated_at", { ascending: false })
        .limit(RECENT_LIMIT),
    ]);
    if (openTasks.error) return NextResponse.json({ error: openTasks.error.message }, { status: 500 });
    if (recentTasks.error) return NextResponse.json({ error: recentTasks.error.message }, { status: 500 });

    // A task can be both open and recent; count it once.
    const tasks = new Map<string, PipeTask>();
    for (const row of [...(openTasks.data ?? []), ...(recentTasks.data ?? [])]) {
      const task = toTask(row as Record<string, unknown>);
      tasks.set(task.id, task);
    }

    return NextResponse.json(buildDashboard(missions, [...tasks.values()]), { status: 200 });
  } catch (err: unknown) {
    if (err instanceof AppConfigError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 503 });
    }
    const message = err instanceof Error ? err.message : "Failed to load the dashboard";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
