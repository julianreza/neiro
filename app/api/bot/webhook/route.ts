import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { BOT_WEBHOOK_MAX_BYTES, checkBotSecret, parseBotUpdate } from "@/lib/bot-webhook";
import { parseActionPayload, parseBotCommand, runBotAction, runBotCommand } from "@/lib/bot-commands";
import { botDeps, telegramReplyTo } from "@/lib/bot-deps";
import { answerCallbackQuery, sendTelegramMessage } from "@/lib/telegram";
import { getSupabaseAdmin } from "@/lib/supabase";
import { guardExternalPrompt } from "@/lib/system-one-gate";
import type { NotificationAction } from "@/lib/notifications";

/** A long button payload ("n.<notificationId>.<index>") is read back from the notification. */
async function lookupAction(notificationId: string, index: number): Promise<NotificationAction | null> {
  if (!/^[0-9a-f-]{36}$/i.test(notificationId)) return null;
  const { data } = await getSupabaseAdmin().from("notifications").select("actions").eq("id", notificationId).maybeSingle();
  const list = Array.isArray(data?.actions) ? (data.actions as NotificationAction[]) : [];
  return list[index] ?? null;
}

/**
 * Inbound commands and button presses from Telegram (or any sender with the
 * shared secret). The proxy lets this path through without a session cookie
 * only when the secret header matches; it is checked again here.
 */
export async function POST(request: NextRequest) {
  const check = checkBotSecret(request.headers);
  if (check === "unconfigured") return NextResponse.json({ error: "Bot webhook is not configured" }, { status: 503 });
  if (check === "denied") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > BOT_WEBHOOK_MAX_BYTES) return NextResponse.json({ error: "Body too large" }, { status: 413 });
  const raw = await request.text();
  if (raw.length > BOT_WEBHOOK_MAX_BYTES) return NextResponse.json({ error: "Body too large" }, { status: 413 });
  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const update = parseBotUpdate(body);
  // Telegram retries anything but a 2xx, so an ignored update still gets 200.
  if (update.kind === "ignore") return NextResponse.json({ ok: true, ignored: update.reason });

  const source = update.chatId ? "telegram" : "generic";
  const deps = botDeps(update.chatId ? telegramReplyTo(update.chatId) : undefined);
  let reply: string;
  try {
    if (update.kind === "callback") {
      const parsed = parseActionPayload(update.data);
      const action =
        parsed?.kind === "action" ? parsed.action : parsed?.kind === "lookup" ? await lookupAction(parsed.notificationId, parsed.index) : null;
      reply = action ? await runBotAction(action, deps, source) : "This button has expired.";
      if (update.id) await answerCallbackQuery(update.id, reply);
    } else {
      const command = parseBotCommand(update.text);
      const text = command.kind === "mission" ? command.prompt : command.kind === "ask" ? command.question : command.kind === "clarify" ? command.answer : "";
      const guard = text ? await guardExternalPrompt(text) : "unknown";
      reply = guard === "flagged" ? "This message may contain instructions aimed at the agent. Review it in Neiro before proceeding." : await runBotCommand(command, deps, source);
    }
  } catch (err: unknown) {
    reply = `Something went wrong: ${err instanceof Error ? err.message : "unknown error"}`;
  }

  if (update.chatId) {
    await sendTelegramMessage(reply, { chatId: update.chatId });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ ok: true, reply });
}
