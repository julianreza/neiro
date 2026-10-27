import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  updateHermesScheduledJob,
  deleteHermesScheduledJob,
  triggerHermesScheduledJob,
} from "@/lib/hermes";
import { AppConfigError } from "@/lib/types";

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { jobId } = await context.params;

  try {
    const body = await request.json();
    const job = await updateHermesScheduledJob(jobId, body);
    return NextResponse.json({ job }, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof AppConfigError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 503 }
      );
    }
    const message = err instanceof Error ? err.message : "Failed to update scheduled job";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { jobId } = await context.params;

  try {
    const success = await deleteHermesScheduledJob(jobId);
    return NextResponse.json({ ok: success }, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof AppConfigError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 503 }
      );
    }
    const message = err instanceof Error ? err.message : "Failed to delete scheduled job";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { jobId } = await context.params;

  try {
    const body = await request.json().catch(() => ({}));
    const action = body?.action || "run";

    if (!["run", "pause", "resume"].includes(action)) {
      return NextResponse.json(
        { error: "Invalid action. Expected 'run', 'pause', or 'resume'" },
        { status: 400 }
      );
    }

    const result = await triggerHermesScheduledJob(jobId, action);
    return NextResponse.json({ ok: true, result }, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof AppConfigError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 503 }
      );
    }
    const message = err instanceof Error ? err.message : "Failed to trigger scheduled job";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
