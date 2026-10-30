import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isAuthorizedRequest } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { stopRun, submitRunApproval, submitRunClarify } from "@/lib/agent-runtime";
import {
  advanceMission,
  approveRoute,
  overrideRoute,
  reportAdvanceError,
} from "@/lib/orchestrator";
import { AppConfigError } from "@/lib/types";
import type { Agent } from "@/lib/types";

type RouteContext = {
  params: Promise<{ id: string; taskId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { id: missionId, taskId } = await context.params;

  try {
    const body = await request.json();
    const action = body?.action;
    const { reply, approved } = body || {};
    const requestId = typeof body?.requestId === "string" && body.requestId.length <= 200 ? body.requestId : undefined;

    const validActions = [
      "retry",
      "stop",
      "approve_tool",
      "deny_tool",
      "clarify",
      "mark_done",
      "approve_route",
      "override_route",
    ];

    if (!action || !validActions.includes(action)) {
      return NextResponse.json(
        { error: `Invalid action. Must be one of: ${validActions.join(", ")}` },
        { status: 400 }
      );
    }

    // Human routing gate: pick which agent runs a task Laya held back.
    if (action === "approve_route" || action === "override_route") {
      if (!(await isAuthorizedRequest(request))) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const result =
        action === "approve_route"
          ? await approveRoute(missionId, taskId)
          : await overrideRoute(missionId, taskId, body?.agentId);

      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.status });
      }

      try {
        await advanceMission(missionId);
      } catch (err: unknown) {
        await reportAdvanceError(missionId, err, taskId);
      }

      return NextResponse.json({ ok: true, task: result.task }, { status: 200 });
    }

    const supabase = getSupabaseAdmin();

    const { data: task, error: taskErr } = await supabase
      .from("mission_tasks")
      .select("*")
      .eq("id", taskId)
      .eq("mission_id", missionId)
      .maybeSingle();

    if (taskErr) {
      return NextResponse.json({ error: taskErr.message }, { status: 500 });
    }
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // run_id holds the live Hermes run, or a `claim:` token while one is starting.
    const activeRunId: string | null =
      typeof task.run_id === "string" && !task.run_id.startsWith("claim:") ? task.run_id : null;
    const runAgentId: string | null = task.run_agent_id ?? task.agent_id ?? null;

    let agent: Agent | null = null;
    if (runAgentId) {
      const { data: agentData } = await supabase
        .from("agents")
        .select("*")
        .eq("id", runAgentId)
        .maybeSingle();

      if (agentData) {
        agent = {
          id: agentData.id,
          name: agentData.name,
          role: agentData.role,
          stage: agentData.stage,
          specialty: agentData.specialty || "",
          model: agentData.model || "",
          profile: agentData.profile || "default",
          prompt: agentData.prompt || "",
          url: agentData.url || "",
          key_enc: agentData.key_enc,
          enabled: agentData.enabled,
          activeRun: agentData.active_run ?? false,
        };
      }
    }

    if (action === "mark_done") {
      const { data, error } = await supabase
        .from("mission_tasks")
        .update({
          stage: "Done",
          approval: false,
          run_id: null,
          run_agent_id: null,
          run_started_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", taskId)
        .select()
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      try {
        await advanceMission(missionId);
      } catch (err: unknown) {
        await reportAdvanceError(missionId, err, taskId);
      }

      return NextResponse.json({ ok: true, task: data }, { status: 200 });
    }

    if (action === "retry") {
      const { data, error } = await supabase
        .from("mission_tasks")
        .update({
          stage: "Queued",
          approval: false,
          retries: (task.retries || 0) + 1,
          // `result` holds the task requirements; only the previous output is reset.
          result_output: null,
          run_id: null,
          run_agent_id: null,
          run_started_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", taskId)
        .select()
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      try {
        await advanceMission(missionId);
      } catch (err: unknown) {
        await reportAdvanceError(missionId, err, taskId);
      }

      return NextResponse.json({ ok: true, task: data }, { status: 200 });
    }

    if (action === "stop") {
      if (agent && activeRunId) {
        try {
          await stopRun(agent, activeRunId);
        } catch (err: unknown) {
          // Best effort: the task is parked in "Needs you" either way.
          console.error("[orchestrator] stop run failed", {
            missionId,
            taskId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const { data, error } = await supabase
        .from("mission_tasks")
        .update({
          stage: "Needs you",
          approval: false,
          run_id: null,
          run_agent_id: null,
          run_started_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", taskId)
        .select()
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ ok: true, task: data }, { status: 200 });
    }

    if (action === "approve_tool" || action === "deny_tool") {
      const isApproved = action === "approve_tool" || Boolean(approved);
      if (agent && activeRunId) {
        let answered: boolean;
        try {
          answered = await submitRunApproval(agent, activeRunId, isApproved, requestId ? { requestId } : undefined);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return NextResponse.json({ error: message }, { status: 500 });
        }
        if (!answered) {
          return NextResponse.json({ error: "The agent did not take the answer. It may have stopped waiting." }, { status: 409 });
        }
      }

      const { data, error } = await supabase
        .from("mission_tasks")
        .update({
          approval: false,
          updated_at: new Date().toISOString(),
        })
        .eq("id", taskId)
        .select()
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ ok: true, task: data }, { status: 200 });
    }

    if (action === "clarify") {
      if (!reply || typeof reply !== "string") {
        return NextResponse.json({ error: "Missing required 'reply' text" }, { status: 400 });
      }

      if (agent && activeRunId) {
        try {
          await submitRunClarify(agent, activeRunId, reply);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return NextResponse.json({ error: message }, { status: 500 });
        }
      }

      const { data, error } = await supabase
        .from("mission_tasks")
        .update({
          approval: false,
          stage: "Coding",
          updated_at: new Date().toISOString(),
        })
        .eq("id", taskId)
        .select()
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ ok: true, task: data }, { status: 200 });
    }

    return NextResponse.json({ error: "Unhandled action" }, { status: 400 });
  } catch (err: unknown) {
    if (err instanceof AppConfigError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 503 }
      );
    }
    const message = err instanceof Error ? err.message : "Failed to execute task control action";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
