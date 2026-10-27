/**
 * Engine tests for the task router (Laya). The router is a scripted fake
 * injected through `deps`, so Laya is never loaded; the store and Hermes are
 * the same in-memory fakes the other orchestrator tests use.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  advanceMission,
  approveRoute,
  overrideRoute,
  type OrchestratorDeps,
} from "./orchestrator";
import { FakeHermes } from "./test-fakes/fake-hermes";
import { FakeRouter } from "./test-fakes/fake-router";
import { MemoryStore } from "./test-fakes/memory-store";
import type { RouteDecision } from "./task-router";

const confident: RouteDecision = {
  agentId: "frontend-worker",
  urgency: 1,
  needsHuman: false,
  confidence: 0.92,
};

function setup(next: RouteDecision | Error | null = confident) {
  const store = new MemoryStore();
  const hermes = new FakeHermes();
  const router = next === null ? null : new FakeRouter(next);
  let id = 0;
  const deps: OrchestratorDeps = {
    store,
    hermes,
    router,
    now: () => new Date(),
    newId: () => `id-${++id}`,
  };
  store.seedAgent("workers", "backend-worker", "backend");
  store.seedAgent("workers", "frontend-worker", "frontend");
  store.seedAgent("qa", "qa-agent", "qa");
  const mission = store.seedMission({ phase: "executing", maxParallelWorkers: 5 });
  const task = store.seedTask(mission.id, { taskKey: "T1", title: "Build UI", agentName: "frontend" });
  return { store, hermes, router, deps, mission, task };
}

const ticks = async (missionId: string, deps: OrchestratorDeps, n: number) => {
  for (let i = 0; i < n; i++) await advanceMission(missionId, deps);
};

test("router: a confident pick routes straight through, then is claimed by that agent", async () => {
  const { store, hermes, router, deps, mission, task } = setup();

  await advanceMission(mission.id, deps);
  let after = store.tasks.get(task.id)!;
  assert.equal(after.stage, "Routed");
  assert.equal(after.routingStatus, "routed");
  assert.equal(after.agentId, "frontend-worker");
  assert.equal(after.layaAgentId, "frontend-worker");
  assert.equal(after.routeConfidence, 0.92);
  assert.equal(after.routeNeedsHuman, false);
  assert.deepEqual(router!.calls[0].agentIds.sort(), ["backend-worker", "frontend-worker", "qa-agent"]);

  await advanceMission(mission.id, deps);
  after = store.tasks.get(task.id)!;
  assert.equal(after.stage, "Coding");
  assert.equal(hermes.startsWithKeyPrefix("code-").length, 1);
  assert.equal(hermes.starts[0].agentId, "frontend-worker");
  assert.equal(router!.calls.length, 1);
});

test("router: low confidence waits at the human gate and is never claimed", async () => {
  const { store, hermes, deps, mission, task } = setup({ ...confident, confidence: 0.5 });

  await ticks(mission.id, deps, 4);

  const after = store.tasks.get(task.id)!;
  assert.equal(after.stage, "Awaiting routing");
  assert.equal(after.routingStatus, "awaiting");
  assert.equal(after.agentId, null);
  assert.equal(after.layaAgentId, "frontend-worker");
  assert.match(after.routeReason ?? "", /0\.50 di bawah 0\.7/);
  assert.equal(hermes.starts.length, 0);
});

test("router: needs_human waits at the gate even with high confidence", async () => {
  const { store, hermes, deps, mission, task } = setup({ ...confident, needsHuman: true, confidence: 0.97 });

  await ticks(mission.id, deps, 4);

  const after = store.tasks.get(task.id)!;
  assert.equal(after.stage, "Awaiting routing");
  assert.match(after.routeReason ?? "", /perlu manusia/);
  assert.equal(hermes.starts.length, 0);
  // The gate cannot be bypassed through the claim either.
  assert.equal(await store.claimTask(task.id, "claim:sneaky"), false);
});

test("router: a Laya error falls back to the default worker and the task keeps going", async () => {
  const { store, hermes, deps, mission, task } = setup(new Error("Laya timed out after 5000 ms"));

  await advanceMission(mission.id, deps);
  let after = store.tasks.get(task.id)!;
  assert.equal(after.stage, "Routed");
  assert.equal(after.routingStatus, "fallback");
  assert.equal(after.agentId, "frontend-worker"); // pickStageAgent("workers", "frontend")
  assert.equal(after.layaAgentId, null);
  assert.match(after.routeReason ?? "", /timed out/);

  await advanceMission(mission.id, deps);
  after = store.tasks.get(task.id)!;
  assert.equal(after.stage, "Coding");
  assert.equal(hermes.starts.length, 1);
});

test("router: fallback with no worker agents leaves the task Queued and reports it", async () => {
  const { store, deps, mission, task } = setup(new Error("boom"));
  store.agents = store.agents.filter((a) => a.stage !== "workers");

  await advanceMission(mission.id, deps);

  const after = store.tasks.get(task.id)!;
  assert.equal(after.stage, "Queued");
  assert.equal(after.routingStatus, null);
  assert.match(store.missions.get(mission.id)!.lastError ?? "", /No enabled worker agent/);
});

test("gate: overriding keeps Laya's pick and the human pick; the human agent runs it", async () => {
  const { store, hermes, deps, mission, task } = setup({ ...confident, confidence: 0.4 });
  await advanceMission(mission.id, deps);

  // Any enabled agent may be chosen, not only workers.
  const result = await overrideRoute(mission.id, task.id, "qa-agent", deps);
  assert.equal(result.ok, true);

  let after = store.tasks.get(task.id)!;
  assert.equal(after.stage, "Routed");
  assert.equal(after.routingStatus, "overridden");
  assert.equal(after.layaAgentId, "frontend-worker");
  assert.equal(after.humanAgentId, "qa-agent");
  assert.equal(after.agentId, "qa-agent");

  await advanceMission(mission.id, deps);
  after = store.tasks.get(task.id)!;
  assert.equal(after.stage, "Coding");
  assert.equal(hermes.starts[0].agentId, "qa-agent");

  // The coding run is owned by a qa-stage agent; polling must still find it.
  hermes.setRun(after.runId!, { status: "completed", output: "done" });
  await advanceMission(mission.id, deps);
  assert.equal(store.tasks.get(task.id)!.stage, "QA check");
});

test("gate: approving assigns Laya's pick; a second decision is a conflict", async () => {
  const { store, deps, mission, task } = setup({ ...confident, needsHuman: true });
  await advanceMission(mission.id, deps);

  const first = await approveRoute(mission.id, task.id, deps);
  assert.equal(first.ok, true);
  const after = store.tasks.get(task.id)!;
  assert.equal(after.stage, "Routed");
  assert.equal(after.routingStatus, "approved");
  assert.equal(after.agentId, "frontend-worker");
  assert.equal(after.humanAgentId, null);

  const again = await overrideRoute(mission.id, task.id, "backend-worker", deps);
  assert.deepEqual(again.ok ? null : again.status, 409);
});

test("gate: invalid override input is rejected", async () => {
  const { store, deps, mission, task } = setup({ ...confident, confidence: 0.1 });
  await advanceMission(mission.id, deps);
  store.agents.find((a) => a.id === "backend-worker")!.enabled = false;

  const missing = await overrideRoute(mission.id, task.id, undefined, deps);
  const disabled = await overrideRoute(mission.id, task.id, "backend-worker", deps);
  const unknownTask = await approveRoute(mission.id, "nope", deps);

  assert.deepEqual(missing.ok ? null : missing.status, 400);
  assert.deepEqual(disabled.ok ? null : disabled.status, 400);
  assert.deepEqual(unknownTask.ok ? null : unknownTask.status, 404);
  assert.equal(store.tasks.get(task.id)!.stage, "Awaiting routing");
});

test("router: two concurrent ticks ask Laya exactly once", async () => {
  const { store, router, deps, mission, task } = setup();

  await Promise.all([advanceMission(mission.id, deps), advanceMission(mission.id, deps)]);

  assert.equal(router!.calls.length, 1);
  assert.equal(store.tasks.get(task.id)!.stage, "Routed");
});

test("router: a failed QA retry goes back to Routed without asking Laya again", async () => {
  const { store, hermes, router, deps, mission, task } = setup();
  Object.assign(store.tasks.get(task.id)!, {
    stage: "QA check",
    runId: "run-qa",
    runAgentId: "qa-agent",
    agentId: "frontend-worker",
    routingStatus: "routed",
    layaAgentId: "frontend-worker",
  });
  hermes.setRun("run-qa", { status: "completed", output: "Broken.\nVERDICT: FAIL" });

  await advanceMission(mission.id, deps);
  let after = store.tasks.get(task.id)!;
  assert.equal(after.stage, "Routed");
  assert.equal(after.retries, 1);

  await advanceMission(mission.id, deps);
  after = store.tasks.get(task.id)!;
  assert.equal(after.stage, "Coding");
  assert.equal(hermes.starts.at(-1)!.agentId, "frontend-worker");
  assert.equal(router!.calls.length, 0);
});

test("router: a stale routing lock is released, then the task is routed", async () => {
  const { store, router, deps, mission, task } = setup();
  Object.assign(store.tasks.get(task.id)!, {
    routingStatus: "routing",
    routedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
  });

  await advanceMission(mission.id, deps);
  assert.equal(store.tasks.get(task.id)!.routingStatus, null);
  assert.equal(router!.calls.length, 0);

  await advanceMission(mission.id, deps);
  assert.equal(store.tasks.get(task.id)!.stage, "Routed");
  assert.equal(router!.calls.length, 1);
});

test("router off: a Queued task is claimed directly, exactly as before", async () => {
  const { store, hermes, deps, mission, task } = setup(null);

  await advanceMission(mission.id, deps);

  const after = store.tasks.get(task.id)!;
  assert.equal(after.stage, "Coding");
  assert.equal(after.routingStatus, null);
  assert.equal(hermes.starts.length, 1);
});
