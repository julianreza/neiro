import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { mapAgentRow } from "@/lib/orchestrator-store";
import { AppConfigError, UnsupportedRuntimeError } from "@/lib/types";
import type { Agent } from "@/lib/types";

const AGENT_ID = /^[A-Za-z0-9_-]{1,100}$/;

/** The enabled agent behind a /api/bots/<agentId> route, or the error to send. */
export async function botAgent(supabase: SupabaseClient, agentId: string): Promise<Agent | NextResponse> {
  if (!AGENT_ID.test(agentId)) return NextResponse.json({ error: "Invalid bot id" }, { status: 400 });
  const { data, error } = await supabase.from("agents").select("*").eq("id", agentId).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.enabled === false) return NextResponse.json({ error: "Bot not found" }, { status: 404 });
  return mapAgentRow(data);
}

export function botError(err: unknown, fallback: string): NextResponse {
  if (err instanceof AppConfigError) return NextResponse.json({ error: err.message, code: err.code }, { status: 503 });
  if (err instanceof UnsupportedRuntimeError) return NextResponse.json({ error: err.message }, { status: 409 });
  const message = err instanceof Error ? err.message : fallback;
  // canonical_session_id is new in 20261031000000_hermes_full_suite.sql.
  if (/canonical_session_id/.test(message)) {
    return NextResponse.json(
      { error: "Run supabase/migrations/20261031000000_hermes_full_suite.sql in Supabase first." },
      { status: 409 },
    );
  }
  return NextResponse.json({ error: message }, { status: 500 });
}
