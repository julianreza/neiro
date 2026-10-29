import { NextResponse } from "next/server";
import { connection } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getHermesRun, stopHermesRun } from "@/lib/hermes";
import { mapAgentRow } from "@/lib/orchestrator-store";
import { recordAskResult, recordAskStopped } from "@/lib/ask-history";
import { AppConfigError } from "@/lib/types";
import type { Agent } from "@/lib/types";

type RouteContext = {
  params: Promise<{ runId: string }>;
};

const ID = /^[A-Za-z0-9_-]{1,100}$/;

async function loadAgent(request: NextRequest): Promise<Agent | NextResponse> {
  const agentId = request.nextUrl.searchParams.get("agentId") ?? "";
  if (!ID.test(agentId)) {
    return NextResponse.json({ error: "agentId is required" }, { status: 400 });
  }
  const { data, error } = await getSupabaseAdmin()
    .from("agents")
    .select("*")
    .eq("id", agentId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  return mapAgentRow(data);
}

function failure(err: unknown, fallback: string) {
  if (err instanceof AppConfigError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: 503 });
  }
  return NextResponse.json({ error: err instanceof Error ? err.message : fallback }, { status: 500 });
}

/** Status and answer of a question started by POST /api/ask. */
export async function GET(request: NextRequest, context: RouteContext) {
  await connection();
  const { runId } = await context.params;
  if (!ID.test(runId)) return NextResponse.json({ error: "Invalid run id" }, { status: 400 });

  try {
    const agent = await loadAgent(request);
    if (agent instanceof NextResponse) return agent;
    const run = await getHermesRun(agent, runId);
    await recordAskResult(getSupabaseAdmin(), runId, run);
    return NextResponse.json({
      status: run.status,
      output: run.output ?? "",
      tokens: run.tokens ?? 0,
      error: run.error ?? null,
    });
  } catch (err: unknown) {
    return failure(err, "Could not read the answer");
  }
}

/** Stop a question that is still running. */
export async function DELETE(request: NextRequest, context: RouteContext) {
  await connection();
  const { runId } = await context.params;
  if (!ID.test(runId)) return NextResponse.json({ error: "Invalid run id" }, { status: 400 });

  try {
    const agent = await loadAgent(request);
    if (agent instanceof NextResponse) return agent;
    const stopped = await stopHermesRun(agent, runId);
    if (stopped) await recordAskStopped(getSupabaseAdmin(), runId);
    return NextResponse.json({ ok: stopped }, { status: stopped ? 200 : 502 });
  } catch (err: unknown) {
    return failure(err, "Could not stop the question");
  }
}
