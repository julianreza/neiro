import { randomUUID } from "node:crypto";
import { assignHandles, parseMentions, rosterBlock } from "@/lib/mentions";
import { classifyRun } from "@/lib/orchestrator";
import type { HermesRunStatus, HermesStartRunResult } from "@/lib/hermes";
import type { RunStartInput } from "@/lib/agent-runtime";
import type { RoomStore } from "@/lib/rooms-store";
import type { Agent, BotRoom, BotRoomMessage, RoomDriver } from "@/lib/types";

/**
 * Group rooms (Hermes Bot Mode): one user message starts at most 3 serial
 * rounds and 10 bot replies. Each tick takes one step per room (finish the
 * bot that is speaking, or start the next one), and every write is guarded
 * by the room's updated_at, so two ticks never run the same turn and a
 * restart picks up where it stopped.
 */

export const MAX_ROUNDS = 3;
export const MAX_REPLIES = 10;
export const TURN_TIMEOUT_MS = 10 * 60_000;
const TRANSCRIPT_MESSAGES = 30;
const TRANSCRIPT_CHARS = 8000;
const PASS = /^\s*pass\s*\.?\s*$/i;

export type RoomDeps = {
  store: RoomStore;
  /** Enabled agents (room members are looked up here). */
  agents: () => Promise<Agent[]>;
  startRun: (agent: Agent, input: RunStartInput) => Promise<HermesStartRunResult>;
  getRun: (agent: Agent, runId: string) => Promise<HermesRunStatus>;
  stopRun: (agent: Agent, runId: string) => Promise<boolean>;
  createSession: (agent: Agent, title: string) => Promise<string>;
  now: () => Date;
  newId: () => string;
};

export const roomMemoryKey = (roomId: string) => `neiro:room:${roomId}`;

type Member = { agent: Agent; handle: string };

async function membersOf(room: BotRoom, deps: RoomDeps): Promise<{ members: Member[]; handles: Map<string, string> }> {
  const agents = await deps.agents();
  const handles = assignHandles(agents);
  const members = room.memberAgentIds.flatMap((id) => {
    const agent = agents.find((a) => a.id === id);
    return agent ? [{ agent, handle: handles.get(id) ?? id }] : [];
  });
  return { members, handles };
}

async function system(deps: RoomDeps, room: BotRoom, content: string) {
  await deps.store.addMessage({
    id: deps.newId(),
    roomId: room.id,
    senderKind: "system",
    senderAgentId: null,
    senderName: "Room",
    content,
    mentions: [],
    threadRootId: null,
    runId: null,
  });
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}

/** Who speaks in round 1: the bots @mentioned, else (or with @all) everyone. */
export function firstQueue(members: Member[], mentioned: string[], all: boolean, paused: string[]): string[] {
  const byHandle = new Map(members.map((m) => [m.handle, m.agent.id]));
  const picked = all || mentioned.length === 0 ? members.map((m) => m.agent.id) : mentioned.flatMap((h) => byHandle.get(h) ?? []);
  return unique(picked).filter((id) => !paused.includes(id));
}

/**
 * A user's message: saved, its stop/pause directives applied, and the rounds
 * (re)started. While a driver runs, the message joins the transcript and
 * decides who speaks from the next round on.
 */
export async function onUserMessage(
  roomId: string,
  text: string,
  deps: RoomDeps,
  senderName = "You",
): Promise<BotRoomMessage> {
  let saved: BotRoomMessage | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const room = await deps.store.getRoom(roomId);
    if (!room) throw new Error("Room not found");
    const { members } = await membersOf(room, deps);
    const parsed = parseMentions(text, members.map((m) => m.handle));
    const byHandle = new Map(members.map((m) => [m.handle, m.agent.id]));
    const paused = new Set(room.driver?.paused ?? []);
    let stopRoom = false;
    if (room.detectStopDirectives) {
      for (const s of parsed.stops) {
        if (s.handle === "room") stopRoom = true;
        else {
          const id = byHandle.get(s.handle);
          if (id) paused.add(id);
        }
      }
    }
    if (!saved) {
      saved = await deps.store.addMessage({
        id: deps.newId(),
        roomId,
        senderKind: "user",
        senderAgentId: null,
        senderName,
        content: text,
        mentions: parsed.handles,
        threadRootId: null,
        runId: null,
      });
    }
    let driver: RoomDriver | null;
    if (stopRoom) {
      driver = null;
    } else if (room.driver) {
      const next = firstQueue(members, parsed.handles, parsed.all, [...paused]);
      driver = { ...room.driver, paused: [...paused], nextRound: next, queue: room.driver.queue.filter((id) => !paused.has(id)) };
    } else {
      const queue = firstQueue(members, parsed.handles, parsed.all, [...paused]);
      driver = queue.length
        ? { triggerMessageId: saved.id, round: 1, queue, nextRound: [], turnsThisRound: 0, passesThisRound: 0, replies: 0, paused: [...paused], claim: null }
        : null;
    }
    const won = await deps.store.updateRoomIf(room.id, room.updatedAt, { driver, needsYou: false });
    if (!won) continue;
    if (stopRoom && room.driver?.claim) {
      const member = members.find((m) => m.agent.id === room.driver?.claim?.agentId);
      if (member && !room.driver.claim.runId.startsWith("claim:")) await deps.stopRun(member.agent, room.driver.claim.runId).catch(() => false);
    }
    if (stopRoom) await system(deps, room, "Room stopped.");
    return saved;
  }
  throw new Error("The room is busy. Try again.");
}

/** The transcript a bot reads: messages since its last own reply (at most 30), as "Name (@handle): text". */
export function transcriptFor(agentId: string, messages: BotRoomMessage[], handles: Map<string, string>): string {
  let start = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].senderAgentId === agentId && messages[i].senderKind === "bot") {
      start = i + 1;
      break;
    }
  }
  const lines = messages
    .slice(Math.max(start, messages.length - TRANSCRIPT_MESSAGES))
    .map((m) => {
      const handle = m.senderAgentId ? handles.get(m.senderAgentId) : undefined;
      return `${m.senderName}${handle ? ` (@${handle})` : ""}: ${m.content}`;
    });
  const text = lines.join("\n\n");
  return text.length > TRANSCRIPT_CHARS ? `…${text.slice(-TRANSCRIPT_CHARS)}` : text;
}

export function roomRules(members: Member[], self: Member): string {
  return [
    `You are ${self.agent.name} (@${self.handle}) in a group room with: ${members.map((m) => `@${m.handle}`).join(", ")}.`,
    "Reply only if you add something new, in at most 6 sentences.",
    "If you have nothing to add, reply with exactly PASS.",
    "Mention @user only when a human must decide.",
    rosterBlock(members.filter((m) => m !== self).map((m) => ({ handle: m.handle, name: m.agent.name, role: m.agent.role }))),
  ].join("\n");
}

const isTerminal = (status: string) => classifyRun(status) !== "pending";

/** One step of one room's driver. Returns what it did, for logs and tests. */
export async function advanceRoom(roomId: string, deps: RoomDeps): Promise<string> {
  const room = await deps.store.getRoom(roomId);
  if (!room || !room.driver || room.needsYou) return "idle";
  const d: RoomDriver = { ...room.driver };
  const { members, handles } = await membersOf(room, deps);
  const save = (patch: Parameters<RoomStore["updateRoomIf"]>[2]) => deps.store.updateRoomIf(room.id, room.updatedAt, patch);

  // 1. Someone is speaking: wait for them, or take their reply.
  if (d.claim) {
    const member = members.find((m) => m.agent.id === d.claim!.agentId);
    const claim = d.claim;
    if (!member) {
      d.claim = null;
      d.turnsThisRound += 1;
      return (await save({ driver: d })) ? "member-gone" : "lost";
    }
    if (claim.runId.startsWith("claim:")) {
      // A start that never finished (crash): give the turn up after the timeout.
      if (deps.now().getTime() - Date.parse(claim.startedAt) < TURN_TIMEOUT_MS) return "starting";
      d.claim = null;
      d.turnsThisRound += 1;
      return (await save({ driver: d })) ? "start-timeout" : "lost";
    }
    const run = await deps.getRun(member.agent, claim.runId);
    const waiting = (run.controls ?? []).some((c) => c.kind === "approval") || run.status === "waiting_for_approval";
    if (waiting) {
      if (!(await save({ needsYou: true }))) return "lost";
      await system(deps, room, `${member.agent.name} needs your approval to use a tool. Answer it, then press Resume.`);
      return "needs-approval";
    }
    if (!isTerminal(run.status)) {
      if (deps.now().getTime() - Date.parse(claim.startedAt) < TURN_TIMEOUT_MS) return "speaking";
      await deps.stopRun(member.agent, claim.runId).catch(() => false);
      d.claim = null;
      d.turnsThisRound += 1;
      if (!(await save({ driver: d }))) return "lost";
      await system(deps, room, `${member.agent.name} took too long and was skipped.`);
      return "turn-timeout";
    }
    const output = (run.output ?? "").trim();
    d.claim = null;
    d.turnsThisRound += 1;
    let needsYou = false;
    let note: string | null = null;
    let reply: string | null = null;
    if (classifyRun(run.status) === "failure" || !output) {
      note = `${member.agent.name} could not answer${run.error ? `: ${run.error}` : "."}`;
    } else if (PASS.test(output)) {
      d.passesThisRound += 1;
    } else {
      reply = output;
      d.replies += 1;
      const parsed = parseMentions(output, members.map((m) => m.handle));
      if (parsed.user) needsYou = true;
      const byHandle = new Map(members.map((m) => [m.handle, m.agent.id]));
      const asked = parsed.handles.flatMap((h) => byHandle.get(h) ?? []).filter((id) => id !== member.agent.id && !d.paused.includes(id));
      d.nextRound = unique([...d.nextRound, ...asked]);
    }
    const ended = needsYou || d.replies >= MAX_REPLIES;
    if (!(await save({ driver: ended ? null : d, needsYou }))) return "lost";
    if (reply) {
      await deps.store.addMessage({
        id: deps.newId(),
        roomId: room.id,
        senderKind: "bot",
        senderAgentId: member.agent.id,
        senderName: member.agent.name,
        content: reply,
        mentions: parseMentions(reply, members.map((m) => m.handle)).handles,
        threadRootId: d.triggerMessageId,
        runId: claim.runId,
      });
    }
    if (note) await system(deps, room, note);
    if (needsYou) await system(deps, room, `${member.agent.name} is asking you. Reply to continue.`);
    else if (d.replies >= MAX_REPLIES) await system(deps, room, `Room paused after ${MAX_REPLIES} replies. Send a message to go on.`);
    return reply ? "replied" : note ? "failed" : "passed";
  }

  // 2. Nobody left this round: end, or start the next round.
  if (d.queue.length === 0) {
    const quiet = d.turnsThisRound > 0 && d.passesThisRound === d.turnsThisRound;
    if (quiet || d.round >= MAX_ROUNDS) {
      return (await save({ driver: null })) ? (quiet ? "quiet" : "rounds-done") : "lost";
    }
    const everyone = members.map((m) => m.agent.id).filter((id) => !d.paused.includes(id));
    d.round += 1;
    d.queue = unique([...d.nextRound.filter((id) => !d.paused.includes(id)), ...everyone]);
    d.nextRound = [];
    d.turnsThisRound = 0;
    d.passesThisRound = 0;
    if (d.queue.length === 0) return (await save({ driver: null })) ? "everyone-paused" : "lost";
    return (await save({ driver: d })) ? `round-${d.round}` : "lost";
  }

  // 3. Next bot's turn: claim it first, then start its run.
  const nextId = d.queue[0];
  const member = members.find((m) => m.agent.id === nextId);
  d.queue = d.queue.slice(1);
  if (!member || d.paused.includes(nextId)) {
    return (await save({ driver: d })) ? "skipped" : "lost";
  }
  const token = `claim:${randomUUID()}`;
  d.claim = { agentId: nextId, runId: token, startedAt: deps.now().toISOString() };
  if (!(await save({ driver: d }))) return "lost";

  const messages = await deps.store.listMessages(room.id);
  let sessionId = room.memberSessions[nextId];
  const sessions = { ...room.memberSessions };
  if (!sessionId) {
    sessionId = await deps.createSession(member.agent, `Room: ${room.name}`).catch(() => "");
    if (sessionId) sessions[nextId] = sessionId;
  }
  let started: HermesStartRunResult | null = null;
  try {
    started = await deps.startRun(member.agent, {
      prompt: `Room transcript since your last turn:\n\n${transcriptFor(nextId, messages, handles)}\n\nYour turn.`,
      instructions: [member.agent.prompt, roomRules(members, member)].filter(Boolean).join("\n\n"),
      sessionId: sessionId || undefined,
      sessionKey: roomMemoryKey(room.id),
      idempotencyKey: `room-${room.id}-${token.slice(6)}`,
      approvals: "ask",
    });
  } catch {
    started = null;
  }
  // Swap the claim token for the run id (or give the turn back).
  const fresh = await deps.store.getRoom(room.id);
  if (!fresh?.driver?.claim || fresh.driver.claim.runId !== token) return "lost";
  const after: RoomDriver = { ...fresh.driver };
  if (!started || started.kind === "deferred") {
    after.claim = null;
    if (started?.kind === "deferred") after.queue = [nextId, ...after.queue];
    else after.turnsThisRound += 1;
    await deps.store.updateRoomIf(room.id, fresh.updatedAt, { driver: after, memberSessions: sessions });
    if (!started) await system(deps, room, `${member.agent.name} could not start.`);
    return started ? "deferred" : "start-failed";
  }
  after.claim = { ...after.claim!, runId: started.runId };
  await deps.store.updateRoomIf(room.id, fresh.updatedAt, { driver: after, memberSessions: sessions });
  return "started";
}

/** One step for every running room; run from runTick(). */
export async function advanceRooms(deps: RoomDeps): Promise<{ stepped: number; errors: string[] }> {
  const errors: string[] = [];
  let stepped = 0;
  const rooms = await deps.store.listActiveRooms();
  for (const room of rooms) {
    try {
      await advanceRoom(room.id, deps);
      stepped += 1;
    } catch (err: unknown) {
      errors.push(`Room ${room.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { stepped, errors };
}

export function newRoomId(): string {
  return `room_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}
