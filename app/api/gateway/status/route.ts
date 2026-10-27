import { NextResponse } from "next/server";
import { connection } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getNineRouterStatus } from "@/lib/ninerouter";
import { probeHermesAgent } from "@/lib/hermes";
import { AppConfigError } from "@/lib/types";
import type {
  Agent,
  AgentHealth,
  GatewayConfiguredFlags,
  GatewayCronStatus,
  GatewayProbeResult,
  GatewayStatusDTO,
} from "@/lib/types";

export async function GET() {
  await connection();

  const configured: GatewayConfiguredFlags = {
    // Mirrors getSupabaseAdmin(): only the server-only service-role key counts.
    supabase: Boolean(
      (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) &&
        process.env.SUPABASE_SERVICE_ROLE_KEY,
    ),
    hermes: Boolean(process.env.HERMES_DEFAULT_URL),
    ninerouter: Boolean(process.env.NINEROUTER_URL),
  };

  let supabaseStatus: GatewayStatusDTO["supabase"] = {
    name: "Supabase",
    status: "disconnected",
  };
  let cronStatus: GatewayCronStatus = {
    lastTickAt: null,
    healthy: false,
  };
  let defaultHermesStatus: GatewayProbeResult = {
    ok: false,
    latencyMs: 0,
    error: "HERMES_DEFAULT_URL not set",
  };
  let agentsHealth: AgentHealth[] = [];

  // Check Supabase & Cron Tick
  if (configured.supabase) {
    const t0 = Date.now();
    try {
      const supabase = getSupabaseAdmin();
      const { data: tickRow, error: tickErr } = await supabase
        .from("app_state")
        .select("value, updated_at")
        .eq("key", "last_cron_tick_at")
        .maybeSingle();

      if (tickErr) {
        supabaseStatus = {
          name: "Supabase",
          status: "degraded",
          latencyMs: Date.now() - t0,
          error: tickErr.message,
        };
      } else {
        supabaseStatus = {
          name: "Supabase",
          status: "connected",
          latencyMs: Date.now() - t0,
        };

        if (tickRow?.value) {
          const tickVal = tickRow.value as { at?: string } | string;
          const tickAt = typeof tickVal === "string" ? tickVal : tickVal.at || tickRow.updated_at;
          const tickTime = tickAt ? new Date(tickAt).getTime() : 0;
          const diffSec = (Date.now() - tickTime) / 1000;
          cronStatus = {
            lastTickAt: tickAt || null,
            healthy: diffSec <= 180,
          };
        }
      }

      // Fetch agents for health probes (probe top 6 or all)
      const { data: agentRows } = await supabase
        .from("agents")
        .select("*")
        .eq("enabled", true)
        .limit(10);

      if (agentRows && agentRows.length > 0) {
        const probes = await Promise.all(
          (agentRows as Agent[]).map(async (agent) => {
            try {
              const res = await probeHermesAgent(agent);
              return {
                agentId: agent.id,
                name: agent.name,
                ok: res.ok,
                latencyMs: res.latencyMs,
                error: res.error,
              };
            } catch (err: unknown) {
              const message = err instanceof Error ? err.message : String(err);
              return {
                agentId: agent.id,
                name: agent.name,
                ok: false,
                latencyMs: 0,
                error: message,
              };
            }
          })
        );
        agentsHealth = probes;
      }
    } catch (err: unknown) {
      if (err instanceof AppConfigError) {
        supabaseStatus = {
          name: "Supabase",
          status: "disconnected",
          error: err.message,
        };
      } else {
        const message = err instanceof Error ? err.message : String(err);
        supabaseStatus = {
          name: "Supabase",
          status: "disconnected",
          error: message,
        };
      }
    }
  }

  // Probe NineRouter
  let nineRouterRes: {
    ok: boolean;
    latencyMs: number;
    modelsCount: number;
    error?: string;
  } = {
    ok: false,
    latencyMs: 0,
    modelsCount: 0,
  };
  try {
    nineRouterRes = await getNineRouterStatus();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    nineRouterRes = {
      ok: false,
      latencyMs: 0,
      modelsCount: 0,
      error: message,
    };
  }

  // Probe Default Hermes Agent fallback
  try {
    const dummyDefaultAgent: Agent = {
      id: "default-hermes",
      name: "Default Hermes",
      role: "worker",
      stage: "workers",
      specialty: "",
      model: "",
      profile: "default",
      prompt: "",
      url: process.env.HERMES_DEFAULT_URL || "",
      enabled: true,
      activeRun: false,
    };
    defaultHermesStatus = await probeHermesAgent(dummyDefaultAgent);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    defaultHermesStatus = {
      ok: false,
      latencyMs: 0,
      error: message,
    };
  }

  const hermesStatus: GatewayStatusDTO["hermes"] = {
    name: "Hermes VPS",
    status: defaultHermesStatus.ok ? "connected" : "disconnected",
    latencyMs: defaultHermesStatus.latencyMs,
    error: defaultHermesStatus.error,
  };

  const nineRouterServiceStatus: GatewayStatusDTO["nineRouter"] = {
    name: "9Router",
    status: nineRouterRes.ok ? "connected" : "disconnected",
    latencyMs: nineRouterRes.latencyMs,
    detail: `${nineRouterRes.modelsCount} models`,
    error: nineRouterRes.error,
  };

  const body = {
    configured,
    cron: cronStatus,
    supabase: supabaseStatus,
    hermes: hermesStatus,
    nineRouter: nineRouterServiceStatus,
    defaultHermes: defaultHermesStatus,
    agentsHealth,
    checkedAt: new Date().toISOString(),
  } satisfies GatewayStatusDTO;

  return NextResponse.json(body);
}
