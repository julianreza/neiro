import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase";
import { webhookPayload } from "@/lib/notifications";
import type { NotificationEvent, NotificationKind, Notifier } from "@/lib/notifications";

export type NotificationDTO = {
  id: string;
  kind: NotificationKind;
  missionId: string | null;
  taskId: string | null;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
};

const WEBHOOK_TIMEOUT_MS = 5_000;

async function postWebhook(event: NotificationEvent): Promise<void> {
  const url = process.env.NEIRO_NOTIFY_WEBHOOK_URL?.trim();
  if (!url) return;
  if (!/^https:\/\//i.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(url)) {
    console.warn("[neiro] NEIRO_NOTIFY_WEBHOOK_URL must be https:// (or http://localhost); skipped");
    return;
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(webhookPayload(event, process.env.NEIRO_PUBLIC_URL)),
    signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`webhook answered ${res.status}`);
}

/**
 * Records the event once (by dedupe_key). Only the call that actually
 * inserted the row sends the webhook, so a repeat never pings twice.
 */
export const supabaseNotifier: Notifier = async (event) => {
  const { data, error } = await getSupabaseAdmin()
    .from("notifications")
    .upsert(
      {
        kind: event.kind,
        mission_id: event.missionId,
        task_id: event.taskId ?? null,
        title: event.title.slice(0, 300),
        body: event.body.slice(0, 2000),
        dedupe_key: event.dedupeKey.slice(0, 300),
      },
      { onConflict: "dedupe_key", ignoreDuplicates: true }
    )
    .select("id");
  if (error) throw new Error(error.message);
  if ((data?.length ?? 0) > 0) await postWebhook(event);
};

export async function listNotifications(limit = 50): Promise<{ items: NotificationDTO[]; unread: number }> {
  const db = getSupabaseAdmin();
  const [{ data, error }, unreadRes] = await Promise.all([
    db.from("notifications").select("*").order("created_at", { ascending: false }).limit(limit),
    db.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
  ]);
  if (error) throw new Error(error.message);
  if (unreadRes.error) throw new Error(unreadRes.error.message);
  const items = (data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id),
    kind: row.kind as NotificationKind,
    missionId: typeof row.mission_id === "string" ? row.mission_id : null,
    taskId: typeof row.task_id === "string" ? row.task_id : null,
    title: String(row.title ?? ""),
    body: String(row.body ?? ""),
    readAt: typeof row.read_at === "string" ? row.read_at : null,
    createdAt: String(row.created_at ?? ""),
  }));
  return { items, unread: unreadRes.count ?? 0 };
}

/** Marks the given ids read, or every unread one when ids is omitted. */
export async function markNotificationsRead(ids?: string[]): Promise<void> {
  let query = getSupabaseAdmin()
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .is("read_at", null);
  if (ids) query = query.in("id", ids);
  const { error } = await query;
  if (error) throw new Error(error.message);
}
