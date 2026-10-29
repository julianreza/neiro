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
  | "mission_error";

export type NotificationEvent = {
  kind: NotificationKind;
  missionId: string;
  taskId?: string | null;
  title: string;
  body: string;
  dedupeKey: string;
};

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

/**
 * Webhook body. `text` makes it work as-is with Slack, Discord (via
 * /slack-compatible URLs) and most chat incoming-webhooks.
 */
export function webhookPayload(event: NotificationEvent, baseUrl: string | undefined) {
  const link = baseUrl ? `${baseUrl.replace(/\/+$/, "")}/missions/${encodeURIComponent(event.missionId)}` : null;
  return {
    text: `${event.title}\n${event.body}${link ? `\n${link}` : ""}`,
    kind: event.kind,
    missionId: event.missionId,
    taskId: event.taskId ?? null,
    title: event.title,
    body: event.body,
    url: link,
  };
}
