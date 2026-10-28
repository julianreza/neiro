import { NextResponse } from "next/server";
import { connection } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { mapArtifactRow, mapMissionRow, mapTaskRow } from "@/lib/orchestrator-store";
import { AppConfigError } from "@/lib/types";
import { parseTokenBudget } from "@/lib/budget";
import type { MissionDetailDTO } from "@/lib/types";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/** Change a mission's token budget. `{ token_budget: number | null }`, 0/null = no limit. */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  if (!body || !("token_budget" in body)) {
    return NextResponse.json({ error: "Send token_budget (0 or null = no limit)." }, { status: 400 });
  }
  const budget = parseTokenBudget(body.token_budget, "token_budget");
  if (!budget.ok) return NextResponse.json({ error: budget.error }, { status: 400 });

  try {
    const { data, error } = await getSupabaseAdmin()
      .from("missions")
      .update({ token_budget: budget.value, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error) {
      const hint = /token_budget/.test(error.message)
        ? " Apply supabase/migrations/20261028000300_budgets_notifications.sql first."
        : "";
      return NextResponse.json({ error: error.message + hint }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: "Mission not found" }, { status: 404 });
    return NextResponse.json({ mission: mapMissionRow(data) }, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof AppConfigError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 503 });
    }
    const message = err instanceof Error ? err.message : "Failed to update mission";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(_request: NextRequest, context: RouteContext) {
  await connection();
  const { id } = await context.params;

  try {
    const supabase = getSupabaseAdmin();

    const { data: mission, error: missionErr } = await supabase
      .from("missions")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (missionErr) {
      return NextResponse.json({ error: missionErr.message }, { status: 500 });
    }
    if (!mission) {
      return NextResponse.json({ error: "Mission not found" }, { status: 404 });
    }

    const { data: tasks, error: tasksErr } = await supabase
      .from("mission_tasks")
      .select("*")
      .eq("mission_id", id)
      .order("created_at", { ascending: true });

    if (tasksErr) {
      return NextResponse.json({ error: tasksErr.message }, { status: 500 });
    }

    const { data: artifacts, error: artifactsErr } = await supabase
      .from("mission_artifacts")
      .select("*")
      .eq("mission_id", id)
      .order("created_at", { ascending: true });

    if (artifactsErr) {
      return NextResponse.json({ error: artifactsErr.message }, { status: 500 });
    }

    const detail: MissionDetailDTO = {
      ...mapMissionRow(mission as Record<string, unknown>),
      tasks: (tasks || []).map((t) => mapTaskRow(t as Record<string, unknown>)),
      artifacts: (artifacts || []).map((a) => mapArtifactRow(a as Record<string, unknown>)),
    };

    return NextResponse.json({ mission: detail }, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof AppConfigError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 503 }
      );
    }
    const message = err instanceof Error ? err.message : "Failed to load mission";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const supabase = getSupabaseAdmin();

    const { error } = await supabase
      .from("missions")
      .delete()
      .eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof AppConfigError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 503 }
      );
    }
    const message = err instanceof Error ? err.message : "Failed to delete mission";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
