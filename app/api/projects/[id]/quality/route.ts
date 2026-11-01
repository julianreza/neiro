import { NextResponse } from "next/server";
import { connection } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { mapArtifactRow, mapMissionRow, mapTaskRow } from "@/lib/orchestrator-store";
import { missionResult } from "@/lib/mission-result";
import { readCountedPages } from "@/lib/counted-pages";
import { buildProjectQuality } from "@/lib/project-quality";
import type { MissionDetailDTO } from "@/lib/types";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
  try {
    const db = getSupabaseAdmin();
    const now = Date.now();
    const since = new Date(now - 30 * 86400000).toISOString();
    const until = new Date(now).toISOString();
    const missions = await readCountedPages((from, to) => db.from("missions").select("*", { count: "exact" }).eq("project_id", id).eq("status", "completed").gte("completed_at", since).lte("completed_at", until).order("completed_at", { ascending: false }).order("id").range(from, to));
    const { count: missingDates, error: missingError } = await db.from("missions").select("id", { count: "exact", head: true }).eq("project_id", id).eq("status", "completed").is("completed_at", null);
    if (missingError) throw missingError;
    if (missingDates === null) throw new Error("Completion history count is unavailable.");
    const results = [];
    for (let i = 0; i < missions.length; i += 50) {
      const batch = missions.slice(i, i + 50).map(mapMissionRow);
      const ids = batch.map((mission) => mission.id);
      const [tasks, artifacts] = await Promise.all([
        readCountedPages((from, to) => db.from("mission_tasks").select("*", { count: "exact" }).in("mission_id", ids).order("id").range(from, to)),
        readCountedPages((from, to) => db.from("mission_artifacts").select("*", { count: "exact" }).in("mission_id", ids).in("kind", ["qa_report", "gate_skipped"]).order("id").range(from, to)),
      ]);
      for (const mission of batch) {
        results.push(missionResult({ ...mission, tasks: tasks.filter((row) => row.mission_id === mission.id).map(mapTaskRow), artifacts: artifacts.filter((row) => row.mission_id === mission.id).map(mapArtifactRow) } as MissionDetailDTO));
      }
    }
    return NextResponse.json({ quality: buildProjectQuality(results, missingDates) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : typeof err === "object" && err && "message" in err ? String(err.message) : "Could not load project quality";
    return NextResponse.json({ error: /completed_at/.test(message) ? "Apply migration 20261101000100_mission_completion.sql to see quality metrics." : message }, { status: 503 });
  }
}
