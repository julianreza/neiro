import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  updateHermesScheduledJob,
  deleteHermesScheduledJob,
  triggerHermesScheduledJob,
} from "@/lib/hermes";
import { parseScheduleInput, withBotPrefix } from "@/lib/schedules";
import { agentForSchedule, requireAdmin, scheduleError } from "@/lib/schedules-route";

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

const JOB_ID = /^[A-Za-z0-9_.:-]{1,120}$/;

async function jobIdOf(context: RouteContext): Promise<string | NextResponse> {
  const { jobId } = await context.params;
  return JOB_ID.test(jobId) ? jobId : NextResponse.json({ error: "Invalid job id" }, { status: 400 });
}

/** PATCH { agentId?, name?, schedule?, prompt?, skills?, deliver?, repeat? } */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  const jobId = await jobIdOf(context);
  if (jobId instanceof NextResponse) return jobId;
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const parsed = parseScheduleInput(body, true);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    if (Object.keys(parsed.value).length === 0) {
      return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
    }
    const agent = await agentForSchedule(body?.agentId);
    if (agent instanceof NextResponse) return agent;
    const updates = parsed.value.name ? { ...parsed.value, name: withBotPrefix(parsed.value.name, agent?.profile) } : parsed.value;
    const job = await updateHermesScheduledJob(jobId, updates, agent);
    return NextResponse.json({ job }, { status: 200 });
  } catch (err: unknown) {
    return scheduleError(err, "Failed to update scheduled job");
  }
}

/** DELETE ?agentId= */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  const jobId = await jobIdOf(context);
  if (jobId instanceof NextResponse) return jobId;
  try {
    const agent = await agentForSchedule(request.nextUrl.searchParams.get("agentId"));
    if (agent instanceof NextResponse) return agent;
    const success = await deleteHermesScheduledJob(jobId, agent);
    return NextResponse.json({ ok: success }, { status: success ? 200 : 502 });
  } catch (err: unknown) {
    return scheduleError(err, "Failed to delete scheduled job");
  }
}

/** POST { action: "run" | "pause" | "resume", agentId? } */
export async function POST(request: NextRequest, context: RouteContext) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  const jobId = await jobIdOf(context);
  if (jobId instanceof NextResponse) return jobId;
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = body?.action || "run";
    if (action !== "run" && action !== "pause" && action !== "resume") {
      return NextResponse.json({ error: "Invalid action. Expected 'run', 'pause', or 'resume'" }, { status: 400 });
    }
    const agent = await agentForSchedule(body?.agentId);
    if (agent instanceof NextResponse) return agent;
    const result = await triggerHermesScheduledJob(jobId, action, agent);
    return NextResponse.json({ ok: true, result }, { status: 200 });
  } catch (err: unknown) {
    return scheduleError(err, "Failed to trigger scheduled job");
  }
}
