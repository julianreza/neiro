import "server-only";
import { findPendingControl, submitRunApproval, submitRunClarify } from "@/lib/agent-runtime";
import { assignHandles } from "@/lib/mentions";
import { loadBotAgents, sendBotMessage } from "@/lib/bots";
import type { ApproveTarget, BotDeps } from "@/lib/bot-commands";
import { shortHash } from "@/lib/notifications";
import { advanceMission, approveRoute, reportAdvanceError } from "@/lib/orchestrator";
import { mapAgentRow, mapTaskRow } from "@/lib/orchestrator-store";
import { getSupabaseAdmin } from "@/lib/supabase";

/** The real effects behind chat-app commands: the same writes the dashboard makes. */

const db = () => getSupabaseAdmin();
const nowIso = () => new Date().toISOString();

async function advance(missionId: string, taskId?: string) {
  try {
    await advanceMission(missionId);
  } catch (err: unknown) {
    await reportAdvanceError(missionId, err, taskId);
  }
}

async function loadTask(taskId: string) {
  const { data } = await db().from("mission_tasks").select("*").eq("id", taskId).maybeSingle();
  return data ? mapTaskRow(data) : null;
}

async function taskRun(taskId: string) {
  const task = await loadTask(taskId);
  if (!task) return { error: "Task not found" } as const;
  const runId = task.runId && !task.runId.startsWith("claim:") ? task.runId : null;
  const agentId = task.runAgentId ?? task.agentId;
  if (!runId || !agentId) return { error: "This task is not running" } as const;
  const { data } = await db().from("agents").select("*").eq("id", agentId).maybeSingle();
  if (!data) return { error: "The task's agent is gone" } as const;
  return { task, runId, agent: mapAgentRow(data) } as const;
}

/** A Telegram-safe reply_to marker for /ask answers. */
export const telegramReplyTo = (chatId: string) => `telegram:${chatId}`;

export function botDeps(replyTo?: string): BotDeps {
  return {
    async createMission(prompt) {
      const id = `mission-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const title = prompt.split("\n")[0].slice(0, 80);
      const { error } = await db().from("missions").insert({
        id,
        title,
        prompt,
        status: "running",
        phase: "planning",
        // From a phone: always stop for the plan, so nothing big runs unseen.
        pause_after_planning: true,
        max_parallel_workers: 3,
        max_retries: 2,
        workspace_path: null,
      });
      if (error) throw new Error(error.message);
      await advance(id);
      return { id, title };
    },

    async status(missionId) {
      if (missionId) {
        const { data: m } = await db().from("missions").select("id, title, status, phase").eq("id", missionId).maybeSingle();
        if (!m) return `No mission ${missionId}.`;
        const { data: tasks } = await db().from("mission_tasks").select("stage, tokens").eq("mission_id", missionId);
        const list = tasks ?? [];
        const doneCount = list.filter((t) => t.stage === "Done").length;
        const needs = list.filter((t) => t.stage === "Needs you").length;
        const tokens = list.reduce((s, t) => s + (Number(t.tokens) || 0), 0);
        return `${m.title}\n${m.status} · ${m.phase}\nTasks ${doneCount}/${list.length} done${needs ? `, ${needs} need you` : ""}\nTokens ${tokens.toLocaleString("en-US")}`;
      }
      const { data } = await db()
        .from("missions")
        .select("id, title, status, phase")
        .in("status", ["running", "awaiting_plan_approval"])
        .order("updated_at", { ascending: false })
        .limit(8);
      if (!data?.length) return "No missions are running.";
      return data.map((m) => `• ${m.title} — ${m.status === "awaiting_plan_approval" ? "waiting for plan approval" : m.phase} (${m.id})`).join("\n");
    },

    async approveTarget(id): Promise<ApproveTarget> {
      const { data: m } = await db().from("missions").select("status").eq("id", id).maybeSingle();
      if (m) return m.status === "awaiting_plan_approval" ? "plan" : null;
      const task = await loadTask(id);
      if (!task) return null;
      if (task.stage === "Awaiting routing") return "route";
      const run = await taskRun(id);
      if ("error" in run) return null;
      return (await findPendingControl(run.agent, run.runId, undefined).catch(() => null)) ? "tool" : null;
    },

    async approvePlan(missionId) {
      const { data, error } = await db()
        .from("missions")
        .update({ status: "running", updated_at: nowIso() })
        .eq("id", missionId)
        .eq("status", "awaiting_plan_approval")
        .select("id");
      if (error) return error.message;
      if (!data?.length) return "This mission is not waiting for plan approval";
      await advance(missionId);
      return null;
    },

    async approveRoute(taskId) {
      const task = await loadTask(taskId);
      if (!task) return "Task not found";
      const result = await approveRoute(task.missionId, taskId);
      return result.ok ? null : result.error;
    },

    async answerTool(taskId, choice, requestId) {
      const run = await taskRun(taskId);
      if ("error" in run) return run.error ?? "Task not running";
      const control = await findPendingControl(run.agent, run.runId, requestId).catch(() => null);
      if (!control) return "Nothing is waiting for approval";
      if (choice === "always" && !control.choices.includes("always")) return "This approval does not offer Always";
      const ok = await submitRunApproval(run.agent, run.runId, choice, {
        requestId: control.requestId,
        executionGeneration: control.executionGeneration,
      });
      return ok ? null : "The agent did not take the answer";
    },

    async retryTask(taskId) {
      const task = await loadTask(taskId);
      if (!task) return "Task not found";
      const { error } = await db()
        .from("mission_tasks")
        .update({
          stage: "Queued",
          approval: false,
          retries: task.retries + 1,
          result_output: null,
          run_id: null,
          run_agent_id: null,
          run_started_at: null,
          updated_at: nowIso(),
        })
        .eq("id", taskId)
        .eq("stage", task.stage);
      if (error) return error.message;
      await advance(task.missionId, taskId);
      return null;
    },

    async clarify(taskId, answer) {
      const run = await taskRun(taskId);
      if ("error" in run) return run.error ?? "Task not running";
      const control = await findPendingControl(run.agent, run.runId, undefined, "clarify").catch(() => null);
      if (!control) return "No question is waiting on this task";
      const ok = await submitRunClarify(run.agent, run.runId, answer, {
        requestId: control.requestId,
        executionGeneration: control.executionGeneration,
      });
      return ok ? null : "The agent did not take the answer";
    },

    async ask(handle, question) {
      const supabase = db();
      const agents = await loadBotAgents(supabase);
      const handles = assignHandles(agents);
      const agent = handle
        ? agents.find((a) => handles.get(a.id) === handle)
        : (agents.find((a) => a.stage === "ask") ?? agents.find((a) => a.stage === "orchestrator"));
      if (!agent) return handle ? `No bot @${handle}. Try /ask without a name.` : "No Q&A bot is turned on.";
      const sent = await sendBotMessage(supabase, agent, question, { replyTo });
      if ("deferred" in sent) return `${agent.name} is busy. Try again in a minute.`;
      return `Asked ${agent.name}. The answer comes here when it is ready.`;
    },

    async record(source, text) {
      // Straight to the feed: going through the notifier would echo it back to the chat.
      await db()
        .from("notifications")
        .insert({
          kind: "bot_action",
          mission_id: null,
          title: `From ${source === "telegram" ? "Telegram" : "a chat app"}`,
          body: text.slice(0, 2000),
          dedupe_key: `bot:${Date.now()}:${shortHash(text)}`,
        })
        .then(() => undefined, () => undefined);
    },
  };
}
