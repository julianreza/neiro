import { randomUUID } from "node:crypto";
import { createSession, getRun, startRun, stopRun } from "@/lib/agent-runtime";
import { loadBotAgents } from "@/lib/bots";
import { advanceRooms, type RoomDeps } from "@/lib/rooms";
import { createRoomStore } from "@/lib/rooms-store";
import { getSupabaseAdmin } from "@/lib/supabase";

/** The real room driver dependencies (Supabase + agent runtimes). */
export function roomDeps(): RoomDeps {
  return {
    store: createRoomStore(),
    agents: () => loadBotAgents(getSupabaseAdmin()),
    startRun,
    getRun,
    stopRun,
    createSession,
    now: () => new Date(),
    newId: () => randomUUID(),
  };
}

/** One step for each running Group room. A missing bot_rooms table is not an error. */
export async function advanceAllRooms(): Promise<string[]> {
  try {
    const { errors } = await advanceRooms(roomDeps());
    return errors;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (/bot_rooms|relation .* does not exist|schema cache/i.test(message)) return [];
    return [`Rooms: ${message}`];
  }
}
