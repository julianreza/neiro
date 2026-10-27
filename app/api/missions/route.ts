import { NextResponse } from "next/server";
import { connection } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { advanceMission } from "@/lib/orchestrator";
import { AppConfigError } from "@/lib/types";
import type { Mission, MissionSummaryDTO } from "@/lib/types";

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

    const summaries: MissionSummaryDTO[] = (missions || []).map((m: Mission) => {
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
    const body = await request.json();
    const { title, prompt } = body || {};

    if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
      return NextResponse.json({ error: "Missing required mission prompt" }, { status: 400 });
    }

    const missionTitle =
      title && typeof title === "string" && title.trim().length > 0
        ? title.trim()
        : prompt.slice(0, 48).trim() || "Untitled Mission";

    const missionId = `mission-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const supabase = getSupabaseAdmin();

    const { data: newMission, error: createErr } = await supabase
      .from("missions")
      .insert({
        id: missionId,
        title: missionTitle,
        prompt: prompt.trim(),
        status: "running",
      })
      .select()
      .single();

    if (createErr) {
      return NextResponse.json({ error: createErr.message }, { status: 500 });
    }

    // Trigger immediate progression non-blocking / eagerly
    try {
      await advanceMission(missionId);
    } catch {
      // Background progression failure logged or picked up by tick
    }

    return NextResponse.json({ mission: newMission }, { status: 201 });
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
