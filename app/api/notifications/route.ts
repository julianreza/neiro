import { NextResponse } from "next/server";
import { connection } from "next/server";
import type { NextRequest } from "next/server";
import { listNotifications, markNotificationsRead } from "@/lib/notifications-store";
import { AppConfigError } from "@/lib/types";

function failure(err: unknown, fallback: string) {
  if (err instanceof AppConfigError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: 503 });
  }
  const message = err instanceof Error ? err.message : fallback;
  const hint = /notifications/.test(message) && /does not exist|schema cache/i.test(message)
    ? " Apply supabase/migrations/20261028000300_budgets_notifications.sql."
    : "";
  return NextResponse.json({ error: message + hint }, { status: hint ? 503 : 500 });
}

/** Newest notifications plus the unread count. `?limit=` 1-200, default 50. */
export async function GET(request: NextRequest) {
  await connection();
  const raw = Number(request.nextUrl.searchParams.get("limit"));
  const limit = Number.isInteger(raw) && raw > 0 ? Math.min(raw, 200) : 50;
  try {
    return NextResponse.json(await listNotifications(limit), { status: 200 });
  } catch (err: unknown) {
    return failure(err, "Failed to load notifications");
  }
}

/** Mark read: `{ ids: string[] }`, or `{}` for all. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const ids = body?.ids;
  if (ids !== undefined && (!Array.isArray(ids) || ids.some((i: unknown) => typeof i !== "string") || ids.length > 200)) {
    return NextResponse.json({ error: "ids must be an array of up to 200 strings" }, { status: 400 });
  }
  try {
    await markNotificationsRead(ids);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: unknown) {
    return failure(err, "Failed to update notifications");
  }
}
