import { NextResponse } from "next/server";
import { connection } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { advanceMission, reportAdvanceError } from "@/lib/orchestrator";
import { mapMissionRow } from "@/lib/orchestrator-store";
import { parseMissionCreateBody } from "@/lib/mission-input";
import { AppConfigError } from "@/lib/types";
import type { MissionSummaryDTO } from "@/lib/types";

export async function GET() {
  await connection();

  try {
    const supabase = getSupabaseAdmin();

    const { data: missions, error: missionsErr } = await supabase
      .from("missions")
      .select("*")
      .order("created_at", { ascending: false });

    if (missionsErr) {
      return NextResponse.json({ error: missionsErr.message }, { status: 500 });
    }

    const { data: tasks, error: tasksErr } = await supabase
      .from("mission_tasks")
      .select("mission_id, stage, tokens");

    if (tasksErr) {
      return NextResponse.json({ error: tasksErr.message }, { status: 500 });
    }

    const statsByMission = new Map<
      string,
      { totalTasks: number; completedTasks: number; totalTokens: number }
    >();

    for (const task of tasks || []) {
      const current = statsByMission.get(task.mission_id) || {
        totalTasks: 0,
        completedTasks: 0,
        totalTokens: 0,
      };
      current.totalTasks += 1;
      if (task.stage === "Done") {
        current.completedTasks += 1;
      }
      current.totalTokens += Number(task.tokens) || 0;
      statsByMission.set(task.mission_id, current);
    }

    const summaries: MissionSummaryDTO[] = (missions || []).map((row: Record<string, unknown>) => {
      const m = mapMissionRow(row);
      const stats = statsByMission.get(m.id) || {
        totalTasks: 0,
        completedTasks: 0,
        totalTokens: 0,
      };
      return {
        ...m,
        totalTasks: stats.totalTasks,
        completedTasks: stats.completedTasks,
        totalTokens: stats.totalTokens,
      };
    });

    return NextResponse.json({ missions: summaries }, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof AppConfigError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 503 }
      );
    }
    const message = err instanceof Error ? err.message : "Failed to load missions";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const parsed = parseMissionCreateBody(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const input = parsed.value;

    const missionId = `mission-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const supabase = getSupabaseAdmin();

    const { data: newMission, error: createErr } = await supabase
      .from("missions")
      .insert({
        id: missionId,
        title: input.title,
        prompt: input.prompt,
        // Always starts running; pause_after_planning stops it after the
        // spec phase (status -> awaiting_plan_approval).
        status: "running",
        phase: "planning",
        pause_after_planning: input.pauseAfterPlanning,
        max_parallel_workers: input.maxParallelWorkers,
        max_retries: input.maxRetries,
        workspace_path: input.workspacePath,
      })
      .select()
      .single();

    if (createErr) {
      return NextResponse.json({ error: createErr.message }, { status: 500 });
    }

    // Start planning eagerly; on failure the next tick retries.
    try {
      await advanceMission(missionId);
    } catch (err: unknown) {
      await reportAdvanceError(missionId, err);
    }

    return NextResponse.json(
      { mission: mapMissionRow(newMission as Record<string, unknown>) },
      { status: 201 },
    );
  } catch (err: unknown) {
    if (err instanceof AppConfigError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 503 }
      );
    }
    const message = err instanceof Error ? err.message : "Failed to create mission";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
