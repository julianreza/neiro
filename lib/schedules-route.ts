import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { mapAgentRow } from "@/lib/orchestrator-store";
import { AppConfigError } from "@/lib/types";
import type { Agent } from "@/lib/types";

const AGENT_ID = /^[A-Za-z0-9_-]{1,100}$/;

/** The agent whose Hermes profile owns a schedule. Null id = the default profile. */
export async function agentForSchedule(agentId: unknown): Promise<Agent | undefined | NextResponse> {
  if (agentId === undefined || agentId === null || agentId === "") return undefined;
  if (typeof agentId !== "string" || !AGENT_ID.test(agentId)) {
    return NextResponse.json({ error: "Invalid agentId" }, { status: 400 });
  }
  const { data, error } = await getSupabaseAdmin().from("agents").select("*").eq("id", agentId).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  return mapAgentRow(data);
}

/** Changes are for admins. The proxy already enforces it; this guards direct calls too. */
export function requireAdmin(request: NextRequest): NextResponse | null {
  const role = request.headers.get("x-neiro-role");
  return role && role !== "admin" ? NextResponse.json({ error: "Only an admin can change schedules" }, { status: 403 }) : null;
}

export function scheduleError(err: unknown, fallback: string): NextResponse {
  if (err instanceof AppConfigError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: 503 });
  }
  return NextResponse.json({ error: err instanceof Error ? err.message : fallback }, { status: 500 });
}
