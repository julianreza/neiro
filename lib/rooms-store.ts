import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { BotRoom, BotRoomMessage, RoomDriver } from "@/lib/types";

/**
 * bot_rooms / bot_room_messages (20261031000000_hermes_full_suite.sql),
 * server-only through the service role. The room driver (lib/rooms.ts) talks
 * to this through the RoomStore interface so tests can use memory.
 */

export const ROOM_LIMITS = { minMembers: 2, maxMembers: 6, name: 80, message: 20000, history: 200 } as const;

export interface RoomStore {
  getRoom(id: string): Promise<BotRoom | null>;
  /** Rooms whose driver is running and that are not waiting on the user. */
  listActiveRooms(): Promise<BotRoom[]>;
  /** Newest `limit` messages, oldest first. */
  listMessages(roomId: string, limit?: number): Promise<BotRoomMessage[]>;
  addMessage(msg: Omit<BotRoomMessage, "createdAt"> & { createdAt?: string }): Promise<BotRoomMessage>;
  /**
   * Writes the room only if it was not changed since `updatedAt` was read;
   * true when this call won.
   */
  updateRoomIf(id: string, updatedAt: string, patch: Partial<Pick<BotRoom, "driver" | "needsYou" | "memberSessions" | "name" | "memberAgentIds" | "pinned" | "section">>): Promise<boolean>;
}

type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : null);
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export function mapRoomRow(r: Row): BotRoom {
  const sessions = r.member_sessions && typeof r.member_sessions === "object" ? (r.member_sessions as Record<string, unknown>) : {};
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    avatarUrl: str(r.avatar_url),
    memberAgentIds: strings(r.member_agent_ids),
    detectStopDirectives: r.detect_stop_directives !== false,
    needsYou: r.needs_you === true,
    pinned: r.pinned === true,
    section: str(r.section),
    memberSessions: Object.fromEntries(Object.entries(sessions).filter(([, v]) => typeof v === "string")) as Record<string, string>,
    driver: r.driver && typeof r.driver === "object" ? (r.driver as RoomDriver) : null,
    createdAt: String(r.created_at ?? ""),
    updatedAt: String(r.updated_at ?? ""),
  };
}

export function mapRoomMessageRow(r: Row): BotRoomMessage {
  const kind = r.sender_kind === "bot" || r.sender_kind === "system" ? r.sender_kind : "user";
  return {
    id: String(r.id),
    roomId: String(r.room_id),
    senderKind: kind,
    senderAgentId: str(r.sender_agent_id),
    senderName: String(r.sender_name ?? ""),
    content: String(r.content ?? ""),
    mentions: strings(r.mentions),
    threadRootId: str(r.thread_root_id),
    runId: str(r.run_id),
    createdAt: String(r.created_at ?? ""),
  };
}

function patchRow(patch: Parameters<RoomStore["updateRoomIf"]>[2]): Row {
  const row: Row = {};
  if (patch.driver !== undefined) row.driver = patch.driver;
  if (patch.needsYou !== undefined) row.needs_you = patch.needsYou;
  if (patch.memberSessions !== undefined) row.member_sessions = patch.memberSessions;
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.memberAgentIds !== undefined) row.member_agent_ids = patch.memberAgentIds;
  if (patch.pinned !== undefined) row.pinned = patch.pinned;
  if (patch.section !== undefined) row.section = patch.section;
  return row;
}

export function createRoomStore(client?: SupabaseClient): RoomStore {
  const db = () => client ?? getSupabaseAdmin();
  return {
    async getRoom(id) {
      const { data, error } = await db().from("bot_rooms").select("*").eq("id", id).maybeSingle();
      if (error) throw new Error(error.message);
      return data ? mapRoomRow(data) : null;
    },
    async listActiveRooms() {
      const { data, error } = await db().from("bot_rooms").select("*").not("driver", "is", null).eq("needs_you", false);
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => mapRoomRow(r));
    },
    async listMessages(roomId, limit = ROOM_LIMITS.history) {
      const { data, error } = await db()
        .from("bot_room_messages")
        .select("*")
        .eq("room_id", roomId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => mapRoomMessageRow(r)).reverse();
    },
    async addMessage(m) {
      const { data, error } = await db()
        .from("bot_room_messages")
        .insert({
          id: m.id,
          room_id: m.roomId,
          sender_kind: m.senderKind,
          sender_agent_id: m.senderAgentId,
          sender_name: m.senderName,
          content: m.content,
          mentions: m.mentions,
          thread_root_id: m.threadRootId,
          run_id: m.runId,
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return mapRoomMessageRow(data);
    },
    async updateRoomIf(id, updatedAt, patch) {
      const { data, error } = await db()
        .from("bot_rooms")
        .update({ ...patchRow(patch), updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("updated_at", updatedAt)
        .select("id");
      if (error) throw new Error(error.message);
      return (data ?? []).length === 1;
    },
  };
}

/** Name 1-80 characters, 2-6 distinct enabled member ids. */
export function parseRoomInput(
  body: unknown,
  enabledIds: ReadonlySet<string>,
  partial = false,
): { ok: true; value: { name?: string; memberAgentIds?: string[]; section?: string | null; pinned?: boolean } } | { ok: false; error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const out: { name?: string; memberAgentIds?: string[]; section?: string | null; pinned?: boolean } = {};
  if (b.name !== undefined || !partial) {
    const name = typeof b.name === "string" ? b.name.trim() : "";
    if (!name || name.length > ROOM_LIMITS.name) return { ok: false, error: `A room name is 1-${ROOM_LIMITS.name} characters.` };
    out.name = name;
  }
  if (b.memberAgentIds !== undefined || !partial) {
    const ids = Array.isArray(b.memberAgentIds) ? [...new Set(b.memberAgentIds.filter((x): x is string => typeof x === "string"))] : [];
    if (ids.length < ROOM_LIMITS.minMembers || ids.length > ROOM_LIMITS.maxMembers) {
      return { ok: false, error: `A room has ${ROOM_LIMITS.minMembers} to ${ROOM_LIMITS.maxMembers} bots.` };
    }
    const off = ids.find((id) => !enabledIds.has(id));
    if (off) return { ok: false, error: `Bot ${off} is not turned on.` };
    out.memberAgentIds = ids;
  }
  if (b.section !== undefined) {
    if (b.section !== null && (typeof b.section !== "string" || b.section.length > 40)) return { ok: false, error: "section is at most 40 characters" };
    out.section = typeof b.section === "string" && b.section.trim() ? b.section.trim() : null;
  }
  if (b.pinned !== undefined) {
    if (typeof b.pinned !== "boolean") return { ok: false, error: "pinned must be true or false" };
    out.pinned = b.pinned;
  }
  return { ok: true, value: out };
}
