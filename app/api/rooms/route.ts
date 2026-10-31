import { NextResponse } from "next/server";
import { connection } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { loadBotAgents } from "@/lib/bots";
import { mapRoomRow, parseRoomInput } from "@/lib/rooms-store";
import { newRoomId } from "@/lib/rooms";
import { roomError } from "@/lib/rooms-route";

/** GET /api/rooms : every Group room, pinned first, then newest. */
export async function GET() {
  await connection();
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("bot_rooms")
      .select("*")
      .order("pinned", { ascending: false })
      .order("updated_at", { ascending: false });
    if (error) return roomError(error.message);
    return NextResponse.json({ rooms: (data ?? []).map((r) => mapRoomRow(r)) });
  } catch (err: unknown) {
    return roomError(err);
  }
}

/** POST { name, memberAgentIds: string[2..6], section? } */
export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const enabled = new Set((await loadBotAgents(supabase)).map((a) => a.id));
    const parsed = parseRoomInput(await request.json().catch(() => null), enabled);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const { data, error } = await supabase
      .from("bot_rooms")
      .insert({
        id: newRoomId(),
        name: parsed.value.name,
        member_agent_ids: parsed.value.memberAgentIds,
        section: parsed.value.section ?? null,
        pinned: parsed.value.pinned ?? false,
      })
      .select()
      .single();
    if (error) {
      if (error.code === "23505") return NextResponse.json({ error: "A room with this name already exists." }, { status: 409 });
      return roomError(error.message);
    }
    return NextResponse.json({ room: mapRoomRow(data) }, { status: 201 });
  } catch (err: unknown) {
    return roomError(err);
  }
}
