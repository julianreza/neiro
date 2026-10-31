import assert from "node:assert/strict";
import { test } from "node:test";
import { advanceRoom, MAX_REPLIES, onUserMessage, transcriptFor, type RoomDeps } from "./rooms";
import type { RoomStore } from "./rooms-store";
import type { HermesRunStatus } from "./hermes";
import type { Agent, BotRoom, BotRoomMessage } from "./types";

class MemoryRooms implements RoomStore {
  rooms = new Map<string, BotRoom>();
  messages: BotRoomMessage[] = [];
  private clock = 0;
  private stamp = () => `t${++this.clock}`;
  seed(members: string[]): BotRoom {
    const room: BotRoom = {
      id: "r1",
      name: "War room",
      avatarUrl: null,
      memberAgentIds: members,
      detectStopDirectives: true,
      needsYou: false,
      pinned: false,
      section: null,
      memberSessions: {},
      driver: null,
      createdAt: "t0",
      updatedAt: this.stamp(),
    };
    this.rooms.set(room.id, room);
    return room;
  }
  async getRoom(id: string) {
    const r = this.rooms.get(id);
    return r ? structuredClone(r) : null;
  }
  async listActiveRooms() {
    return [...this.rooms.values()].filter((r) => r.driver && !r.needsYou);
  }
  async listMessages(roomId: string) {
    return this.messages.filter((m) => m.roomId === roomId);
  }
  async addMessage(m: Omit<BotRoomMessage, "createdAt">) {
    const msg = { ...m, createdAt: this.stamp() };
    this.messages.push(msg);
    return msg;
  }
  async updateRoomIf(id: string, updatedAt: string, patch: Partial<BotRoom>) {
    await Promise.resolve();
    const r = this.rooms.get(id);
    if (!r || r.updatedAt !== updatedAt) return false;
    Object.assign(r, structuredClone(patch), { updatedAt: this.stamp() });
    return true;
  }
}

const agent = (id: string, name = id): Agent => ({ id, name, role: "", stage: "workers", specialty: "", model: "", profile: "default", prompt: "", url: "", enabled: true, activeRun: false });

function setup(members = ["forge", "lens", "scribe"], replies: Record<string, string[]> = {}) {
  const store = new MemoryRooms();
  const room = store.seed(members);
  const runs = new Map<string, HermesRunStatus>();
  const starts: Array<{ agentId: string; prompt: string; sessionKey?: string }> = [];
  const stopped: string[] = [];
  let n = 0;
  const said = new Map<string, number>();
  const deps: RoomDeps = {
    store,
    agents: async () => members.map((id) => agent(id, id[0].toUpperCase() + id.slice(1))),
    startRun: async (a, input) => {
      const runId = `run-${++n}`;
      starts.push({ agentId: a.id, prompt: input.prompt, sessionKey: input.sessionKey });
      const i = said.get(a.id) ?? 0;
      said.set(a.id, i + 1);
      runs.set(runId, { run_id: runId, status: "completed", output: replies[a.id]?.[i] ?? "PASS" });
      return { kind: "started", runId };
    },
    getRun: async (_a, runId) => runs.get(runId)!,
    stopRun: async (_a, runId) => {
      stopped.push(runId);
      return true;
    },
    createSession: async (a) => `session-${a.id}`,
    now: () => new Date("2026-10-31T00:00:00Z"),
    newId: () => `m${++n}`,
  };
  const drain = async (max = 100) => {
    const steps: string[] = [];
    for (let i = 0; i < max; i++) {
      const s = await advanceRoom(room.id, deps);
      if (s === "idle") break;
      steps.push(s);
    }
    return steps;
  };
  return { store, room, deps, runs, starts, stopped, drain };
}

const botReplies = (store: MemoryRooms) => store.messages.filter((m) => m.senderKind === "bot").map((m) => `${m.senderAgentId}:${m.content}`);

test("a fully quiet round ends the room early", async () => {
  const { store, deps, starts, drain } = setup();
  await onUserMessage("r1", "Any thoughts?", deps);
  const steps = await drain();
  assert.equal(starts.length, 3);
  assert.ok(steps.includes("quiet"));
  assert.equal(botReplies(store).length, 0, "PASS is never shown");
  assert.equal(store.rooms.get("r1")!.driver, null);
});

test("an @mention gives only that bot the first round, then everyone may join", async () => {
  const { store, deps, starts, drain } = setup(undefined, { lens: ["Looks risky."] });
  await onUserMessage("r1", "@lens review this", deps);
  await drain();
  assert.equal(starts[0].agentId, "lens");
  assert.equal(starts[0].sessionKey, "neiro:room:r1");
  assert.deepEqual(botReplies(store), ["lens:Looks risky."]);
  // Round 2: everyone, all PASS -> quiet stop.
  assert.deepEqual(starts.slice(1).map((s) => s.agentId).sort(), ["forge", "lens", "scribe"]);
});

test("at most 3 rounds", async () => {
  const talk = Array.from({ length: 5 }, (_, i) => `idea ${i}`);
  const { deps, starts, drain } = setup(["forge", "lens"], { forge: talk, lens: talk });
  await onUserMessage("r1", "@all brainstorm", deps);
  const steps = await drain();
  assert.equal(starts.length, 6);
  assert.ok(steps.includes("rounds-done"));
});

test(`at most ${MAX_REPLIES} replies`, async () => {
  const talk = Array.from({ length: 10 }, (_, i) => `point ${i}`);
  const members = ["a", "b", "c", "d", "e", "f"];
  const { store, deps, drain } = setup(members, Object.fromEntries(members.map((m) => [m, talk])));
  await onUserMessage("r1", "go", deps);
  await drain();
  assert.equal(botReplies(store).length, MAX_REPLIES);
  assert.match(store.messages.at(-1)!.content, /paused after 10 replies/);
});

test("a bot asking @user stops the rounds and flags the room", async () => {
  const { store, deps, starts, drain } = setup(undefined, { forge: ["@user which database?"] });
  await onUserMessage("r1", "plan it", deps);
  await drain();
  assert.equal(starts.length, 1);
  assert.equal(store.rooms.get("r1")!.needsYou, true);
  assert.equal(store.rooms.get("r1")!.driver, null);
});

test("an approval wait flags the room and keeps the turn", async () => {
  const { store, deps, runs, drain } = setup();
  await onUserMessage("r1", "@forge do it", deps);
  await advanceRoom("r1", deps); // starts forge
  runs.set("run-2", { run_id: "run-2", status: "waiting_for_approval", controls: [{ requestId: "p", executionGeneration: 1, kind: "approval", choices: ["once", "deny"] }] });
  await drain();
  const room = store.rooms.get("r1")!;
  assert.equal(room.needsYou, true);
  assert.equal(room.driver?.claim?.agentId, "forge");
});

test("stop @bot pauses it; stop room ends the room and stops the speaker", async () => {
  const { store, deps, starts, stopped, drain } = setup();
  await onUserMessage("r1", "stop @lens, everyone else go", deps);
  await drain();
  assert.equal(starts.some((s) => s.agentId === "lens"), false);

  await onUserMessage("r1", "next topic", deps);
  await advanceRoom("r1", deps); // a bot starts speaking
  const running = store.rooms.get("r1")!.driver!.claim!.runId;
  await onUserMessage("r1", "ok stop the room", deps);
  assert.equal(store.rooms.get("r1")!.driver, null);
  assert.deepEqual(stopped, [running]);
});

test("two ticks at once never start the same turn twice", async () => {
  const { deps, starts } = setup();
  await onUserMessage("r1", "@forge hi", deps);
  await Promise.all([advanceRoom("r1", deps), advanceRoom("r1", deps)]);
  assert.equal(starts.length, 1);
});

test("a bot reads the transcript since its own last reply", () => {
  const msg = (id: string, kind: BotRoomMessage["senderKind"], who: string | null, content: string): BotRoomMessage => ({
    id, roomId: "r1", senderKind: kind, senderAgentId: who, senderName: who ?? "You", content, mentions: [], threadRootId: null, runId: null, createdAt: id,
  });
  const text = transcriptFor(
    "forge",
    [msg("1", "user", null, "old"), msg("2", "bot", "forge", "mine"), msg("3", "bot", "lens", "new idea"), msg("4", "user", null, "thoughts?")],
    new Map([["lens", "lens"]]),
  );
  assert.equal(text, "lens (@lens): new idea\n\nYou: thoughts?");
});
