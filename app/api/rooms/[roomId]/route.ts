import { NextResponse } from "next/server";
import { connection } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { loadBotAgents } from "@/lib/bots";
import { createRoomStore, parseRoomInput } from "@/lib/rooms-store";
import { roomError, validRoomId } from "@/lib/rooms-route";

type RouteContext = { params: Promise<{ roomId: string }> };

/** GET : the room and its last 200 messages. */
export async function GET(_request: NextRequest, context: RouteContext) {
  await connection();
  const { roomId } = await context.params;
  if (!validRoomId(roomId)) return NextResponse.json({ error: "Invalid room id" }, { status: 400 });
  try {
    const store = createRoomStore();
    const room = await store.getRoom(roomId);
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
    return NextResponse.json({ room, messages: await store.listMessages(roomId) });
  } catch (err: unknown) {
    return roomError(err);
  }
}

/** PATCH { name?, memberAgentIds?, section?, pinned? } */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { roomId } = await context.params;
  if (!validRoomId(roomId)) return NextResponse.json({ error: "Invalid room id" }, { status: 400 });
  try {
    const enabled = new Set((await loadBotAgents(getSupabaseAdmin())).map((a) => a.id));
    const parsed = parseRoomInput(await request.json().catch(() => null), enabled, true);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    if (Object.keys(parsed.value).length === 0) return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
    const store = createRoomStore();
    const room = await store.getRoom(roomId);
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
    const won = await store.updateRoomIf(roomId, room.updatedAt, parsed.value);
    if (!won) return NextResponse.json({ error: "The room changed. Try again." }, { status: 409 });
    return NextResponse.json({ room: await store.getRoom(roomId) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (/duplicate key|23505/.test(message)) return NextResponse.json({ error: "A room with this name already exists." }, { status: 409 });
    return roomError(err);
  }
}

/** DELETE : the room and all its messages. */
export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { roomId } = await context.params;
  if (!validRoomId(roomId)) return NextResponse.json({ error: "Invalid room id" }, { status: 400 });
  try {
    const { error } = await getSupabaseAdmin().from("bot_rooms").delete().eq("id", roomId);
    if (error) return roomError(error.message);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return roomError(err);
  }
}
