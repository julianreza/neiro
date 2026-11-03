import type { SupabaseClient } from "@supabase/supabase-js";
import { createSession, startRun } from "@/lib/agent-runtime";
import { recordAskStart } from "@/lib/ask-history";
import { assignHandles, parseMentions, rosterBlock } from "@/lib/mentions";
import { mapAgentRow } from "@/lib/orchestrator-store";
import { FOLLOW_UP_RULE, REPLY_SHAPES } from "@/lib/reply-format";
import type { Agent, ImageAttachment } from "@/lib/types";
import { agentActivity } from "@/lib/agent-activity";

/**
 * Hermes Bot Mode: every enabled agent is a bot with one forever-chat (its
 * canonical Hermes session). Messages are ask_questions rows in that session,
 * so History and the answer poller (GET /api/ask/<runId>) work unchanged.
 */

export type BotDTO = {
  id: string;
  name: string;
  role: string;
  stage: string;
  handle: string;
  section: string;
  runtime: string;
  activeRun: boolean;
  canonicalSessionId: string | null;
  lastMessage: string | null;
  lastAt: string | null;
};

const BOT_RULES = [
  "You are chatting with the operator as a long-running bot. Remember what they told you before.",
  "Reply in the language of the message. Start with the direct answer, then at most 5 short points.",
  "Do not create, edit, move, or delete files, and do not run commands that change anything, unless the operator asks.",
  REPLY_SHAPES,
  FOLLOW_UP_RULE + " Put it on the last line.",
].join("\n");

/** Memory scope of one bot's forever-chat. */
export const botMemoryKey = (agentId: string) => `neiro:bot:${agentId}`;

export async function loadBotAgents(supabase: SupabaseClient): Promise<Agent[]> {
  const { data, error } = await supabase.from("agents").select("*").eq("enabled", true).order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapAgentRow(r));
}

/** Handles for every enabled agent, oldest first (it keeps the plain handle). */
export function handlesOf(agents: Agent[]): Map<string, string> {
  return assignHandles(agents);
}

/** The roster shown on the /chat Bots tab: hidden bots left out. */
export async function listBots(supabase: SupabaseClient): Promise<BotDTO[]> {
  const agents = await loadBotAgents(supabase);
  const activity = await agentActivity(supabase);
  const handles = handlesOf(agents);
  const visible = agents.filter((a) => !a.botHidden);
  const sessions = visible.map((a) => a.canonicalSessionId).filter((s): s is string => Boolean(s));
  const last = new Map<string, { text: string; at: string }>();
  if (sessions.length) {
    const { data } = await supabase
      .from("ask_questions")
      .select("session_id, question, answer, created_at")
      .in("session_id", sessions)
      .order("created_at", { ascending: false })
      .limit(200);
    for (const row of data ?? []) {
      const sid = String(row.session_id);
      if (last.has(sid)) continue;
      const text = String(row.answer || row.question || "").replace(/\s+/g, " ").trim();
      last.set(sid, { text: text.slice(0, 140), at: String(row.created_at) });
    }
  }
  return visible.map((a) => {
    const l = a.canonicalSessionId ? last.get(a.canonicalSessionId) : undefined;
    return {
      id: a.id,
      name: a.name,
      role: a.role,
      stage: a.stage,
      handle: handles.get(a.id) ?? a.id,
      section: a.botSection?.trim() || "Team",
      runtime: a.runtime ?? "hermes",
      activeRun: activity.has(a.id),
      canonicalSessionId: a.canonicalSessionId ?? null,
      lastMessage: l?.text ?? null,
      lastAt: l?.at ?? null,
    };
  });
}

/**
 * The bot's forever-chat session, made on first use. Two first messages at
 * once keep one session: only an empty canonical_session_id is written.
 */
export async function ensureCanonicalSession(supabase: SupabaseClient, agent: Agent): Promise<string> {
  if (agent.canonicalSessionId) return agent.canonicalSessionId;
  const fresh = await createSession(agent, `Bot Chat: ${agent.name}`);
  const { data, error } = await supabase
    .from("agents")
    .update({ canonical_session_id: fresh })
    .eq("id", agent.id)
    .is("canonical_session_id", null)
    .select("canonical_session_id");
  if (error) throw new Error(error.message);
  if (data && data.length > 0) return fresh;
  // Lost the race: use the session the other request saved.
  const { data: row } = await supabase.from("agents").select("canonical_session_id").eq("id", agent.id).maybeSingle();
  const saved = typeof row?.canonical_session_id === "string" ? row.canonical_session_id : null;
  return saved ?? fresh;
}

/** Retires the forever-chat: the next message starts a new one. The old session stays in Hermes. */
export async function archiveCanonicalSession(supabase: SupabaseClient, agent: Agent): Promise<string> {
  const fresh = await createSession(agent, `Bot Chat: ${agent.name}`);
  const { error } = await supabase.from("agents").update({ canonical_session_id: fresh }).eq("id", agent.id);
  if (error) throw new Error(error.message);
  return fresh;
}

/** Instructions for one message: the bot's own prompt, chat rules and, when it @mentions, the team. */
export type TeamMember = { id: string; handle: string; name: string; role: string };

/** The teammates roster when the message @mentions a bot (or @all), else "". */
export function mentionRoster(agentId: string, message: string, team: TeamMember[]): string {
  const mentions = parseMentions(message, team.map((t) => t.handle));
  return mentions.handles.length > 0 || mentions.all ? rosterBlock(team.filter((t) => t.id !== agentId)) : "";
}

export function teamOf(agents: Agent[]): TeamMember[] {
  const handles = handlesOf(agents);
  return agents.map((a) => ({ id: a.id, handle: handles.get(a.id) ?? a.id, name: a.name, role: a.role }));
}

export function botInstructions(agent: Agent, message: string, team: TeamMember[]): string {
  return [agent.prompt, BOT_RULES, mentionRoster(agent.id, message, team)].filter(Boolean).join("\n\n");
}

/** Sends one message to a bot's forever-chat; returns the run id to poll. */
export async function sendBotMessage(
  supabase: SupabaseClient,
  agent: Agent,
  message: string,
  opts: { images?: ImageAttachment[]; replyTo?: string } = {},
): Promise<{ runId: string; sessionId: string; skippedImages?: boolean } | { deferred: string }> {
  const team = teamOf(await loadBotAgents(supabase));
  const sessionId = await ensureCanonicalSession(supabase, agent);
  const started = await startRun(agent, {
    prompt: message,
    instructions: botInstructions(agent, message, team),
    sessionId,
    sessionKey: botMemoryKey(agent.id),
    images: opts.images,
    approvals: "ask",
  });
  if (started.kind === "deferred") return { deferred: started.reason };
  await recordAskStart(supabase, {
    id: started.runId,
    agentId: agent.id,
    agentName: agent.name,
    question: message,
    workspacePath: "",
    sessionId,
    model: agent.model,
    runtime: agent.runtime ?? "hermes",
    replyTo: opts.replyTo,
  });
  return { runId: started.runId, sessionId, skippedImages: started.skippedImages };
}
