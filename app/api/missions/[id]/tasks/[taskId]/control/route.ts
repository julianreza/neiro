import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { stopHermesRun, submitHermesRunApproval, submitHermesRunClarify } from "@/lib/hermes";
import { advanceMission } from "@/lib/orchestrator";
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

    const validActions = [
      "retry",
      "stop",
      "approve_tool",
      "deny_tool",
      "clarify",
      "mark_done",
    ];

    if (!action || !validActions.includes(action)) {
      return NextResponse.json(
        { error: `Invalid action. Must be one of: ${validActions.join(", ")}` },
        { status: 400 }
      );
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

    let agent: Agent | null = null;
    if (task.agent_id) {
      const { data: agentData } = await supabase
        .from("agents")
        .select("*")
        .eq("id", task.agent_id)
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
      } catch {
        // Triggered on next tick
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
          result: null,
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
      } catch {
        // Triggered on next tick
      }

      return NextResponse.json({ ok: true, task: data }, { status: 200 });
    }

    if (action === "stop") {
      if (agent && task.active_run_id) {
        try {
          await stopHermesRun(agent, task.active_run_id);
        } catch {
          // Best effort stop
        }
      }

      const { data, error } = await supabase
        .from("mission_tasks")
        .update({
          stage: "Needs you",
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

    if (action === "approve_tool" || action === "deny_tool") {
      const isApproved = action === "approve_tool" || Boolean(approved);
      if (agent && task.active_run_id) {
        try {
          await submitHermesRunApproval(agent, task.active_run_id, isApproved);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return NextResponse.json({ error: message }, { status: 500 });
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

      if (agent && task.active_run_id) {
        try {
          await submitHermesRunClarify(agent, task.active_run_id, reply);
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
