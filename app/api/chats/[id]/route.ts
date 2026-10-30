import { NextResponse } from "next/server";
import { connection } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { ASK_TABLE } from "@/lib/ask-history";
import { AppConfigError } from "@/lib/types";

type RouteContext = { params: Promise<{ id: string }> };

/** Run ids are Hermes ids: letters, digits, `_` and `-`. */
const ID = /^[A-Za-z0-9_-]{1,100}$/;
/** Follow-up chains longer than this are cut off (a guard, not a real limit). */
const MAX_DEPTH = 200;

/**
 * Delete one chat: its first question (`id`) and every follow-up, found by
 * session id and by the `follow_up_of` chain. Admin only (enforced in proxy.ts).
 */
export async function DELETE(_request: NextRequest, context: RouteContext) {
  await connection();
  const { id } = await context.params;
  if (!ID.test(id)) return NextResponse.json({ error: "Invalid chat id" }, { status: 400 });

  try {
    const supabase = getSupabaseAdmin();
    const ids = new Set<string>([id]);

    const session = await supabase.from(ASK_TABLE).select("id").eq("session_id", id);
    if (session.error) return NextResponse.json({ error: session.error.message }, { status: 500 });
    for (const row of session.data ?? []) ids.add(String(row.id));

    // Older rows may only be linked through follow_up_of.
    let frontier = [...ids];
    for (let depth = 0; frontier.length > 0 && depth < MAX_DEPTH; depth += 1) {
      const next = await supabase.from(ASK_TABLE).select("id").in("follow_up_of", frontier);
      if (next.error) return NextResponse.json({ error: next.error.message }, { status: 500 });
      frontier = (next.data ?? []).map((row) => String(row.id)).filter((rowId) => !ids.has(rowId));
      for (const rowId of frontier) ids.add(rowId);
    }

    const { error } = await supabase.from(ASK_TABLE).delete().in("id", [...ids]);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, deleted: ids.size });
  } catch (err: unknown) {
    if (err instanceof AppConfigError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 503 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not delete the chat" }, { status: 500 });
  }
}
