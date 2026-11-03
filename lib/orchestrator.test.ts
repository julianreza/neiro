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
    router: null, // these tests cover the router-off engine
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

test("waiting controls synchronize approval and clear when resolved", async () => {
  const { store, hermes, deps } = setup();
  store.seedAgent("workers");
  const mission = store.seedMission({ phase: "executing" });
  const task = store.seedTask(mission.id, { stage: "Coding", runId: "run-controls", runAgentId: "workers-agent" });
  hermes.setRun("run-controls", { status: "running", controls: [{ kind: "clarify", requestId: "c1", executionGeneration: 1, choices: [] }] });
  await advanceMission(mission.id, deps);
  assert.equal(store.tasks.get(task.id)?.approval, true);
  hermes.setRun("run-controls", { status: "running", controls: [] });
  await advanceMission(mission.id, deps);
  assert.equal(store.tasks.get(task.id)?.approval, false);
});

test("a changed generation with the same request id updates stored controls", async () => {
  const { store, hermes, deps } = setup();
  store.seedAgent("workers");
  const mission = store.seedMission({ phase: "executing" });
  const old = { kind: "approval" as const, requestId: "c1", executionGeneration: 1, choices: ["once" as const] };
  const task = store.seedTask(mission.id, { stage: "Coding", runId: "run-controls", runAgentId: "workers-agent", approval: true, pendingControls: [old] });
  hermes.setRun("run-controls", { status: "running", controls: [{ ...old, executionGeneration: 2 }] });
  await advanceMission(mission.id, deps);
  assert.equal(store.tasks.get(task.id)?.pendingControls?.[0].executionGeneration, 2);
});

for (const [stage, agentStage] of [["Coding", "workers"], ["QA check", "qa"], ["Final review", "reviewer"]] as const) {
  for (const status of ["interrupted", "stopped"]) {
    test(`${status} during ${stage} consumes at most one retry and never accepts partial output`, async () => {
      const { store, hermes, deps } = setup();
      store.seedAgent(agentStage);
      const mission = store.seedMission({ phase: "executing", maxRetries: 1 });
      const task = store.seedTask(mission.id, { taskKey: "T1", stage, runId: "run-1", runAgentId: `${agentStage}-agent` });
      hermes.setRun("run-1", { status, output: "VERDICT: PASS", tokens: 7 });
      await Promise.all([advanceMission(mission.id, deps), advanceMission(mission.id, deps)]);
      const result = store.tasks.get(task.id)!;
      assert.equal(result.retries, 1);
      assert.equal(result.runId, null);
      assert.equal(result.stage, "Queued");
      assert.equal(store.tokenUsage.length, 1);
      assert.match(store.artifactsOf(mission.id, "run_failure")[0].content, new RegExp(status));
      assert.equal(store.artifactsOf(mission.id, "coding_output").length, 0);
    });
  }
}

test("an interrupted run with no retries remaining needs attention", async () => {
  const { store, hermes, deps } = setup();
  store.seedAgent("workers");
  const mission = store.seedMission({ phase: "executing", maxRetries: 0 });
  const task = store.seedTask(mission.id, { taskKey: "T1", stage: "Coding", runId: "interrupted-run", runAgentId: "workers-agent" });
  hermes.setRun("interrupted-run", { status: "interrupted" });
  await advanceMission(mission.id, deps);
  assert.equal(store.tasks.get(task.id)?.stage, "Needs you");
  assert.match(store.artifactsOf(mission.id, "run_failure")[0].content, /interrupted/i);
});

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

test("a started task run is handed to the step listener, once, with its real run id", async () => {
  const { store, deps } = setup();
  const watched: string[] = [];
  deps.watchRun = (_agent, runId) => watched.push(runId);
  store.seedAgent("workers");
  const mission = store.seedMission({ phase: "executing" });
  const task = store.seedTask(mission.id, { taskKey: "T1" });

  await Promise.all([advanceMission(mission.id, deps), advanceMission(mission.id, deps)]);

  const runId = store.tasks.get(task.id)!.runId;
  assert.deepEqual(watched, [runId]);
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

test("each finished run credits its tokens to the agent that ran it, once", async () => {
  const { store, hermes, deps } = setup();
  store.seedAgent("workers");
  store.seedAgent("qa");
  const mission = store.seedMission({ phase: "executing" });
  const task = store.seedTask(mission.id, {
    taskKey: "T1",
    stage: "Coding",
    runId: "run-code",
    runAgentId: "workers-agent",
  });
  hermes.setRun("run-code", { status: "completed", output: "done", tokens: 120 });
  await Promise.all([advanceMission(mission.id, deps), advanceMission(mission.id, deps)]);

  Object.assign(store.tasks.get(task.id)!, { stage: "QA check", runId: "run-qa", runAgentId: "qa-agent" });
  hermes.setRun("run-qa", { status: "completed", output: "VERDICT: PASS", tokens: 30 });
  await advanceMission(mission.id, deps);

  assert.deepEqual(
    store.tokenUsage.map((u) => [u.runId, u.agentName, u.stage, u.tokens]),
    [
      ["run-code", "workers-agent", "Coding", 120],
      ["run-qa", "qa-agent", "QA check", 30],
    ],
  );
  assert.equal(store.tasks.get(task.id)!.tokens, 150);
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

test("one task = one Hermes session: a retry after failed QA reuses the coding session", async () => {
  const { store, hermes, deps } = setup();
  store.seedAgent("workers");
  store.seedAgent("qa");
  const mission = store.seedMission({ phase: "executing", maxRetries: 2 });
  const task = store.seedTask(mission.id, { taskKey: "T1" });

  await advanceMission(mission.id, deps);
  const first = hermes.startsWithKeyPrefix("code-");
  assert.equal(first.length, 1);
  assert.equal(first[0].sessionId, "session-1");
  assert.equal(store.tasks.get(task.id)!.sessionId, "session-1");

  // Coding passes, QA fails: the task goes back to Queued for a retry.
  hermes.setRun(first[0].runId, { status: "completed", output: "done" });
  await advanceMission(mission.id, deps);
  await advanceMission(mission.id, deps);
  const qa = hermes.startsWithKeyPrefix("qa-");
  assert.equal(qa.length, 1);
  assert.equal(qa[0].sessionId, undefined);
  hermes.setRun(qa[0].runId, { status: "completed", output: "Login button is missing.\nVERDICT: FAIL" });
  await advanceMission(mission.id, deps);
  assert.equal(store.tasks.get(task.id)!.retries, 1);
  const saved = store.artifactsOf(mission.id, "coding_output");
  assert.deepEqual(saved.map((a) => [a.dedupeKey, a.content, a.taskId]), [[`code:${task.id}:0`, "done", task.id]]);

  await advanceMission(mission.id, deps);
  const coding = hermes.startsWithKeyPrefix("code-");
  assert.equal(coding.length, 2);
  assert.equal(coding[1].sessionId, "session-1");
  assert.equal(hermes.sessionsCreated, 1);

  // The retry is told why QA rejected it; the first attempt was not.
  assert.doesNotMatch(coding[0].prompt, /rejected/);
  assert.match(coding[1].prompt, /rejected by QA/);
  assert.match(coding[1].prompt, /Login button is missing\./);
});

test("a retry after CHANGES_REQUESTED sends the review report, not the passed QA report", async () => {
  const { store, hermes, deps } = setup();
  store.seedAgent("workers");
  store.seedAgent("reviewer");
  const mission = store.seedMission({ phase: "executing", maxRetries: 2 });
  const task = store.seedTask(mission.id, {
    taskKey: "T1",
    stage: "Final review",
    runId: "run-review",
    runAgentId: "reviewer-agent",
    resultOutput: "done",
  });
  store.artifacts.push({
    id: "a-qa",
    missionId: mission.id,
    taskId: task.id,
    title: "QA Report",
    kind: "qa_report",
    content: "All good.\nVERDICT: PASS",
    dedupeKey: `qa:${task.id}:0`,
  });
  hermes.setRun("run-review", {
    status: "completed",
    output: "XSS in the search box.\nVERDICT: CHANGES_REQUESTED",
  });

  await advanceMission(mission.id, deps);
  assert.equal(store.tasks.get(task.id)!.retries, 1);
  await advanceMission(mission.id, deps);

  const coding = hermes.startsWithKeyPrefix("code-");
  assert.equal(coding.length, 1);
  assert.match(coding[0].prompt, /rejected by Final review/);
  assert.match(coding[0].prompt, /XSS in the search box\./);
  assert.doesNotMatch(coding[0].prompt, /All good/);
});

test("PRD revision: notes on v1 make the spec run write v2 with the notes, then pause again", async () => {
  const { store, hermes, deps } = setup();
  store.seedAgent("spec");
  const mission = store.seedMission({ phase: "spec", pauseAfterPlanning: true });
  store.seedTask(mission.id, { taskKey: "T1", title: "Build API" });

  // v1
  await advanceMission(mission.id, deps);
  const first = hermes.startsWithKeyPrefix("spec-");
  assert.equal(first.length, 1);
  assert.doesNotMatch(first[0].prompt, /Operator notes/);
  hermes.setRun(first[0].runId, { status: "completed", output: "# PRD\nForm shows an error" });
  await advanceMission(mission.id, deps);
  assert.equal(store.missions.get(mission.id)!.status, "awaiting_plan_approval");
  assert.deepEqual(store.artifactsOf(mission.id, "prd").map((a) => a.dedupeKey), [`prd:${mission.id}`]);

  // The operator sends notes (what the revise_prd action writes).
  store.artifacts.push({
    id: "notes-1",
    missionId: mission.id,
    title: "PRD v1 review notes",
    kind: "prd_notes",
    content: '1. On "Form shows an error":\n   Say which text',
    dedupeKey: `prd-notes:${mission.id}:v1`,
  });
  Object.assign(store.missions.get(mission.id)!, { status: "running", phase: "spec", runId: null });

  await advanceMission(mission.id, deps);
  const second = hermes.startsWithKeyPrefix("spec-");
  assert.equal(second.length, 2);
  assert.match(second[1].prompt, /complete PRD v2/);
  assert.match(second[1].prompt, /Say which text/);
  assert.match(second[1].prompt, /PRD v1:\n# PRD\nForm shows an error/);

  hermes.setRun(second[1].runId, { status: "completed", output: "# PRD\nForm shows \"Wrong password\"" });
  await Promise.all([advanceMission(mission.id, deps), advanceMission(mission.id, deps)]);
  const prds = store.artifactsOf(mission.id, "prd");
  assert.deepEqual(prds.map((a) => a.dedupeKey), [`prd:${mission.id}`, `prd:${mission.id}:v2`]);
  assert.equal(prds[1].title, "Product Requirements Document (PRD) v2");
  assert.equal(prds[0].content, "# PRD\nForm shows an error");
  const after = store.missions.get(mission.id)!;
  assert.equal(after.status, "awaiting_plan_approval");
  assert.equal(after.phase, "executing");
});

test("planning and spec runs record token usage once across concurrent ticks", async () => {
  const { store, hermes, deps } = setup();
  deps.runCost = async () => 0.012345;
  store.seedAgent("orchestrator");
  store.seedAgent("spec");
  const mission = store.seedMission({ phase: "planning", runId: "run-plan-tokens", runAgentId: "orchestrator-agent" });
  hermes.setRun("run-plan-tokens", { status: "completed", output: PLAN_OUTPUT, tokens: 123 });
  await Promise.all([advanceMission(mission.id, deps), advanceMission(mission.id, deps)]);
  Object.assign(store.missions.get(mission.id)!, { phase: "spec", runId: "run-spec-tokens", runAgentId: "spec-agent" });
  hermes.setRun("run-spec-tokens", { status: "completed", output: "# PRD", tokens: 45 });
  await Promise.all([advanceMission(mission.id, deps), advanceMission(mission.id, deps)]);
  assert.deepEqual(store.tokenUsage.map(({ runId, stage, tokens, taskId }) => [runId, stage, tokens, taskId]), [
    ["run-plan-tokens", "planning", 123, null], ["run-spec-tokens", "spec", 45, null],
  ]);
  assert.deepEqual(store.tokenUsage.map((usage) => usage.costUsd), [0.012345, 0.012345]);
});

test("run cost provenance is stored once alongside recorded usage", async () => {
  const { store, hermes, deps } = setup();
  deps.runCost = async () => 0.04;
  store.seedAgent("orchestrator");
  const mission = store.seedMission({ phase: "planning", runId: "run-cost-origin", runAgentId: "orchestrator-agent" });
  hermes.setRun("run-cost-origin", { status: "completed", output: PLAN_OUTPUT, tokens: 123, estimated_cost_usd: 0.04, cost_status: "actual" });
  await Promise.all([advanceMission(mission.id, deps), advanceMission(mission.id, deps)]);
  const records = store.artifactsOf(mission.id, "run_cost_provenance");
  assert.equal(records.length, 1);
  assert.deepEqual(JSON.parse(records[0].content), { runId: "run-cost-origin", source: "reported", costUsd: 0.04 });
});

test("a provenance write failure does not block the mission or invent a source", async () => {
  const { store, hermes, deps } = setup();
  deps.runCost = async () => 0.04;
  const insert = store.insertArtifactOnce.bind(store);
  store.insertArtifactOnce = async (artifact) => {
    if (artifact.kind === "run_cost_provenance") throw new Error("unavailable");
    return insert(artifact);
  };
  store.seedAgent("orchestrator");
  const mission = store.seedMission({ phase: "planning", runId: "run-cost-failure", runAgentId: "orchestrator-agent" });
  hermes.setRun("run-cost-failure", { status: "completed", output: PLAN_OUTPUT, tokens: 123, estimated_cost_usd: 0.04, cost_status: "actual" });
  await advanceMission(mission.id, deps);
  assert.equal(store.tokenUsage[0].costUsd, 0.04);
  assert.equal(store.artifactsOf(mission.id, "run_cost_provenance").length, 0);
  assert.equal(store.missions.get(mission.id)?.phase, "spec");
});

test("learned skill awaits manual review before installation", async () => {
  const { store, hermes, deps } = setup();
  store.seedAgent("orchestrator");
  const mission = store.seedMission({ phase: "summarizing", learnSkillOnDone: true, runId: "run-summary", runAgentId: "orchestrator-agent" });
  hermes.setRun("run-summary", { status: "completed", output: "Done.\n```skill\n---\nname: safe-test\ndescription: Test safely\n---\n\nRun tests.\n```" });
  let savedName = "";
  deps.installLearnedSkill = async (_agentId, name) => { savedName = name; throw new Error("not local"); };
  await advanceMission(mission.id, deps);
  assert.equal(savedName, "");
  assert.equal(store.artifactsOf(mission.id, "learned_skill").length, 1);
  assert.equal(store.missions.get(mission.id)?.status, "completed");
});

test("draining Hermes is recorded once for the currently running task", async () => {
  const { store, hermes, deps } = setup();
  store.seedAgent("workers");
  const mission = store.seedMission({ phase: "executing" });
  store.seedTask(mission.id, { taskKey: "T1", stage: "Coding", runId: "run-drain", runAgentId: "workers-agent" });
  hermes.setRun("run-drain", { status: "running", shutdown_requested_at: 1730000000 });
  await advanceMission(mission.id, deps);
  await advanceMission(mission.id, deps);
  assert.equal(store.artifactsOf(mission.id, "gateway_draining").length, 1);
  assert.equal(store.artifactsOf(mission.id, "gateway_draining")[0].runId, "run-drain");
});

test("completed spec writes mission context to the isolated worktree before execution", async () => {
  const { store, hermes, deps } = setup();
  store.seedAgent("spec");
  const mission = store.seedMission({ phase: "spec", worktreePath: "/tmp/example", runId: "run-spec-context", runAgentId: "spec-agent", prompt: "Create a widget" });
  store.seedTask(mission.id, { taskKey: "T1" });
  hermes.setRun("run-spec-context", { status: "completed", output: "# PRD\nA widget." });
  let captured = "";
  deps.writeWorktreeContext = async (_path, text) => { captured = text; };
  await advanceMission(mission.id, deps);
  assert.match(captured, /Create a widget/);
  assert.match(captured, /# PRD/);
  assert.equal(store.missions.get(mission.id)?.phase, "executing");
});

test("safe approval is claimed once across concurrent ticks and only approved once", async () => {
  const { store, hermes, deps } = setup();
  store.seedAgent("workers");
  const mission = store.seedMission({ phase: "executing", autoApproveSafeTools: true });
  const task = store.seedTask(mission.id, { stage: "Coding", taskKey: "T1", runId: "run-approval", runAgentId: "workers-agent" });
  hermes.setRun("run-approval", { status: "running", controls: [{ kind: "approval", requestId: "request-safe", executionGeneration: 1, tool: "bash", command: "git status", choices: ["once", "deny"] }] });
  let sent = 0;
  deps.safeApproval = async () => true;
  deps.hermes.submitApproval = async () => { sent++; return true; };
  await Promise.all([advanceMission(mission.id, deps), advanceMission(mission.id, deps)]);
  assert.equal(sent, 1);
  assert.equal(store.artifactsOf(mission.id, "auto_approval").length, 1);
  assert.equal(store.tasks.get(task.id)?.stage, "Coding");
});

test("parallel coding uses an isolated task worktree", async () => {
  const { store, hermes, deps } = setup();
  store.seedAgent("workers").runtime = "ohmypi";
  const mission = store.seedMission({ phase: "executing", maxParallelWorkers: 2, workspacePath: "/repo/app", agentWorkspacePath: "/wt/app", worktreePath: "/wt", repoRoot: "/repo", workBranch: "neiro/example" });
  const task = store.seedTask(mission.id, { taskKey: "T1" });
  deps.taskWorkspace = {
    prepare: async () => ({ worktreePath: "/task", branch: "neiro/example-task-t1" }),
    merge: async () => "merged",
  };
  let cwd: string | undefined;
  const start = hermes.startRun;
  hermes.startRun = async (agent, input) => { cwd = input.cwd; return start(agent, input); };
  await advanceMission(mission.id, deps);
  assert.equal(cwd, "/task/app");
  assert.equal(store.tasks.get(task.id)?.taskWorktreePath, "/task");
  assert.equal(store.tasks.get(task.id)?.taskBranch, "neiro/example-task-t1");
});

test("isolated tasks do not start when the runtime cannot enforce the task directory", async () => {
  const { store, hermes, deps } = setup();
  store.seedAgent("workers");
  const mission = store.seedMission({ phase: "executing", maxParallelWorkers: 2, workspacePath: "/repo", agentWorkspacePath: "/wt", worktreePath: "/wt", repoRoot: "/repo", workBranch: "neiro/example" });
  const task = store.seedTask(mission.id, { taskKey: "T1" });
  let prepared = false;
  deps.taskWorkspace = { prepare: async () => { prepared = true; return { worktreePath: "/task", branch: "neiro/example-task-t1" }; }, merge: async () => "merged" };
  await advanceMission(mission.id, deps);
  assert.equal(prepared, false);
  assert.equal(hermes.starts.length, 0);
  assert.equal(store.tasks.get(task.id)?.stage, "Needs you");
});

test("isolated task is integrated exactly once after review passes", async () => {
  const { store, hermes, deps } = setup();
  store.seedAgent("reviewer");
  const mission = store.seedMission({ phase: "executing", maxParallelWorkers: 2, worktreePath: "/wt", repoRoot: "/repo", workBranch: "neiro/example" });
  const task = store.seedTask(mission.id, { taskKey: "T1", stage: "Final review", runId: "run-review", runAgentId: "reviewer-agent", taskWorktreePath: "/task", taskBranch: "neiro/example-task-t1" });
  hermes.setRun("run-review", { status: "completed", output: "Looks good.\nVERDICT: APPROVED" });
  let merges = 0;
  deps.taskWorkspace = { prepare: async () => ({ worktreePath: "/task", branch: "neiro/example-task-t1" }), merge: async (_mission, _task, _title, after) => { merges++; await after?.(); return "merged"; } };
  await advanceMission(mission.id, deps);
  assert.equal(store.tasks.get(task.id)?.taskIntegrationPending, true);
  assert.equal(store.artifactsOf(mission.id, "review_report")[0]?.title, `Task worktree review: ${task.title}`);
  await Promise.all([advanceMission(mission.id, deps), advanceMission(mission.id, deps)]);
  assert.equal(merges, 1);
  assert.equal(store.tasks.get(task.id)?.stage, "Done");
});

test("an isolated merge conflict parks the task without deleting its worktree", async () => {
  const { TaskMergeConflict } = await import("./worktree");
  const { store, deps } = setup();
  const mission = store.seedMission({ phase: "executing", maxParallelWorkers: 2, worktreePath: "/wt", repoRoot: "/repo", workBranch: "neiro/example" });
  const task = store.seedTask(mission.id, { taskKey: "T1", stage: "Final review", taskIntegrationPending: true, taskWorktreePath: "/task", taskBranch: "neiro/example-task-t1" });
  deps.taskWorkspace = { prepare: async () => ({ worktreePath: "/task", branch: "neiro/example-task-t1" }), merge: async () => { throw new TaskMergeConflict(["src/a.ts"]); } };
  await advanceMission(mission.id, deps);
  assert.equal(store.tasks.get(task.id)?.stage, "Needs you");
  assert.equal(store.tasks.get(task.id)?.taskIntegrationPending, true);
  assert.equal(store.tasks.get(task.id)?.taskWorktreePath, "/task");
  assert.match(store.missions.get(mission.id)?.lastError ?? "", /src\/a.ts/);
  store.missions.get(mission.id)!.lastErrorAt = "2026-01-01T00:00:00Z";
  await advanceMission(mission.id, deps);
  assert.match(store.missions.get(mission.id)?.lastError ?? "", /src\/a.ts/);
  assert.equal(store.missions.get(mission.id)?.lastErrorAt, "2026-01-01T00:00:00Z");
});

test("a completed task recovers interrupted worktree cleanup before the mission summarizes", async () => {
  const { store, deps } = setup();
  const mission = store.seedMission({ phase: "executing", maxParallelWorkers: 2, worktreePath: "/wt", repoRoot: "/repo", workBranch: "neiro/example" });
  const task = store.seedTask(mission.id, { taskKey: "T1", stage: "Done", taskWorktreePath: "/task", taskBranch: "neiro/example-task-t1" });
  let attempts = 0;
  deps.taskWorkspace = { prepare: async () => ({ worktreePath: "/task", branch: "neiro/example-task-t1" }), merge: async () => "merged", cleanup: async () => { attempts++; return attempts === 1 ? "busy" : "cleaned"; } };
  await advanceMission(mission.id, deps);
  assert.equal(store.missions.get(mission.id)?.phase, "executing");
  assert.equal(store.tasks.get(task.id)?.taskWorktreePath, "/task");
  await advanceMission(mission.id, deps);
  assert.equal(store.tasks.get(task.id)?.taskWorktreePath, null);
  assert.equal(store.missions.get(mission.id)?.phase, "summarizing");
});

test("explicit preflight consent skips an unavailable QA gate with recorded evidence", async () => {
  const { store, hermes, deps } = setup();
  store.seedAgent("qa");
  const mission = store.seedMission({ phase: "executing", skipQa: true });
  const task = store.seedTask(mission.id, { taskKey: "T1", stage: "QA check" });
  await advanceMission(mission.id, deps);
  assert.equal(store.tasks.get(task.id)?.stage, "Final review");
  assert.equal(hermes.starts.length, 0);
  assert.match(store.artifactsOf(mission.id, "gate_skipped")[0]?.content ?? "", /confirmed.*preflight/i);
});

test("a QA agent lost after preflight requires attention instead of silently skipping", async () => {
  const { store, hermes, deps } = setup();
  const mission = store.seedMission({ phase: "executing" });
  const task = store.seedTask(mission.id, { taskKey: "T1", stage: "QA check" });
  await advanceMission(mission.id, deps);
  assert.equal(store.tasks.get(task.id)?.stage, "Needs you");
  assert.equal(store.tasks.get(task.id)?.verificationWaitStage, "QA check");
  assert.equal(hermes.starts.length, 0);
  assert.equal(store.artifactsOf(mission.id, "gate_skipped").length, 0);
});
