import assert from "node:assert/strict";
import { test } from "node:test";
import { checkBotSecret, parseBotUpdate } from "./bot-webhook";

const SECRET = "s3cret-s3cret-s3cret";
const env = { NEIRO_BOT_WEBHOOK_SECRET: SECRET, NEIRO_TELEGRAM_CHAT_ID: "42", DASHBOARD_SECRET: "dash-dash-dash-dash" };
const headers = (h: Record<string, string>) => new Headers(h);

test("no secret configured: 503; a wrong or missing secret: denied", () => {
  assert.equal(checkBotSecret(headers({ "x-neiro-bot-secret": SECRET }), {}), "unconfigured");
  assert.equal(checkBotSecret(headers({ "x-neiro-bot-secret": SECRET }), { NEIRO_BOT_WEBHOOK_SECRET: "short" }), "unconfigured");
  assert.equal(checkBotSecret(headers({}), env), "denied");
  assert.equal(checkBotSecret(headers({ "x-neiro-bot-secret": "nope" }), env), "denied");
  assert.equal(checkBotSecret(headers({ "x-neiro-bot-secret": env.DASHBOARD_SECRET }), env), "denied");
  assert.equal(checkBotSecret(headers({ "x-telegram-bot-api-secret-token": SECRET }), env), "ok");
  assert.equal(checkBotSecret(headers({ "x-neiro-bot-secret": SECRET }), env), "ok");
});

test("Telegram updates: only the configured chat; callbacks and text", () => {
  assert.deepEqual(parseBotUpdate({ update_id: 1, message: { chat: { id: 7 }, text: "/status" } }, env), {
    kind: "ignore",
    reason: "chat not allowed",
  });
  assert.deepEqual(parseBotUpdate({ update_id: 1, message: { chat: { id: 42 }, text: "/status" } }, env), {
    kind: "command",
    text: "/status",
    chatId: "42",
  });
  assert.deepEqual(
    parseBotUpdate({ update_id: 2, callback_query: { id: "cb", data: "o.t1.p1", message: { chat: { id: 42 } } } }, env),
    { kind: "callback", id: "cb", data: "o.t1.p1", chatId: "42" },
  );
  assert.equal(parseBotUpdate({ update_id: 3, message: { chat: { id: 42 }, sticker: {} } }, env).kind, "ignore");
  assert.equal(parseBotUpdate({ update_id: 3, message: { chat: { id: 42 }, text: "x" } }, {}).kind, "ignore");
});

test("generic senders: { text } or { action }", () => {
  assert.deepEqual(parseBotUpdate({ text: "/help" }, env), { kind: "command", text: "/help", chatId: null });
  assert.deepEqual(parseBotUpdate({ action: "t.t9" }, env), { kind: "callback", id: "", data: "t.t9", chatId: null });
  assert.equal(parseBotUpdate(null, env).kind, "ignore");
});

test("the proxy lets the webhook skip the cookie only with the right secret", async () => {
  const { isBotWebhookRequest } = await import("../proxy");
  const prev = process.env.NEIRO_BOT_WEBHOOK_SECRET;
  process.env.NEIRO_BOT_WEBHOOK_SECRET = SECRET;
  try {
    const req = (method: string, path: string, h: Record<string, string>) =>
      ({ method, headers: new Headers(h), nextUrl: new URL(`https://neiro.example${path}`) }) as unknown as Parameters<typeof isBotWebhookRequest>[0];
    assert.equal(isBotWebhookRequest(req("POST", "/api/bot/webhook", { "x-neiro-bot-secret": SECRET })), true);
    assert.equal(isBotWebhookRequest(req("POST", "/api/bot/webhook", {})), false);
    assert.equal(isBotWebhookRequest(req("GET", "/api/bot/webhook", { "x-neiro-bot-secret": SECRET })), false);
    assert.equal(isBotWebhookRequest(req("POST", "/api/missions", { "x-neiro-bot-secret": SECRET })), false);
  } finally {
    if (prev === undefined) delete process.env.NEIRO_BOT_WEBHOOK_SECRET;
    else process.env.NEIRO_BOT_WEBHOOK_SECRET = prev;
  }
});
