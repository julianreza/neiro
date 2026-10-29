import assert from "node:assert/strict";
import { test } from "node:test";
import { advanceMission, reportAdvanceError, type OrchestratorDeps } from "./orchestrator";
import { budgetBlock, parseTokenBudget } from "./budget";
import { shortHash, webhookPayload } from "./notifications";
import type { NotificationEvent } from "./notifications";
import { FakeHermes } from "./test-fakes/fake-hermes";
import { MemoryStore } from "./test-fakes/memory-store";
import { buildNeedsYou } from "./needs-you";

function setup() {
  const store = new MemoryStore();
  const hermes = new FakeHermes();
  const events: NotificationEvent[] = [];
  let id = 0;
  const deps: OrchestratorDeps = {
    store,
    hermes,
    now: () => new Date(),
    newId: () => `id-${++id}`,
    router: null,
    notify: async (e) => {
      events.push(e);
    },
  };
  return { store, hermes, deps, events };
}

test("mission budget remains a budget item after the next tick and starts no run", async () => {
  const { store, hermes, deps, events } = setup();
  store.seedAgent("workers");
  const mission = store.seedMission({ phase: "executing", tokenBudget: 1_000 });
  store.seedTask(mission.id, { taskKey: "T1", stage: "Done", tokens: 1_200 });
  const task = store.seedTask(mission.id, { taskKey: "T2" });

  await advanceMission(mission.id, deps);
  await advanceMission(mission.id, deps);

  assert.equal(hermes.startsWithKeyPrefix("code-").length, 0);
  const after = store.tasks.get(task.id)!;
  assert.equal(after.stage, "Needs you");
  assert.equal(after.runId, null);
  assert.match(store.missions.get(mission.id)!.lastError ?? "", /Mission token budget reached/);
  assert.deepEqual(events.map((e) => e.kind), ["budget_reached"]);
  const detail = await store.getMissionDetail(mission.id);
  const items = buildNeedsYou([detail], detail.tasks);
  assert.deepEqual(items.map((item) => item.kind), ["budget"]);
  assert.match(items[0].detail, /Mission token budget reached/);

  // Once the operator raises the budget and retries, the old block clears.
  store.missions.get(mission.id)!.tokenBudget = 10_000;
  after.stage = "Queued";
  await advanceMission(mission.id, deps);
  assert.equal(store.missions.get(mission.id)!.lastError, null);
  assert.equal(hermes.startsWithKeyPrefix("code-").length, 1);
});

test("an agent budget replaces a transient error and survives the next tick", async () => {
  const { store, deps } = setup();
  const agent = store.seedAgent("workers");
  agent.tokenBudget = 500;
  const mission = store.seedMission({ phase: "executing", lastError: "Temporary outage" });
  store.seedTask(mission.id, { taskKey: "T1", stage: "Done", agentId: agent.id, tokens: 600 });
  store.seedTask(mission.id, { taskKey: "T2" });

  await advanceMission(mission.id, deps);
  const detail = await advanceMission(mission.id, deps);

  assert.match(detail.lastError ?? "", /reached its token budget/);
  assert.deepEqual(buildNeedsYou([detail], detail.tasks).map((item) => item.kind), ["budget"]);
});

test("agent budget only counts that agent's tokens in this mission", () => {
  const store = new MemoryStore();
  const mission = store.seedMission({ phase: "executing" });
  store.seedTask(mission.id, { taskKey: "T1", agentId: "a1", tokens: 600 });
  store.seedTask(mission.id, { taskKey: "T2", agentId: "a2", tokens: 5_000 });
  const detail = { ...store.missions.get(mission.id)!, tasks: [...store.tasks.values()], artifacts: [] };

  assert.equal(budgetBlock(detail, { id: "a1", name: "A1", tokenBudget: 1_000 }), null);
  const blocked = budgetBlock(detail, { id: "a2", name: "A2", tokenBudget: 1_000 });
  assert.equal(blocked?.scope, "agent");
  assert.equal(budgetBlock(detail, { id: "a2", name: "A2", tokenBudget: null }), null);
});

test("under budget, the run starts as before", async () => {
  const { store, hermes, deps, events } = setup();
  store.seedAgent("workers");
  const mission = store.seedMission({ phase: "executing", tokenBudget: 10_000 });
  store.seedTask(mission.id, { taskKey: "T1" });

  await advanceMission(mission.id, deps);

  assert.equal(hermes.startsWithKeyPrefix("code-").length, 1);
  assert.equal(events.length, 0);
});

test("escalation to Needs you after the last retry notifies once", async () => {
  const { store, hermes, deps, events } = setup();
  store.seedAgent("qa");
  const mission = store.seedMission({ phase: "executing", maxRetries: 0 });
  store.seedTask(mission.id, { taskKey: "T1", stage: "QA check", runId: "run-qa", runAgentId: "qa-agent" });
  hermes.setRun("run-qa", { status: "completed", output: "Broken.\nVERDICT: FAIL" });

  await Promise.all([advanceMission(mission.id, deps), advanceMission(mission.id, deps)]);

  assert.deepEqual(events.map((e) => e.kind), ["task_needs_you"]);
});

test("mission completion notifies", async () => {
  const { store, deps, events } = setup();
  const mission = store.seedMission({ phase: "summarizing" });
  store.seedTask(mission.id, { taskKey: "T1", stage: "Done" });

  await advanceMission(mission.id, deps);

  assert.equal(store.missions.get(mission.id)!.status, "completed");
  assert.deepEqual(events.map((e) => e.kind), ["mission_completed"]);
});

test("a failing notifier never breaks the engine", async () => {
  const { store, deps } = setup();
  deps.notify = async () => {
    throw new Error("webhook down");
  };
  const mission = store.seedMission({ phase: "summarizing" });
  store.seedTask(mission.id, { taskKey: "T1", stage: "Done" });

  await advanceMission(mission.id, deps);
  assert.equal(store.missions.get(mission.id)!.status, "completed");
});

test("mission errors notify with a message-based dedupe key", async () => {
  const { store, deps, events } = setup();
  const mission = store.seedMission({ phase: "executing" });
  await reportAdvanceError(mission.id, new Error("Hermes unreachable"), undefined, deps);
  assert.equal(events[0].kind, "mission_error");
  assert.equal(events[0].dedupeKey, `error:${mission.id}:${shortHash("Hermes unreachable")}`);
});

test("parseTokenBudget accepts null/0 as no limit and rejects junk", () => {
  assert.deepEqual(parseTokenBudget(undefined, "b"), { ok: true, value: null });
  assert.deepEqual(parseTokenBudget(0, "b"), { ok: true, value: null });
  assert.deepEqual(parseTokenBudget(5000, "b"), { ok: true, value: 5000 });
  assert.equal(parseTokenBudget(-1, "b").ok, false);
  assert.equal(parseTokenBudget(1.5, "b").ok, false);
  assert.equal(parseTokenBudget("10", "b").ok, false);
});

test("webhook payload carries a Slack-style text with a link", () => {
  const body = webhookPayload(
    { kind: "mission_completed", missionId: "m 1", title: "Done", body: "All good", dedupeKey: "k" },
    "https://neiro.example/"
  );
  assert.equal(body.text, "Done\nAll good\nhttps://neiro.example/missions/m%201");
});
