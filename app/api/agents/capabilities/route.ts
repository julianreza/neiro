import { NextResponse } from "next/server";
import { connection } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getCapabilities, getInventory } from "@/lib/agent-runtime";
import { capabilitiesDTO } from "@/lib/agent-capabilities";
import { mapAgentRow } from "@/lib/orchestrator-store";
import { AppConfigError, asRuntime } from "@/lib/types";

const AGENT_ID = /^[A-Za-z0-9_-]{1,100}$/;

/** GET /api/agents/capabilities?agentId= : skills, toolsets (core + MCP) and server feature flags. */
export async function GET(request: NextRequest) {
  await connection();
  const agentId = request.nextUrl.searchParams.get("agentId") ?? "";
  if (!AGENT_ID.test(agentId)) {
    return NextResponse.json({ error: "agentId is required" }, { status: 400 });
  }
  try {
    const { data, error } = await getSupabaseAdmin().from("agents").select("*").eq("id", agentId).maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    const agent = mapAgentRow(data);
    if (asRuntime(agent.runtime) !== "hermes") {
      return NextResponse.json(
        { error: "Skills and toolsets belong to Hermes agents.", ...capabilitiesDTO({ available: false, features: {}, endpoints: {} }, { skills: [], toolsets: [] }) },
        { status: 409 },
      );
    }
    const [caps, inventory] = await Promise.all([getCapabilities(agent), getInventory(agent)]);
    return NextResponse.json(capabilitiesDTO(caps, inventory));
  } catch (err: unknown) {
    if (err instanceof AppConfigError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 503 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to read capabilities" }, { status: 500 });
  }
}
