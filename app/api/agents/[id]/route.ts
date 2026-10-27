import { NextResponse } from "next/server";
import { connection } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { AppConfigError } from "@/lib/types";
import type { Agent } from "@/lib/types";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  await connection();
  const { id } = await context.params;

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("agents")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    const publicAgent = { ...data };
    delete publicAgent.key_enc;
    return NextResponse.json({ agent: publicAgent }, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof AppConfigError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 503 }
      );
    }
    const message = err instanceof Error ? err.message : "Failed to load agent";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const body = await request.json();
    const supabase = getSupabaseAdmin();

    const allowedFields: Array<keyof Agent> = [
      "name",
      "role",
      "stage",
      "specialty",
      "model",
      "profile",
      "prompt",
      "url",
      "key_enc",
      "enabled",
      "activeRun",
    ];

    const updates: Record<string, unknown> = {};
    for (const key of allowedFields) {
      if (key in body) {
        if (key === "activeRun") {
          updates.active_run = body[key];
        } else {
          updates[key] = body[key];
        }
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields provided for update" }, { status: 400 });
    }

    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("agents")
      .update(updates)
      .eq("id", id)
      .select()
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    const publicAgent = { ...data };
    delete publicAgent.key_enc;
    return NextResponse.json({ agent: publicAgent }, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof AppConfigError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 503 }
      );
    }
    const message = err instanceof Error ? err.message : "Failed to update agent";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const supabase = getSupabaseAdmin();

    // Check if agent has active runs
    const { data: agentData } = await supabase
      .from("agents")
      .select("active_run")
      .eq("id", id)
      .maybeSingle();

    if (agentData?.active_run) {
      return NextResponse.json(
        { error: "Agent has active runs; stop them first" },
        { status: 409 }
      );
    }

    // Check if any mission_tasks have this agent currently running
    const { data: activeTasks } = await supabase
      .from("mission_tasks")
      .select("id, stage")
      .eq("agent_id", id)
      .in("stage", ["Coding", "QA check", "Final review"])
      .limit(1);

    if (activeTasks && activeTasks.length > 0) {
      return NextResponse.json(
        { error: "Agent has active runs; stop them first" },
        { status: 409 }
      );
    }

    const { error } = await supabase
      .from("agents")
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
    const message = err instanceof Error ? err.message : "Failed to delete agent";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
