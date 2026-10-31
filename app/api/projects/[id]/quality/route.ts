import { NextResponse } from "next/server";
import { connection } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { mapArtifactRow, mapMissionRow, mapTaskRow } from "@/lib/orchestrator-store";
import { missionResult } from "@/lib/mission-result";
import type { MissionDetailDTO } from "@/lib/types";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
  try {
    const db = getSupabaseAdmin();
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const missions: Record<string, unknown>[] = [];
    for (let from = 0; ; from += 500) {
      const { data, error } = await db.from("missions").select("*").eq("project_id", id).eq("status", "completed").gte("completed_at", since).order("completed_at", { ascending: false }).order("id").range(from, from + 499);
      if (error) throw error;
      missions.push(...(data ?? []));
      if (!data || data.length < 500) break;
    }
    const { count: missingDates, error: missingError } = await db.from("missions").select("id", { count: "exact", head: true }).eq("project_id", id).eq("status", "completed").is("completed_at", null);
    if (missingError) throw missingError;
    const results = [];
    for (const row of missions) {
      const mission = mapMissionRow(row);
      const all = async (table: string) => {
        const rows: Record<string, unknown>[] = [];
        for (let from = 0; ; from += 500) {
          const { data, error } = await db.from(table).select("*").eq("mission_id", mission.id).order("id").range(from, from + 499);
          if (error) throw error;
          rows.push(...(data ?? []));
          if (!data || data.length < 500) return rows;
        }
      };
      const [tasks, artifacts] = await Promise.all([all("mission_tasks"), all("mission_artifacts")]);
      results.push(missionResult({ ...mission, tasks: tasks.map(mapTaskRow), artifacts: artifacts.map(mapArtifactRow) } as MissionDetailDTO));
    }
    const durations = results.flatMap((r) => r.durationMs === null ? [] : [r.durationMs]).sort((a, b) => a - b);
    const middle = Math.floor(durations.length / 2);
    return NextResponse.json({ quality: { missions: missions.length, medianDurationMs: durations.length ? durations.length % 2 ? durations[middle] : (durations[middle - 1] + durations[middle]) / 2 : null, missingDuration: missions.length - durations.length, missingCompletionDates: missingDates ?? 0, retries: results.reduce((sum, r) => sum + r.retries, 0), qaPassed: results.reduce((sum, r) => sum + r.qaPassed, 0), qaKnown: results.reduce((sum, r) => sum + r.qaKnown, 0), qaUnknown: results.reduce((sum, r) => sum + r.tasks.length - r.qaKnown, 0) } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : typeof err === "object" && err && "message" in err ? String(err.message) : "Could not load project quality";
    return NextResponse.json({ error: /completed_at/.test(message) ? "Apply migration 20261101000100_mission_completion.sql to see quality metrics." : message }, { status: 503 });
  }
}
