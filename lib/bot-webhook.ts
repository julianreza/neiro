import { timingSafeEqualString } from "@/lib/auth";

/**
 * POST /api/bot/webhook checks, kept pure for tests. The shared secret is
 * NEIRO_BOT_WEBHOOK_SECRET, sent by Telegram as X-Telegram-Bot-Api-Secret-Token
 * (setWebhook secret_token) or by any other sender as X-Neiro-Bot-Secret.
 * DASHBOARD_SECRET is never accepted here.
 */

export const BOT_WEBHOOK_PATH = "/api/bot/webhook";
export const BOT_WEBHOOK_MAX_BYTES = 64 * 1024;
const SECRET_HEADERS = ["x-telegram-bot-api-secret-token", "x-neiro-bot-secret"] as const;
const MIN_SECRET = 16;

export type SecretCheck = "ok" | "unconfigured" | "denied";

export function checkBotSecret(
  headers: Pick<Headers, "get">,
  env: Record<string, string | undefined> = process.env,
): SecretCheck {
  const secret = env.NEIRO_BOT_WEBHOOK_SECRET?.trim() ?? "";
  if (secret.length < MIN_SECRET) return "unconfigured";
  for (const name of SECRET_HEADERS) {
    const sent = headers.get(name);
    if (sent && timingSafeEqualString(sent, secret)) return "ok";
  }
  return "denied";
}

export type BotUpdate =
  | { kind: "command"; text: string; chatId: string | null }
  | { kind: "callback"; id: string; data: string; chatId: string | null }
  | { kind: "ignore"; reason: string };

/**
 * A Telegram update, or a generic { text } / { action } body. Telegram
 * messages from any chat other than NEIRO_TELEGRAM_CHAT_ID are ignored.
 */
export function parseBotUpdate(body: unknown, env: Record<string, string | undefined> = process.env): BotUpdate {
  if (!body || typeof body !== "object") return { kind: "ignore", reason: "no body" };
  const b = body as Record<string, unknown>;
  const allowed = env.NEIRO_TELEGRAM_CHAT_ID?.trim();
  const chatOf = (v: unknown): string | null => {
    const chat = v && typeof v === "object" ? (v as Record<string, unknown>).chat : null;
    const id = chat && typeof chat === "object" ? (chat as Record<string, unknown>).id : null;
    return typeof id === "number" || typeof id === "string" ? String(id) : null;
  };
  if ("update_id" in b) {
    const message = b.message && typeof b.message === "object" ? (b.message as Record<string, unknown>) : null;
    const callback = b.callback_query && typeof b.callback_query === "object" ? (b.callback_query as Record<string, unknown>) : null;
    const chatId = message ? chatOf(message) : callback ? chatOf(callback.message) : null;
    if (!allowed || chatId !== allowed) return { kind: "ignore", reason: "chat not allowed" };
    if (callback && typeof callback.id === "string" && typeof callback.data === "string") {
      return { kind: "callback", id: callback.id, data: callback.data, chatId };
    }
    if (message && typeof message.text === "string") return { kind: "command", text: message.text, chatId };
    return { kind: "ignore", reason: "not a text message" };
  }
  if (typeof b.action === "string") return { kind: "callback", id: "", data: b.action, chatId: null };
  if (typeof b.text === "string") return { kind: "command", text: b.text, chatId: null };
  return { kind: "ignore", reason: "unknown body" };
}
