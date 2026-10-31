import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { onUserMessage } from "@/lib/rooms";
import { roomDeps } from "@/lib/rooms-runtime";
import { ROOM_LIMITS } from "@/lib/rooms-store";
import { roomError, validRoomId } from "@/lib/rooms-route";

type RouteContext = { params: Promise<{ roomId: string }> };

/** POST { message } : saved at once; the bots take their turns on the next ticks. */
export async function POST(request: NextRequest, context: RouteContext) {
  const { roomId } = await context.params;
  if (!validRoomId(roomId)) return NextResponse.json({ error: "Invalid room id" }, { status: 400 });
  try {
    const body = (await request.json().catch(() => null)) as { message?: unknown } | null;
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    if (!message) return NextResponse.json({ error: "Write a message first." }, { status: 400 });
    if (message.length > ROOM_LIMITS.message) {
      return NextResponse.json({ error: `A message can be at most ${ROOM_LIMITS.message} characters.` }, { status: 400 });
    }
    const saved = await onUserMessage(roomId, message, roomDeps());
    return NextResponse.json({ message: saved }, { status: 201 });
  } catch (err: unknown) {
    const text = err instanceof Error ? err.message : "";
    if (text === "Room not found") return NextResponse.json({ error: text }, { status: 404 });
    if (text.startsWith("The room is busy")) return NextResponse.json({ error: text }, { status: 409 });
    return roomError(err);
  }
}
