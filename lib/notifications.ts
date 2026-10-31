/**
 * Mission notifications: an in-app feed (the `notifications` table) plus an
 * optional webhook (NEIRO_NOTIFY_WEBHOOK_URL). Each event has a dedupe key,
 * so the same thing seen on many ticks is announced once.
 */

export type NotificationKind =
  | "mission_completed"
  | "plan_ready"
  | "task_needs_you"
  | "routing_needs_you"
  | "budget_reached"
  | "mission_error"
  | "bot_action";

/** A button on a notification: the same action as the dashboard's. */
export type NotificationActionId =
  | "approve_plan"
  | "approve_route"
  | "approve_tool_once"
  | "approve_tool_always"
  | "deny_tool"
  | "retry_task";

export type NotificationAction = {
  id: NotificationActionId;
  label: string;
  /** Mission id (approve_plan) or task id (everything else). */
  target: string;
  /** The approval being answered. */
  requestId?: string;
};

export type NotificationEvent = {
  kind: NotificationKind;
  missionId: string;
  taskId?: string | null;
  title: string;
  body: string;
  dedupeKey: string;
  actions?: NotificationAction[];
};

/** Buttons for a waiting tool approval: Always only when Hermes offers it. */
export function approvalActions(
  taskId: string,
  control: { requestId: string; choices: readonly string[] },
): NotificationAction[] {
  const actions: NotificationAction[] = [
    { id: "approve_tool_once", label: "Approve once", target: taskId, requestId: control.requestId },
  ];
  if (control.choices.includes("always")) {
    actions.push({ id: "approve_tool_always", label: "Approve always", target: taskId, requestId: control.requestId });
  }
  actions.push({ id: "deny_tool", label: "Deny", target: taskId, requestId: control.requestId });
  return actions;
}

export type Notifier = (event: NotificationEvent) => Promise<void>;

/** Never let a notification problem break the orchestrator. */
export async function safeNotify(notify: Notifier | undefined, event: NotificationEvent): Promise<void> {
  if (!notify) return;
  try {
    await notify(event);
  } catch (err: unknown) {
    console.warn("[neiro] notification failed", {
      kind: event.kind,
      missionId: event.missionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Short, stable hash for dedupe keys built from free text (FNV-1a). */
export function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Short action codes, so a button's payload fits Telegram's 64-byte callback_data. */
const ACTION_CODE: Record<NotificationActionId, string> = {
  approve_plan: "p",
  approve_route: "r",
  approve_tool_once: "o",
  approve_tool_always: "a",
  deny_tool: "d",
  retry_task: "t",
};
const CODE_ACTION = Object.fromEntries(Object.entries(ACTION_CODE).map(([k, v]) => [v, k])) as Record<
  string,
  NotificationActionId
>;
const PAYLOAD_MAX_BYTES = 64;

/**
 * What a chat-app button carries back: "<code>.<target>[.<requestId>]", or
 * "n.<notificationId>.<index>" when that would not fit in 64 bytes.
 */
export function actionPayload(action: NotificationAction, index: number, notificationId?: string): string {
  const payload = [ACTION_CODE[action.id], action.target, action.requestId].filter(Boolean).join(".");
  if (new TextEncoder().encode(payload).length <= PAYLOAD_MAX_BYTES || !notificationId) return payload;
  return `n.${notificationId}.${index}`;
}

export type ParsedActionPayload =
  | { kind: "action"; action: NotificationAction }
  | { kind: "lookup"; notificationId: string; index: number }
  | null;

export function parseActionPayload(payload: string): ParsedActionPayload {
  const parts = payload.trim().split(".");
  if (parts[0] === "n" && parts.length === 3 && /^\d+$/.test(parts[2])) {
    return { kind: "lookup", notificationId: parts[1], index: Number(parts[2]) };
  }
  const id = CODE_ACTION[parts[0]];
  if (!id || !parts[1] || parts.length > 3) return null;
  return { kind: "action", action: { id, label: id, target: parts[1], requestId: parts[2] || undefined } };
}

export type WebhookFormat = "generic" | "slack" | "discord";

export function webhookFormat(value: string | undefined): WebhookFormat {
  return value === "slack" || value === "discord" ? value : "generic";
}

/**
 * Webhook body. `text` works as-is with Slack, Discord (via /slack-compatible
 * URLs) and most chat incoming-webhooks. Buttons go in the shape the chosen
 * format expects, and only that one: some webhooks refuse unknown fields.
 */
export function webhookPayload(
  event: NotificationEvent & { notificationId?: string },
  baseUrl: string | undefined,
  format: WebhookFormat = "generic",
) {
  const link = baseUrl ? `${baseUrl.replace(/\/+$/, "")}/missions/${encodeURIComponent(event.missionId)}` : null;
  const text = `${event.title}\n${event.body}${link ? `\n${link}` : ""}`;
  const actions = event.actions ?? [];
  if (format === "slack") {
    return {
      text,
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: `*${event.title}*\n${event.body}${link ? `\n<${link}|Open in Neiro>` : ""}` },
        },
        ...(actions.length
          ? [
              {
                type: "actions",
                elements: actions.map((a, i) => ({
                  type: "button",
                  text: { type: "plain_text", text: a.label },
                  value: actionPayload(a, i, event.notificationId),
                  action_id: `neiro_${a.id}_${i}`,
                  ...(a.id === "deny_tool" ? { style: "danger" } : a.id.startsWith("approve") ? { style: "primary" } : {}),
                })),
              },
            ]
          : []),
      ],
    };
  }
  if (format === "discord") {
    return {
      content: text,
      ...(actions.length
        ? {
            components: [
              {
                type: 1,
                components: actions.slice(0, 5).map((a, i) => ({
                  type: 2,
                  style: a.id === "deny_tool" ? 4 : 1,
                  label: a.label,
                  custom_id: actionPayload(a, i, event.notificationId),
                })),
              },
            ],
          }
        : {}),
    };
  }
  return {
    text,
    kind: event.kind,
    missionId: event.missionId,
    taskId: event.taskId ?? null,
    title: event.title,
    body: event.body,
    url: link,
    ...(actions.length ? { actions: actions.map((a, i) => ({ ...a, payload: actionPayload(a, i, event.notificationId) })) } : {}),
  };
}

/** Telegram reply_markup for the same buttons. */
export function telegramKeyboard(actions: NotificationAction[], notificationId?: string) {
  if (actions.length === 0) return undefined;
  return {
    inline_keyboard: [actions.map((a, i) => ({ text: a.label, callback_data: actionPayload(a, i, notificationId) }))],
  };
}
