import assert from "node:assert/strict";
import { test } from "node:test";
import {
  actionPayload,
  approvalActions,
  parseActionPayload,
  telegramKeyboard,
  webhookFormat,
  webhookPayload,
  type NotificationEvent,
} from "./notifications";

const event: NotificationEvent = {
  kind: "task_needs_you",
  missionId: "m1",
  taskId: "t1",
  title: "An agent asks to use a tool",
  body: "Forge wants to run bash",
  dedupeKey: "approval:t1:p1",
  actions: approvalActions("t1", { requestId: "p1", choices: ["once", "always", "deny"] }),
};

test("each format carries only its own fields, and always the text", () => {
  const slack = webhookPayload(event, "https://neiro.example", "slack") as Record<string, unknown>;
  assert.deepEqual(Object.keys(slack).sort(), ["blocks", "text"]);
  const discord = webhookPayload(event, undefined, "discord") as Record<string, unknown>;
  assert.deepEqual(Object.keys(discord).sort(), ["components", "content"]);
  assert.match(String(discord.content), /Forge wants to run bash/);
  const generic = webhookPayload(event, undefined) as Record<string, unknown>;
  assert.equal(generic.text, "An agent asks to use a tool\nForge wants to run bash");
  assert.equal((generic.actions as unknown[]).length, 3);
  const plain = webhookPayload({ ...event, actions: undefined }, undefined) as Record<string, unknown>;
  assert.equal("actions" in plain, false);
  assert.equal(webhookFormat("slack"), "slack");
  assert.equal(webhookFormat("teams"), "generic");
});

test("button payloads round-trip, and a long one becomes a notification lookup", () => {
  const once = actionPayload(event.actions![0], 0);
  assert.equal(once, "o.t1.p1");
  assert.deepEqual(parseActionPayload(once), {
    kind: "action",
    action: { id: "approve_tool_once", label: "approve_tool_once", target: "t1", requestId: "p1" },
  });
  const long = { id: "deny_tool" as const, label: "Deny", target: "x".repeat(60), requestId: "y".repeat(20) };
  assert.equal(actionPayload(long, 2, "n-123"), "n.n-123.2");
  assert.deepEqual(parseActionPayload("n.n-123.2"), { kind: "lookup", notificationId: "n-123", index: 2 });
  assert.equal(parseActionPayload("z.t1"), null);
  assert.equal(parseActionPayload("o"), null);
});

test("Always is offered only when Hermes allows it", () => {
  assert.deepEqual(approvalActions("t1", { requestId: "p", choices: ["once", "deny"] }).map((a) => a.id), ["approve_tool_once", "deny_tool"]);
  const kb = telegramKeyboard(event.actions!);
  assert.deepEqual(kb?.inline_keyboard[0].map((b) => b.callback_data), ["o.t1.p1", "a.t1.p1", "d.t1.p1"]);
  assert.equal(telegramKeyboard([]), undefined);
});
