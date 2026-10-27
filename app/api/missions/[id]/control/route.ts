import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { advanceMission } from "@/lib/orchestrator";
import { AppConfigError } from "@/lib/types";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const body = await request.json();
    const action = body?.action;

    if (!action || !["approve_plan", "cancel", "resume"].includes(action)) {
      return NextResponse.json(
        { error: "Invalid action. Expected 'approve_plan', 'cancel', or 'resume'" },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    if (action === "cancel") {
      const { data, error } = await supabase
        .from("missions")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .maybeSingle();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json({ ok: true, mission: data }, { status: 200 });
    }

    if (action === "approve_plan") {
      const { data, error } = await supabase
        .from("missions")
        .update({ status: "running", updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .maybeSingle();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      try {
        await advanceMission(id);
      } catch {
        // Handled by background runner
      }

      return NextResponse.json({ ok: true, mission: data }, { status: 200 });
    }

    if (action === "resume") {
      const { data, error } = await supabase
        .from("missions")
        .update({ status: "running", updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .maybeSingle();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      try {
        await advanceMission(id);
      } catch {
        // Handled by background runner
      }

      return NextResponse.json({ ok: true, mission: data }, { status: 200 });
    }

    return NextResponse.json({ error: "Unhandled action" }, { status: 400 });
  } catch (err: unknown) {
    if (err instanceof AppConfigError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 503 }
      );
    }
    const message = err instanceof Error ? err.message : "Failed to execute mission control action";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
