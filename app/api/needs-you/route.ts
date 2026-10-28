import { NextResponse } from "next/server";
import { connection } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildNeedsYou } from "@/lib/needs-you";
import { AppConfigError } from "@/lib/types";
import type { MissionStatus, TaskStage } from "@/lib/types";

/** Everything across all missions that is waiting on a human. */
export async function GET() {
  await connection();
  try {
    const db = getSupabaseAdmin();
    const [missionsRes, tasksRes] = await Promise.all([
      db
        .from("missions")
        .select("id, title, status, last_error, last_error_at, updated_at")
        .in("status", ["running", "awaiting_plan_approval"]),
      db
        .from("mission_tasks")
        .select("id, mission_id, title, stage, retries, route_reason, updated_at")
        .in("stage", ["Needs you", "Awaiting routing"]),
    ]);
    if (missionsRes.error) return NextResponse.json({ error: missionsRes.error.message }, { status: 500 });
    if (tasksRes.error) return NextResponse.json({ error: tasksRes.error.message }, { status: 500 });

    const items = buildNeedsYou(
      (missionsRes.data ?? []).map((r) => ({
        id: String(r.id),
        title: String(r.title ?? ""),
        status: r.status as MissionStatus,
        lastError: typeof r.last_error === "string" ? r.last_error : null,
        lastErrorAt: typeof r.last_error_at === "string" ? r.last_error_at : null,
        updatedAt: typeof r.updated_at === "string" ? r.updated_at : undefined,
      })),
      (tasksRes.data ?? []).map((r) => ({
        id: String(r.id),
        missionId: String(r.mission_id),
        title: String(r.title ?? ""),
        stage: r.stage as TaskStage,
        retries: Number(r.retries ?? 0),
        routeReason: typeof r.route_reason === "string" ? r.route_reason : null,
        updatedAt: typeof r.updated_at === "string" ? r.updated_at : undefined,
      }))
    );
    return NextResponse.json({ items, count: items.length }, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof AppConfigError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 503 });
    }
    const message = err instanceof Error ? err.message : "Failed to load Needs you";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
