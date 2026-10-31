import { NextResponse } from "next/server";
import { connection } from "next/server";
import type { NextRequest } from "next/server";
import { listHermesScheduledJobs, createHermesScheduledJob } from "@/lib/hermes";
import { getSupabaseAdmin } from "@/lib/supabase";
import { mapAgentRow } from "@/lib/orchestrator-store";
import { listAllSchedules, parseScheduleInput, withBotPrefix } from "@/lib/schedules";
import { agentForSchedule, requireAdmin, scheduleError } from "@/lib/schedules-route";

/**
 * GET ?agentId= : that profile's jobs. Without it: the default profile plus
 * every enabled Hermes agent's profile, each job tagged with agentId/agentName.
 */
export async function GET(request: NextRequest) {
  await connection();
  try {
    const agentId = request.nextUrl.searchParams.get("agentId");
    if (agentId) {
      const agent = await agentForSchedule(agentId);
      if (agent instanceof NextResponse) return agent;
      const jobs = await listHermesScheduledJobs(agent);
      return NextResponse.json({
        jobs: jobs.map((j) => ({ ...j, agentId: agent?.id ?? null, agentName: agent?.name ?? "Default", profile: agent?.profile ?? "default" })),
      });
    }
    const { data, error } = await getSupabaseAdmin().from("agents").select("*").eq("enabled", true);
    // Without the agents table the default profile still lists.
    const agents = error ? [] : (data ?? []).map((r) => mapAgentRow(r));
    const jobs = await listAllSchedules(agents);
    return NextResponse.json({ jobs });
  } catch (err: unknown) {
    return scheduleError(err, "Failed to load scheduled jobs");
  }
}

/** POST { agentId?, name, schedule, prompt, skills?, deliver?, repeat? } */
export async function POST(request: NextRequest) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const parsed = parseScheduleInput(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const agent = await agentForSchedule(body?.agentId);
    if (agent instanceof NextResponse) return agent;
    const job = await createHermesScheduledJob(
      { ...parsed.value, name: withBotPrefix(parsed.value.name ?? "", agent?.profile) },
      agent,
    );
    return NextResponse.json({ job }, { status: 201 });
  } catch (err: unknown) {
    return scheduleError(err, "Failed to create scheduled job");
  }
}
