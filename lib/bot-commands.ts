/**
 * Chat-app commands for Neiro (Telegram first; any webhook that sends
 * { text }). Pure: every effect goes through `BotDeps`, the same actions the
 * dashboard buttons use, so a message can never do more than a button.
 */
import { parseActionPayload, type NotificationAction } from "@/lib/notifications";

export type BotCommand =
  | { kind: "mission"; prompt: string }
  | { kind: "status"; missionId?: string }
  | { kind: "approve"; id: string }
  | { kind: "deny"; taskId: string }
  | { kind: "clarify"; taskId: string; answer: string }
  | { kind: "ask"; handle?: string; question: string }
  | { kind: "help"; unknown?: string };

export type BotSource = "telegram" | "generic";

export const HELP = [
  "Neiro commands:",
  "/mission <what to build> — start a mission",
  "/status [missionId] — running missions, or one mission",
  "/approve <missionId|taskId> — approve a plan, a route or a waiting tool",
  "/deny <taskId> — deny a waiting tool",
  "/clarify <taskId> <answer> — answer an agent's question",
  "/ask [@bot] <question> — ask a bot; the answer comes here",
].join("\n");

const ID = /^[A-Za-z0-9_.:-]{1,120}$/;
const MAX_TEXT = 8000;

export function parseBotCommand(text: string): BotCommand {
  const trimmed = text.trim().slice(0, MAX_TEXT);
  // Telegram adds "@BotName" to commands in groups: "/status@neiro_bot".
  const m = /^\/([a-z]+)(?:@\S+)?(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (!m) return { kind: "help", unknown: trimmed ? trimmed.slice(0, 40) : undefined };
  const name = m[1].toLowerCase();
  const rest = (m[2] ?? "").trim();
  const [first, ...more] = rest.split(/\s+/);
  switch (name) {
    case "mission":
      return rest ? { kind: "mission", prompt: rest } : { kind: "help" };
    case "status":
      return first && ID.test(first) ? { kind: "status", missionId: first } : { kind: "status" };
    case "approve":
      return first && ID.test(first) ? { kind: "approve", id: first } : { kind: "help" };
    case "deny":
      return first && ID.test(first) ? { kind: "deny", taskId: first } : { kind: "help" };
    case "clarify": {
      const answer = more.join(" ").trim();
      return first && ID.test(first) && answer ? { kind: "clarify", taskId: first, answer } : { kind: "help" };
    }
    case "ask": {
      const handle = /^@([a-z0-9-]+)$/i.exec(first ?? "")?.[1]?.toLowerCase();
      const question = (handle ? more.join(" ") : rest).trim();
      return question ? { kind: "ask", handle, question } : { kind: "help" };
    }
    case "start":
    case "help":
      return { kind: "help" };
    default:
      return { kind: "help", unknown: `/${name}` };
  }
}

/** What `/approve <id>` points at. */
export type ApproveTarget = "plan" | "route" | "tool" | null;

export type BotDeps = {
  createMission(prompt: string): Promise<{ id: string; title: string }>;
  status(missionId?: string): Promise<string>;
  /** What the id is waiting for, if anything. */
  approveTarget(id: string): Promise<ApproveTarget>;
  approvePlan(missionId: string): Promise<string | null>;
  approveRoute(taskId: string): Promise<string | null>;
  answerTool(taskId: string, choice: "once" | "always" | "deny", requestId?: string): Promise<string | null>;
  retryTask(taskId: string): Promise<string | null>;
  clarify(taskId: string, answer: string): Promise<string | null>;
  ask(handle: string | undefined, question: string): Promise<string>;
  /** Records what was done, and from where, in Neiro's notifications. */
  record(source: BotSource, text: string): Promise<void>;
};

const done = (error: string | null, ok: string) => (error ? `Could not do it: ${error}` : ok);

export async function runBotCommand(cmd: BotCommand, deps: BotDeps, source: BotSource): Promise<string> {
  switch (cmd.kind) {
    case "help":
      return cmd.unknown ? `Unknown command ${cmd.unknown}.\n\n${HELP}` : HELP;
    case "status":
      return deps.status(cmd.missionId);
    case "mission": {
      const m = await deps.createMission(cmd.prompt);
      await deps.record(source, `Mission started from ${source}: ${m.title}`);
      return `Mission started: ${m.title} (${m.id}). It pauses for your plan approval.`;
    }
    case "approve": {
      const target = await deps.approveTarget(cmd.id);
      if (!target) return `Nothing with id ${cmd.id} is waiting for approval.`;
      const error =
        target === "plan"
          ? await deps.approvePlan(cmd.id)
          : target === "route"
            ? await deps.approveRoute(cmd.id)
            : await deps.answerTool(cmd.id, "once");
      if (!error) await deps.record(source, `Approved ${target} ${cmd.id} from ${source}`);
      return done(error, target === "plan" ? "Plan approved. The mission goes on." : target === "route" ? "Route approved." : "Tool allowed once.");
    }
    case "deny": {
      const error = await deps.answerTool(cmd.taskId, "deny");
      if (!error) await deps.record(source, `Denied a tool on ${cmd.taskId} from ${source}`);
      return done(error, "Tool denied.");
    }
    case "clarify": {
      const error = await deps.clarify(cmd.taskId, cmd.answer);
      if (!error) await deps.record(source, `Answered ${cmd.taskId} from ${source}`);
      return done(error, "Answer sent.");
    }
    case "ask":
      return deps.ask(cmd.handle, cmd.question);
  }
}

/** A button press (callback): the same actions, from a button payload. */
export async function runBotAction(action: NotificationAction, deps: BotDeps, source: BotSource): Promise<string> {
  let error: string | null;
  let ok: string;
  switch (action.id) {
    case "approve_plan":
      [error, ok] = [await deps.approvePlan(action.target), "Plan approved."];
      break;
    case "approve_route":
      [error, ok] = [await deps.approveRoute(action.target), "Route approved."];
      break;
    case "approve_tool_once":
      [error, ok] = [await deps.answerTool(action.target, "once", action.requestId), "Allowed once."];
      break;
    case "approve_tool_always":
      [error, ok] = [await deps.answerTool(action.target, "always", action.requestId), "Always allowed."];
      break;
    case "deny_tool":
      [error, ok] = [await deps.answerTool(action.target, "deny", action.requestId), "Denied."];
      break;
    case "retry_task":
      [error, ok] = [await deps.retryTask(action.target), "Task queued again."];
      break;
  }
  if (!error) await deps.record(source, `${ok} (${action.target}) from ${source}`);
  return done(error, ok);
}

export { parseActionPayload };
