import { NextResponse } from "next/server";
import { connection } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { listBots } from "@/lib/bots";
import { AppConfigError } from "@/lib/types";

/** GET /api/bots : the Bots roster (handle, section, last message). */
export async function GET() {
  await connection();
  try {
    return NextResponse.json({ bots: await listBots(getSupabaseAdmin()) });
  } catch (err: unknown) {
    if (err instanceof AppConfigError) return NextResponse.json({ error: err.message, code: err.code }, { status: 503 });
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to load bots" }, { status: 500 });
  }
}
