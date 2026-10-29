import { NextResponse } from "next/server";
import { connection } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { ASK_TABLE, MISSING_ASK_TABLE, isMissingAskTable, mapAskRow } from "@/lib/ask-history";
import { groupThreads } from "@/lib/chats";
import { AppConfigError } from "@/lib/types";

/** Newest questions read to build the chat list. */
const LIMIT = 300;

/** Chats (chains of Ask questions), newest activity first. */
export async function GET() {
  await connection();
  try {
    const { data, error } = await getSupabaseAdmin()
      .from(ASK_TABLE)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(LIMIT);
    if (error) {
      if (isMissingAskTable(error.message)) {
        return NextResponse.json({ error: MISSING_ASK_TABLE, code: "missing_table" }, { status: 503 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ chats: groupThreads((data ?? []).map(mapAskRow)) });
  } catch (err: unknown) {
    if (err instanceof AppConfigError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 503 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not load chats" }, { status: 500 });
  }
}
