import { NextResponse } from "next/server";
import { connection } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getRun } from "@/lib/agent-runtime";
import { mapAgentRow } from "@/lib/orchestrator-store";
import { normalizeApprovals, type PendingApproval } from "@/lib/approvals";
import { AppConfigError } from "@/lib/types";

type RouteContext = { params: Promise<{ id: string }> };

const WORKING = ["Coding", "QA check", "Final review"];

/**
 * Tool calls waiting for Allow / Deny, per task row id, for the task chat.
 * Answer one with POST /api/missions/<id>/tasks/<taskId>/control
 * { action: "approve_tool" | "deny_tool", requestId }.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  await connection();
  const { id } = await context.params;

  try {
    const supabase = getSupabaseAdmin();
    const { data: tasks, error } = await supabase
      .from("mission_tasks")
      .select("id, stage, run_id, run_agent_id, agent_id")
      .eq("mission_id", id)
      .in("stage", WORKING)
      .not("run_id", "is", null);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // run_id is a `claim:` token while a run is still starting.
    const live = (tasks ?? []).filter((t) => typeof t.run_id === "string" && !t.run_id.startsWith("claim:"));
    const agentIds = [...new Set(live.map((t) => t.run_agent_id ?? t.agent_id).filter(Boolean))];
    const approvals: Record<string, PendingApproval[]> = {};
    if (live.length === 0) return NextResponse.json({ approvals });

    const { data: agents, error: agentErr } = await supabase.from("agents").select("*").in("id", agentIds);
    if (agentErr) return NextResponse.json({ error: agentErr.message }, { status: 500 });
    const byId = new Map((agents ?? []).map((row) => [row.id, mapAgentRow(row)]));

    await Promise.all(
      live.map(async (t) => {
        const agent = byId.get(t.run_agent_id ?? t.agent_id);
        if (!agent) return;
        try {
          const list = normalizeApprovals((await getRun(agent, t.run_id)).pending_controls);
          if (list.length > 0) approvals[t.id] = list;
        } catch {
          // One unreachable run does not hide the others.
        }
      }),
    );
    return NextResponse.json({ approvals });
  } catch (err: unknown) {
    if (err instanceof AppConfigError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 503 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not read approvals" }, { status: 500 });
  }
}
