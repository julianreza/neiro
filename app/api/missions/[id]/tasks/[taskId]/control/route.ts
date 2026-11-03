import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isAuthorizedRequest } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { findPendingControl, forkSession, getRun, steerRun, stopRun, submitRunApproval, submitRunClarify } from "@/lib/agent-runtime";
import { mapAgentRow, mapTaskRow, mapPendingControls } from "@/lib/orchestrator-store";
import {
  advanceMission,
  classifyRun,
  approveRoute,
  overrideRoute,
  reportAdvanceError,
} from "@/lib/orchestrator";
import { AppConfigError, UnsupportedRuntimeError } from "@/lib/types";
import type { Agent, ApprovalChoice } from "@/lib/types";
import { taskRetryPatch } from "@/lib/task-retry";

const APPROVAL_ACTIONS: Record<string, ApprovalChoice> = {
  approve_tool: "once",
  approve_tool_session: "session",
  approve_tool_always: "always",
  deny_tool: "deny",
};

const FORK_NOTE_MAX = 4000;

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
      "steer",
      "stop",
      "approve_tool",
      "approve_tool_session",
      "approve_tool_always",
      "deny_tool",
      "fork_session",
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

      if (agentData) agent = mapAgentRow(agentData);
    }

    if (action === "steer") {
      if (!(await isAuthorizedRequest(request))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      const instruction = typeof reply === "string" ? reply.trim() : "";
      if (!instruction || instruction.length > 4000) return NextResponse.json({ error: "Steering requires 1–4000 characters." }, { status: 400 });
      if (!agent || !activeRunId) return NextResponse.json({ error: "This task has no active run to steer." }, { status: 409 });
      try {
        const current = await getRun(agent, activeRunId);
        if (classifyRun(current.status) !== "pending" || current.status.toLowerCase() === "unknown") {
          return NextResponse.json({ error: "The run is no longer active." }, { status: 409 });
        }
        const result = await steerRun(agent, activeRunId, instruction);
        if (!result.ok) return NextResponse.json({ error: result.error ?? "The agent rejected the instruction." }, { status: result.status >= 400 && result.status < 500 ? result.status : 502 });
        const { error } = await supabase.from("mission_artifacts").insert({
          id: crypto.randomUUID(), mission_id: missionId, task_id: taskId,
          title: "Steering instruction", kind: "steer_note", content: instruction,
          dedupe_key: `steer:${crypto.randomUUID()}`, run_id: activeRunId,
        });
        // The instruction is already queued; do not suggest retrying it if recording failed.
        return NextResponse.json({ ok: true, ...(error ? { warning: "Instruction sent, but its history could not be saved." } : {}) });
      } catch (error: unknown) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "Could not steer this run." }, { status: error instanceof UnsupportedRuntimeError ? 409 : 502 });
      }
    }

    if (action === "mark_done") {
      const { data, error } = await supabase
        .from("mission_tasks")
        .update({
          stage: "Done",
          approval: false,
          pending_controls: [],
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
          ...taskRetryPatch(task),
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
          pending_controls: [],
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

    if (action in APPROVAL_ACTIONS) {
      // deny_tool with approved: true is the old "approve" spelling.
      const choice: ApprovalChoice =
        action === "deny_tool" && approved === true ? "once" : APPROVAL_ACTIONS[action];
      if (!agent || !activeRunId) return NextResponse.json({ error: "This task has no active run." }, { status: 409 });
      let answeredId = requestId;
      if (agent && activeRunId) {
        let answered: boolean;
        try {
          const control = await findPendingControl(agent, activeRunId, requestId);
          answeredId = control?.requestId ?? requestId;
          if (control && choice !== "once" && choice !== "deny" && !control.choices.includes(choice)) {
            return NextResponse.json(
              { error: `This approval does not offer "${choice}". Choose once or deny.` },
              { status: 400 },
            );
          }
          answered = await submitRunApproval(agent, activeRunId, choice, {
            requestId: control?.requestId ?? requestId,
            executionGeneration: control?.executionGeneration ?? null,
          });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return NextResponse.json({ error: message }, { status: 500 });
        }
        if (!answered) {
          return NextResponse.json({ error: "The agent did not take the answer. It may have stopped waiting." }, { status: 409 });
        }
      }

      const controls = mapPendingControls(task.pending_controls);
      const answeredControl = answeredId ? controls.find((c) => c.requestId === answeredId && c.kind === "approval") : controls.find((c) => c.kind === "approval");
      const remaining = answeredControl ? controls.filter((c) => c !== answeredControl) : controls;
      const { data, error } = await supabase
        .from("mission_tasks")
        .update({
          approval: remaining.length > 0,
          pending_controls: remaining,
          updated_at: new Date().toISOString(),
        })
        .eq("id", taskId)
        .eq("mission_id", missionId)
        .eq("run_id", activeRunId)
        .eq("stage", task.stage)
        .eq("pending_controls", JSON.stringify(task.pending_controls ?? []))
        .select()
        .maybeSingle();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      if (!data) return NextResponse.json({ ok: true, warning: "Answer sent; task changed. Refresh to see its current state." });

      return NextResponse.json({ ok: true, task: data }, { status: 200 });
    }

    if (action === "fork_session") {
      const instructions = typeof body?.instructions === "string" ? body.instructions.trim() : "";
      if (!instructions || instructions.length > FORK_NOTE_MAX) {
        return NextResponse.json(
          { error: `Say what to try instead (1-${FORK_NOTE_MAX} characters).` },
          { status: 400 },
        );
      }
      const current = mapTaskRow(task);
      if (activeRunId || (typeof task.run_id === "string" && task.run_id.startsWith("claim:"))) {
        return NextResponse.json({ error: "Stop the running attempt before forking it." }, { status: 409 });
      }
      if (!current.sessionId) {
        return NextResponse.json({ error: "This task has no session to fork yet." }, { status: 409 });
      }
      if (!agent) {
        return NextResponse.json({ error: "The task's agent is gone; pick an agent first." }, { status: 409 });
      }

      let newSession: string;
      try {
        newSession = await forkSession(agent, current.sessionId, `Fork: ${current.title}`);
      } catch (err: unknown) {
        const status = err instanceof UnsupportedRuntimeError ? 409 : 502;
        return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
      }

      const branch = body?.createBranchTask === true;
      const targetId = branch ? crypto.randomUUID() : taskId;
      if (branch) {
        const { error: insertErr } = await supabase.from("mission_tasks").insert({
          id: targetId,
          mission_id: missionId,
          // A fresh key: the original keeps its place in the plan.
          task_key: current.taskKey ? `${current.taskKey}-fork-${targetId.slice(0, 4)}` : null,
          title: `${current.title} (fork)`,
          stage: "Routed",
          agent_id: current.agentId ?? agent.id,
          agent_name: current.agentName,
          model: current.model,
          tokens: 0,
          depends: current.depends,
          approval: false,
          retries: 0,
          result: current.result,
          session_id: newSession,
          // Routed means "agent chosen": the router never re-runs.
          routing_status: current.routingStatus ?? "approved",
        });
        if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });
      }

      const { count } = await supabase
        .from("mission_artifacts")
        .select("id", { count: "exact", head: true })
        .eq("task_id", targetId)
        .eq("kind", "fork_note");
      const { error: noteErr } = await supabase.from("mission_artifacts").insert({
        id: crypto.randomUUID(),
        mission_id: missionId,
        task_id: targetId,
        title: `Fork note: ${current.title}`,
        kind: "fork_note",
        content: instructions,
        dedupe_key: `fork:${targetId}:${(count ?? 0) + 1}`,
      });
      if (noteErr) return NextResponse.json({ error: noteErr.message }, { status: 500 });

      if (!branch) {
        const { error: updErr } = await supabase
          .from("mission_tasks")
          .update({
            stage: "Routed",
            session_id: newSession,
            approval: false,
            result_output: null,
            run_id: null,
            run_agent_id: null,
            run_started_at: null,
            routing_status: current.routingStatus ?? "approved",
            updated_at: new Date().toISOString(),
          })
          .eq("id", taskId);
        if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
      }

      try {
        await advanceMission(missionId);
      } catch (err: unknown) {
        await reportAdvanceError(missionId, err, targetId);
      }
      return NextResponse.json({ ok: true, taskId: targetId, sessionId: newSession }, { status: 200 });
    }

    if (action === "clarify") {
      if (!reply || typeof reply !== "string") {
        return NextResponse.json({ error: "Missing required 'reply' text" }, { status: 400 });
      }

      if (!agent || !activeRunId) return NextResponse.json({ error: "This task has no active run." }, { status: 409 });
      let answeredId = requestId;
      if (agent && activeRunId) {
        try {
          const control = await findPendingControl(agent, activeRunId, requestId, "clarify").catch(() => null);
          answeredId = control?.requestId ?? requestId;
          const answered = await submitRunClarify(agent, activeRunId, reply, {
            requestId: control?.requestId ?? requestId,
            executionGeneration: control?.executionGeneration ?? null,
          });
          if (!answered) return NextResponse.json({ error: "The agent did not take the answer. It may have stopped waiting." }, { status: 409 });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return NextResponse.json({ error: message }, { status: 500 });
        }
      }

      const controls = mapPendingControls(task.pending_controls);
      const answeredControl = answeredId ? controls.find((c) => c.requestId === answeredId && c.kind === "clarify") : controls.find((c) => c.kind === "clarify");
      const remaining = answeredControl ? controls.filter((c) => c !== answeredControl) : controls;
      const { data, error } = await supabase
        .from("mission_tasks")
        .update({
          approval: remaining.length > 0,
          pending_controls: remaining,
          updated_at: new Date().toISOString(),
        })
        .eq("id", taskId)
        .eq("mission_id", missionId)
        .eq("run_id", activeRunId)
        .eq("stage", task.stage)
        .eq("pending_controls", JSON.stringify(task.pending_controls ?? []))
        .select()
        .maybeSingle();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      if (!data) return NextResponse.json({ ok: true, warning: "Answer sent; task changed. Refresh to see its current state." });

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
