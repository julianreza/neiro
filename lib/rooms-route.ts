import { NextResponse } from "next/server";
import { AppConfigError } from "@/lib/types";

const ROOM_ID = /^room_[a-f0-9]{16}$/;

export function validRoomId(id: string): boolean {
  return ROOM_ID.test(id);
}

/** A room route failure: a missing table means the migration was not run. */
export function roomError(err: unknown): NextResponse {
  if (err instanceof AppConfigError) return NextResponse.json({ error: err.message, code: err.code }, { status: 503 });
  const message = err instanceof Error ? err.message : String(err);
  if (/bot_rooms|bot_room_messages/.test(message) && /exist|schema cache/i.test(message)) {
    return NextResponse.json(
      { error: "Group rooms need supabase/migrations/20261031000000_hermes_full_suite.sql. Run it in Supabase first." },
      { status: 409 },
    );
  }
  return NextResponse.json({ error: message || "Room request failed" }, { status: 500 });
}
