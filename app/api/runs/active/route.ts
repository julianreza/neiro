import { NextResponse } from "next/server";
import { connection } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { AppConfigError } from "@/lib/types";

export type ActiveRunDTO = {
  missionId: string;
  missionTitle: string;
  taskId: string;
  taskTitle: string;
  stage: string;
  runId: string;
  agentId: string | null;
  agentName: string;
  tokens: number;
  startedAt: string | null;
  needsApproval: boolean;
};

/** Task runs that are live right now (claims still starting are left out). */
export async function GET() {
  await connection();
  try {
    const db = getSupabaseAdmin();
    const { data: tasks, error } = await db
      .from("mission_tasks")
      .select("id, mission_id, title, stage, run_id, run_agent_id, agent_id, agent_name, tokens, run_started_at, approval")
      .not("run_id", "is", null)
      .not("run_id", "like", "claim:%")
      .in("stage", ["Coding", "QA check", "Final review"])
      .order("run_started_at", { ascending: false })
      .limit(50);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const missionIds = [...new Set((tasks ?? []).map((t) => String(t.mission_id)))];
    const titles = new Map<string, string>();
    if (missionIds.length > 0) {
      const { data: missions, error: mErr } = await db.from("missions").select("id, title").in("id", missionIds);
      if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });
      for (const m of missions ?? []) titles.set(String(m.id), String(m.title ?? ""));
    }

    const runs: ActiveRunDTO[] = (tasks ?? []).map((t) => ({
      missionId: String(t.mission_id),
      missionTitle: titles.get(String(t.mission_id)) ?? "",
      taskId: String(t.id),
      taskTitle: String(t.title ?? ""),
      stage: String(t.stage),
      runId: String(t.run_id),
      agentId: (t.run_agent_id ?? t.agent_id ?? null) as string | null,
      agentName: String(t.agent_name ?? ""),
      tokens: Number(t.tokens ?? 0),
      startedAt: (t.run_started_at ?? null) as string | null,
      needsApproval: Boolean(t.approval),
    }));
    return NextResponse.json({ runs }, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof AppConfigError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 503 });
    }
    const message = err instanceof Error ? err.message : "Failed to load runs";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
