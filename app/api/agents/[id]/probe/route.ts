import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { probeHermesAgent, listHermesCapabilitiesInventory } from "@/lib/hermes";
import { listCliRuntime } from "@/lib/cli-runtime";
import { AppConfigError, asRuntime } from "@/lib/types";
import type { Agent } from "@/lib/types";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const supabase = getSupabaseAdmin();
    const { data: agent, error } = await supabase
      .from("agents")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    const typedAgent: Agent = {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      stage: agent.stage,
      specialty: agent.specialty || "",
      model: agent.model || "",
      profile: agent.profile || "default",
      prompt: agent.prompt || "",
      url: agent.url || "",
      key_enc: agent.key_enc,
      enabled: agent.enabled,
      activeRun: agent.active_run ?? false,
    };

    const runtime = asRuntime(agent.runtime);
    if (runtime !== "hermes") {
      const started = Date.now();
      const info = await listCliRuntime(runtime);
      return NextResponse.json(
        {
          ok: info.installed && info.models.length > 0,
          latencyMs: Date.now() - started,
          error: !info.installed
            ? "omp is not installed on this computer."
            : info.models.length === 0
              ? `The CLI answered without models${info.reason ? `: ${info.reason}` : "."}`
              : undefined,
          capabilities: [],
        },
        { status: 200 },
      );
    }

    const probe = await probeHermesAgent(typedAgent);
    let capabilities: string[] = [];
    try {
      capabilities = await listHermesCapabilitiesInventory(typedAgent);
    } catch {
      // capabilities inventory is optional / best-effort
    }

    return NextResponse.json(
      {
        ok: probe.ok,
        latencyMs: probe.latencyMs,
        error: probe.error,
        capabilities,
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
    const message = err instanceof Error ? err.message : "Failed to probe agent";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
