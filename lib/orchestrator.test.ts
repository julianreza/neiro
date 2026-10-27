/**
 * Regression tests for the orchestrator state machine (PR #1 review F1, F2,
 * F3, F5, F12). The engine runs against an in-memory store and a scripted
 * Hermes, injected through `deps`, so these never touch Supabase or a network.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { advanceActiveMissions, advanceMission, type OrchestratorDeps } from "./orchestrator";
import { FakeHermes } from "./test-fakes/fake-hermes";
import { MemoryStore } from "./test-fakes/memory-store";

function setup() {
  const store = new MemoryStore();
  const hermes = new FakeHermes();
  let id = 0;
  const deps: OrchestratorDeps = {
    store,
    hermes,
    now: () => new Date(),
    newId: () => `id-${++id}`,
  };
  return { store, hermes, deps };
}

const PLAN_OUTPUT = [
  "Here is the plan:",
  "```json",
  JSON.stringify({
    tasks: [
      { taskKey: "T1", title: "Build API", description: "API", specialty: "backend", dependsOn: [] },
      { taskKey: "T2", title: "Build UI", description: "UI", specialty: "frontend", dependsOn: ["T1"] },
    ],
  }),
  "```",
].join("\n");

test("F1: two concurrent ticks on one Queued task start exactly one coding run", async () => {
  const { store, hermes, deps } = setup();
  store.seedAgent("workers");
  const mission = store.seedMission({ phase: "executing" });
  const task = store.seedTask(mission.id, { taskKey: "T1" });

  await Promise.all([advanceMission(mission.id, deps), advanceMission(mission.id, deps)]);

  assert.equal(hermes.startsWithKeyPrefix("code-").length, 1);
  const after = store.tasks.get(task.id)!;
  assert.equal(after.stage, "Coding");
  assert.equal(after.retries, 0);
  assert.ok(after.runId && !after.runId.startsWith("claim:"));
});

test("F1: concurrent ticks on a failed QA run bump retries once and write one report", async () => {
  const { store, hermes, deps } = setup();
  store.seedAgent("qa");
  const mission = store.seedMission({ phase: "executing", maxRetries: 2 });
  const task = store.seedTask(mission.id, {
    taskKey: "T1",
    stage: "QA check",
    runId: "run-qa",
    runAgentId: "qa-agent",
  });
  hermes.setRun("run-qa", { status: "completed", output: "Broken.\nVERDICT: FAIL" });

  await Promise.all([advanceMission(mission.id, deps), advanceMission(mission.id, deps)]);

  const after = store.tasks.get(task.id)!;
  assert.equal(after.stage, "Queued");
  assert.equal(after.retries, 1);
  assert.equal(after.runId, null);
  assert.equal(store.artifactsOf(mission.id, "qa_report").length, 1);
});

test("F2: planning waits for the run to finish, then inserts keyed tasks once", async () => {
  const { store, hermes, deps } = setup();
  store.seedAgent("orchestrator");
  const mission = store.seedMission({ phase: "planning" });

  await advanceMission(mission.id, deps); // starts the plan run
  await advanceMission(mission.id, deps); // run still running
  assert.equal(store.tasksOf(mission.id).length, 0);
  const planRun = store.missions.get(mission.id)!.runId!;
  assert.ok(planRun && !planRun.startsWith("claim:"));

  hermes.setRun(planRun, { status: "completed", output: PLAN_OUTPUT });
  await Promise.all([advanceMission(mission.id, deps), advanceMission(mission.id, deps)]);

  const tasks = store.tasksOf(mission.id);
  assert.deepEqual(tasks.map((t) => t.taskKey).sort(), ["T1", "T2"]);
  assert.deepEqual(tasks.find((t) => t.taskKey === "T2")!.depends, ["T1"]);
  assert.equal(store.artifactsOf(mission.id, "task_plan").length, 1);
  assert.equal(store.missions.get(mission.id)!.phase, "spec");
  assert.equal(hermes.startsWithKeyPrefix("planning-").length, 1);
});

test("F2: a completed plan run with empty output inserts nothing and records an error", async () => {
  const { store, hermes, deps } = setup();
  store.seedAgent("orchestrator");
  const mission = store.seedMission({ phase: "planning", runId: "run-plan", runAgentId: "orchestrator-agent" });
  hermes.setRun("run-plan", { status: "completed", output: "" });

  await advanceMission(mission.id, deps);

  const after = store.missions.get(mission.id)!;
  assert.equal(store.tasksOf(mission.id).length, 0);
  assert.equal(after.phase, "planning");
  assert.equal(after.runId, null);
  assert.ok(after.lastError && after.lastError.length > 0);
});

test("F3: dependencies resolve by task_key only, never by title substring", async () => {
  const { store, deps } = setup();
  store.seedAgent("workers");
  const mission = store.seedMission({ phase: "executing", maxParallelWorkers: 5 });
  store.seedTask(mission.id, { taskKey: "T3", title: "Fix T1 bug", stage: "Done" });
  const t1 = store.seedTask(mission.id, { taskKey: "T1", title: "First" });
  const t2 = store.seedTask(mission.id, { taskKey: "T2", title: "Second", depends: ["T1"] });

  await advanceMission(mission.id, deps);
  assert.equal(store.tasks.get(t1.id)!.stage, "Coding");
  assert.equal(store.tasks.get(t2.id)!.stage, "Queued");

  Object.assign(store.tasks.get(t1.id)!, { stage: "Done", runId: null });
  await advanceMission(mission.id, deps);
  assert.equal(store.tasks.get(t2.id)!.stage, "Coding");
});

test("F5: failed QA retries until max_retries, then lands in Needs you", async () => {
  const { store, hermes, deps } = setup();
  store.seedAgent("qa");
  const mission = store.seedMission({ phase: "executing", maxRetries: 1 });
  const task = store.seedTask(mission.id, {
    taskKey: "T1",
    stage: "QA check",
    runId: "run-qa-1",
    runAgentId: "qa-agent",
  });
  hermes.setRun("run-qa-1", { status: "completed", output: "VERDICT: FAIL" });

  await advanceMission(mission.id, deps);
  assert.equal(store.tasks.get(task.id)!.stage, "Queued");
  assert.equal(store.tasks.get(task.id)!.retries, 1);

  Object.assign(store.tasks.get(task.id)!, { stage: "QA check", runId: "run-qa-2", runAgentId: "qa-agent" });
  hermes.setRun("run-qa-2", { status: "completed", output: "VERDICT: FAIL" });
  await advanceMission(mission.id, deps);
  assert.equal(store.tasks.get(task.id)!.stage, "Needs you");
  assert.equal(store.tasks.get(task.id)!.retries, 1);
});

test("F5: pause_after_planning stops at awaiting_plan_approval and starts no coding", async () => {
  const { store, hermes, deps } = setup();
  store.seedAgent("spec");
  store.seedAgent("workers");
  const mission = store.seedMission({
    phase: "spec",
    pauseAfterPlanning: true,
    runId: "run-spec",
    runAgentId: "spec-agent",
  });
  store.seedTask(mission.id, { taskKey: "T1" });
  hermes.setRun("run-spec", { status: "completed", output: "# PRD\nDo the thing." });

  await advanceMission(mission.id, deps);
  const after = store.missions.get(mission.id)!;
  assert.equal(after.status, "awaiting_plan_approval");
  assert.equal(after.phase, "executing");
  assert.equal(store.artifactsOf(mission.id, "prd").length, 1);

  const result = await advanceActiveMissions(deps);
  await advanceMission(mission.id, deps);
  assert.equal(result.advancedCount, 0);
  assert.equal(hermes.startsWithKeyPrefix("code-").length, 0);
});

test("F5: max_parallel_workers caps concurrently running tasks", async () => {
  const { store, hermes, deps } = setup();
  store.seedAgent("workers");
  const mission = store.seedMission({ phase: "executing", maxParallelWorkers: 1 });
  store.seedTask(mission.id, { taskKey: "T1" });
  store.seedTask(mission.id, { taskKey: "T2" });

  await Promise.all([advanceMission(mission.id, deps), advanceMission(mission.id, deps)]);

  const coding = store.tasksOf(mission.id).filter((t) => t.stage === "Coding");
  assert.equal(coding.length, 1);
  assert.equal(hermes.startsWithKeyPrefix("code-").length, 1);
});
