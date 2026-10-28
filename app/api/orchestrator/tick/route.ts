import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { dashboardSecretProblem, isAuthorizedRequest } from "@/lib/auth";
import { advanceMission } from "@/lib/orchestrator";
import { recordTickHeartbeat, runTick } from "@/lib/tick";
import { AppConfigError } from "@/lib/types";

export async function POST(request: NextRequest) {
  const secretProblem = dashboardSecretProblem();
  if (secretProblem) {
    return NextResponse.json(
      { error: secretProblem, code: "weak_dashboard_secret" },
      { status: 503 }
    );
  }

  const authorized = await isAuthorizedRequest(request);
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { missionId } = body || {};

    if (missionId && typeof missionId === "string") {
      await recordTickHeartbeat();
      const result = await advanceMission(missionId);
      return NextResponse.json({ ok: true, mission: result }, { status: 200 });
    }

    const { advancedCount, errors, tickedAt } = await runTick();

    return NextResponse.json(
      {
        ok: true,
        advancedCount,
        errors,
        tickedAt,
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
