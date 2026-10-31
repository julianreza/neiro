import { NextResponse } from "next/server";
import { connection } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { validateAttachments } from "@/lib/attachments";
import { ASK_TABLE, mapAskRow } from "@/lib/ask-history";
import { sendBotMessage } from "@/lib/bots";
import { botAgent, botError } from "@/lib/bots-route";

type RouteContext = { params: Promise<{ agentId: string }> };

const MAX_MESSAGE = 20000;

/** GET : the bot's forever-chat, oldest first (the last 200 messages). */
export async function GET(_request: NextRequest, context: RouteContext) {
  await connection();
  const { agentId } = await context.params;
  try {
    const supabase = getSupabaseAdmin();
    const agent = await botAgent(supabase, agentId);
    if (agent instanceof NextResponse) return agent;
    if (!agent.canonicalSessionId) return NextResponse.json({ sessionId: null, messages: [] });
    const { data, error } = await supabase
      .from(ASK_TABLE)
      .select("*")
      .eq("session_id", agent.canonicalSessionId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({
      sessionId: agent.canonicalSessionId,
      messages: (data ?? []).map((r) => mapAskRow(r)).reverse(),
    });
  } catch (err: unknown) {
    return botError(err, "Failed to load the bot chat");
  }
}

/** POST { message, images? } : one message; poll GET /api/ask/<runId>?agentId= for the answer. */
export async function POST(request: NextRequest, context: RouteContext) {
  await connection();
  const { agentId } = await context.params;
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    if (!message) return NextResponse.json({ error: "Write a message first." }, { status: 400 });
    if (message.length > MAX_MESSAGE) {
      return NextResponse.json({ error: `A message can be at most ${MAX_MESSAGE} characters.` }, { status: 400 });
    }
    const images = validateAttachments(body?.images);
    if (!images.ok) return NextResponse.json({ error: images.error }, { status: 400 });
    const supabase = getSupabaseAdmin();
    const agent = await botAgent(supabase, agentId);
    if (agent instanceof NextResponse) return agent;
    const sent = await sendBotMessage(supabase, agent, message, { images: images.images });
    if ("deferred" in sent) return NextResponse.json({ error: `${agent.name} is busy. Try again in a minute.` }, { status: 503 });
    return NextResponse.json({ ...sent, agentId: agent.id, agentName: agent.name }, { status: 201 });
  } catch (err: unknown) {
    return botError(err, "Could not send the message");
  }
}
