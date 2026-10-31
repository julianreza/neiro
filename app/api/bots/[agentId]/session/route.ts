import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { compactSession } from "@/lib/agent-runtime";
import { archiveCanonicalSession } from "@/lib/bots";
import { botAgent, botError } from "@/lib/bots-route";

type RouteContext = { params: Promise<{ agentId: string }> };

/**
 * POST { action: "compact" } : shrink the forever-chat's context, history kept.
 * POST { action: "archive" } : start a new forever-chat; the old one stays in Hermes.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const { agentId } = await context.params;
  try {
    const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
    const action = body?.action;
    if (action !== "compact" && action !== "archive") {
      return NextResponse.json({ error: "action must be compact or archive" }, { status: 400 });
    }
    const supabase = getSupabaseAdmin();
    const agent = await botAgent(supabase, agentId);
    if (agent instanceof NextResponse) return agent;
    if (action === "compact") {
      if (!agent.canonicalSessionId) return NextResponse.json({ error: "This bot has no chat yet." }, { status: 409 });
      await compactSession(agent, agent.canonicalSessionId);
      return NextResponse.json({ ok: true, sessionId: agent.canonicalSessionId });
    }
    const sessionId = await archiveCanonicalSession(supabase, agent);
    return NextResponse.json({ ok: true, sessionId });
  } catch (err: unknown) {
    return botError(err, "Could not change the bot chat");
  }
}
