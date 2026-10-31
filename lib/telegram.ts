import "server-only";
import { telegramKeyboard, type NotificationAction } from "@/lib/notifications";

/**
 * Telegram Bot API for Neiro's own bot: outbound notifications with buttons,
 * replies to commands, and callback answers. Configured with
 * NEIRO_TELEGRAM_BOT_TOKEN and NEIRO_TELEGRAM_CHAT_ID; the bot credential is
 * only ever put in the request URL, never logged.
 */

const TIMEOUT_MS = 5_000;
const MESSAGE_MAX = 4000;

export function telegramConfig(env: Record<string, string | undefined> = process.env): { bot: string; chatId: string } | null {
  const bot = env.NEIRO_TELEGRAM_BOT_TOKEN?.trim();
  const chatId = env.NEIRO_TELEGRAM_CHAT_ID?.trim();
  return bot && chatId ? { bot, chatId } : null;
}

async function call(method: string, body: Record<string, unknown>): Promise<boolean> {
  const cfg = telegramConfig();
  if (!cfg) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${cfg.bot}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) console.warn(`[neiro] telegram ${method} answered ${res.status}`);
    return res.ok;
  } catch (err: unknown) {
    console.warn(`[neiro] telegram ${method} failed:`, err instanceof Error ? err.name : "error");
    return false;
  }
}

/** Sends to the configured chat (or `chatId`), with buttons when given. */
export function sendTelegramMessage(
  text: string,
  opts: { actions?: NotificationAction[]; notificationId?: string; chatId?: string } = {},
): Promise<boolean> {
  const cfg = telegramConfig();
  if (!cfg) return Promise.resolve(false);
  const keyboard = telegramKeyboard(opts.actions ?? [], opts.notificationId);
  return call("sendMessage", {
    chat_id: opts.chatId ?? cfg.chatId,
    text: text.length > MESSAGE_MAX ? `${text.slice(0, MESSAGE_MAX - 1)}…` : text,
    disable_web_page_preview: true,
    ...(keyboard ? { reply_markup: keyboard } : {}),
  });
}

export function answerCallbackQuery(id: string, text: string): Promise<boolean> {
  return call("answerCallbackQuery", { callback_query_id: id, text: text.slice(0, 190) });
}
