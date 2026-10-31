import "server-only";
import { getRun } from "@/lib/agent-runtime";
import { ASK_TABLE, recordAskResult, splitAnswerFiles } from "@/lib/ask-history";
import { mapAgentRow } from "@/lib/orchestrator-store";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendTelegramMessage } from "@/lib/telegram";

/**
 * Answers to /ask from a chat app: nobody has the dashboard open to poll
 * them, so the tick reads the run, saves the answer and sends it back once
 * (reply_sent_at is only set where it is still empty).
 */

const BATCH = 10;
const REPLY_MAX = 3500;

export function replyText(row: { agent_name?: unknown; answer?: unknown; error?: unknown; status?: unknown; id?: unknown }, baseUrl?: string): string {
  const who = String(row.agent_name ?? "The bot");
  if (row.status !== "completed") return `${who} could not answer${row.error ? `: ${String(row.error)}` : "."}`;
  const body = splitAnswerFiles(String(row.answer ?? "")).body.trim() || "(empty answer)";
  if (body.length <= REPLY_MAX) return `${who}:\n${body}`;
  const link = baseUrl ? `\n\nFull answer: ${baseUrl.replace(/\/+$/, "")}/chat?chat=${encodeURIComponent(String(row.id))}` : "";
  return `${who}:\n${body.slice(0, REPLY_MAX)}…${link}`;
}

export async function deliverBotReplies(): Promise<string[]> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from(ASK_TABLE)
    .select("*")
    .not("reply_to", "is", null)
    .is("reply_sent_at", null)
    .order("created_at", { ascending: true })
    .limit(BATCH);
  // Before 20261031000000_hermes_full_suite.sql there is no reply_to column.
  if (error) return /reply_to|reply_sent_at/.test(error.message) ? [] : [`Bot replies: ${error.message}`];
  const errors: string[] = [];
  for (const row of data ?? []) {
    try {
      let current = row as Record<string, unknown>;
      if (current.status === "running") {
        const { data: agentRow } = await db.from("agents").select("*").eq("id", String(current.agent_id)).maybeSingle();
        if (!agentRow) continue;
        const run = await getRun(mapAgentRow(agentRow), String(current.id));
        const update = await recordAskResult(db, String(current.id), run);
        if (!update) continue; // still running
        current = { ...current, ...update };
      }
      const target = String(current.reply_to ?? "");
      const claimed = await db
        .from(ASK_TABLE)
        .update({ reply_sent_at: new Date().toISOString() })
        .eq("id", String(current.id))
        .is("reply_sent_at", null)
        .select("id");
      if (!claimed.data?.length) continue; // another tick sent it
      if (target.startsWith("telegram:")) {
        await sendTelegramMessage(replyText(current, process.env.NEIRO_PUBLIC_URL), { chatId: target.slice(9) });
      }
    } catch (err: unknown) {
      errors.push(`Bot reply ${String(row.id)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return errors;
}
