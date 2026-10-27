import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isAuthorizedRequest } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { advanceActiveMissions, advanceMission } from "@/lib/orchestrator";
import { AppConfigError } from "@/lib/types";

export async function POST(request: NextRequest) {
  const authorized = await isAuthorizedRequest(request);
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = getSupabaseAdmin();

    // Record heartbeat in app_state
    const now = new Date().toISOString();
    await supabase
      .from("app_state")
      .upsert({
        key: "last_cron_tick_at",
        value: { at: now },
        updated_at: now,
      });

    const body = await request.json().catch(() => ({}));
    const { missionId } = body || {};

    if (missionId && typeof missionId === "string") {
      const result = await advanceMission(missionId);
      return NextResponse.json({ ok: true, mission: result }, { status: 200 });
    }

    const { advancedCount, errors } = await advanceActiveMissions();

    return NextResponse.json(
      {
        ok: true,
        advancedCount,
        errors,
        tickedAt: now,
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    if (err instanceof AppConfigError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 503 }
      );
    }
    const message = err instanceof Error ? err.message : "Failed to tick orchestrator";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
