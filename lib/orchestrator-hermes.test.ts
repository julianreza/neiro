/**
 * The orchestrator's use of the full Hermes API: memory scope, unknown-run
 * recovery, waiting approvals, cache tokens, fork notes and learned skills.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { advanceMission, latestForkNote, memoryKey, runFacts, type OrchestratorDeps } from "./orchestrator";
import { extractSkillBlock } from "./orchestrator-parsers";
import type { NotificationEvent } from "./notifications";
import { FakeHermes } from "./test-fakes/fake-hermes";
import { MemoryStore } from "./test-fakes/memory-store";
import type { MissionTask } from "./types";

function setup() {
  const store = new MemoryStore();
  const hermes = new FakeHermes();
  const events: NotificationEvent[] = [];
  const seen = new Set<string>();
  let id = 0;
  const deps: OrchestratorDeps = {
    store,
    hermes,
    now: () => new Date(),
    newId: () => `id-${++id}`,
    router: null,
    // Like the real notifier: a dedupe key is announced once.
    notify: async (e) => {
      if (seen.has(e.dedupeKey)) return;
      seen.add(e.dedupeKey);
      events.push(e);
    },
  };
  return { store, hermes, deps, events };
}

test("memory key: per project, else per mission", () => {
  assert.equal(memoryKey({ id: "m1", projectId: "p1" }), "neiro:project:p1");
  assert.equal(memoryKey({ id: "m1", projectId: null }), "neiro:mission:m1");
});

test("planning and coding runs carry the project's memory key", async () => {
  const { store, hermes, deps } = setup();
  store.seedAgent("orchestrator");
  store.seedAgent("workers");
  const planning = store.seedMission({ phase: "planning", projectId: "proj-9" });
  await advanceMission(planning.id, deps);
  assert.equal(hermes.startsWithKeyPrefix("planning-")[0].sessionKey, "neiro:project:proj-9");

  const executing = store.seedMission({ phase: "executing" });
  store.seedTask(executing.id, { taskKey: "T1" });
  await advanceMission(executing.id, deps);
  assert.equal(hermes.startsWithKeyPrefix("code-")[0].sessionKey, `neiro:mission:${executing.id}`);
});

test("planning sends the mission's images", async () => {
  const { store, hermes, deps } = setup();
  store.seedAgent("orchestrator");
  const m = store.seedMission({ phase: "planning", attachments: [{ name: "a.png", dataUrl: "data:image/png;base64,AA" }] });
  await advanceMission(m.id, deps);
  assert.equal(hermes.startsWithKeyPrefix("planning-")[0].images, 1);
});

test("an unknown run is resolved, released and retried once", async () => {
  const { store, hermes, deps } = setup();
  store.seedAgent("workers");
  const m = store.seedMission({ phase: "executing", maxRetries: 2 });
  const task = store.seedTask(m.id, { taskKey: "T1", stage: "Coding", runId: "run-x", runAgentId: "workers-agent" });
  hermes.setRun("run-x", { status: "unknown", admission_id: "adm-1", execution_generation: 2 });

  await Promise.all([advanceMission(m.id, deps), advanceMission(m.id, deps)]);

  assert.deepEqual(hermes.resolved[0], { runId: "run-x", admissionId: "adm-1", executionGeneration: 2 });
  const after = store.tasks.get(task.id)!;
  assert.equal(after.runId, null);
  assert.equal(after.retries, 1);
  assert.equal(after.stage, "Queued");
});

test("an unknown run Hermes cannot resolve goes to Needs you", async () => {
  const { store, hermes, deps, events } = setup();
  store.seedAgent("workers");
  const m = store.seedMission({ phase: "executing" });
  const noDetails = store.seedTask(m.id, { taskKey: "T1", stage: "Coding", runId: "run-a", runAgentId: "workers-agent" });
  hermes.setRun("run-a", { status: "unknown" });
  await advanceMission(m.id, deps);
  assert.equal(store.tasks.get(noDetails.id)!.stage, "Needs you");
  assert.equal(hermes.resolved.length, 0);

  hermes.resolveResult = false;
  const failed = store.seedTask(m.id, { taskKey: "T2", stage: "Coding", runId: "run-b", runAgentId: "workers-agent" });
  hermes.setRun("run-b", { status: "unknown", admission_id: "adm", execution_generation: 1 });
  await advanceMission(m.id, deps);
  assert.equal(store.tasks.get(failed.id)!.stage, "Needs you");
  assert.ok(events.some((e) => e.taskId === failed.id && /could not resolve/.test(e.body)));
});

test("a missing run status is not treated as unknown", async () => {
  const { store, hermes, deps } = setup();
  store.seedAgent("workers");
  const m = store.seedMission({ phase: "executing" });
  const task = store.seedTask(m.id, { taskKey: "T1", stage: "Coding", runId: "run-m", runAgentId: "workers-agent" });
  hermes.setRun("run-m", { status: "missing_status", admission_id: "adm", execution_generation: 1 });
  await advanceMission(m.id, deps);
  assert.equal(hermes.resolved.length, 0);
  assert.equal(store.tasks.get(task.id)!.runId, "run-m");
});

test("waiting approvals are stored and announced once per request id", async () => {
  const { store, hermes, deps, events } = setup();
  store.seedAgent("workers");
  const m = store.seedMission({ phase: "executing" });
  const task = store.seedTask(m.id, { taskKey: "T1", stage: "Coding", runId: "run-p", runAgentId: "workers-agent" });
  const control = (id: string, choices: ("once" | "always" | "deny")[]) => ({
    requestId: id,
    executionGeneration: 1,
    kind: "approval" as const,
    tool: "bash",
    command: "rm -rf dist",
    choices,
  });
  hermes.setRun("run-p", { status: "waiting_for_approval", controls: [control("p1", ["once", "deny"])] });

  await advanceMission(m.id, deps);
  await advanceMission(m.id, deps);
  assert.equal(store.tasks.get(task.id)!.pendingControls?.[0].requestId, "p1");
  const first = events.filter((e) => e.dedupeKey.startsWith("approval:"));
  assert.equal(first.length, 1);
  assert.deepEqual(first[0].actions?.map((a) => a.id), ["approve_tool_once", "deny_tool"]);

  hermes.setRun("run-p", { controls: [control("p2", ["once", "always", "deny"])] });
  await advanceMission(m.id, deps);
  const all = events.filter((e) => e.dedupeKey.startsWith("approval:"));
  assert.equal(all.length, 2);
  assert.deepEqual(all[1].actions?.map((a) => a.id), ["approve_tool_once", "approve_tool_always", "deny_tool"]);
});

test("a finished run adds its cache tokens and the model it really ran on", async () => {
  const { store, hermes, deps } = setup();
  store.seedAgent("workers");
  const m = store.seedMission({ phase: "executing" });
  const task = store.seedTask(m.id, {
    taskKey: "T1",
    stage: "Coding",
    runId: "run-c",
    runAgentId: "workers-agent",
    cacheReadTokens: 5,
  });
  hermes.setRun("run-c", {
    status: "completed",
    output: "done",
    tokens: 100,
    model: "session-model",
    cache_read_tokens: 40,
    cache_write_tokens: 7,
    runtime: { provider: "openrouter", model: "fallback-model" },
  });
  await advanceMission(m.id, deps);
  const after = store.tasks.get(task.id)!;
  assert.equal(after.cacheReadTokens, 45);
  assert.equal(after.cacheWriteTokens, 7);
  assert.equal(after.runtimeProvider, "openrouter");
  assert.equal(after.runtimeModel, "fallback-model");
  assert.equal(store.tokenUsage[0].model, "fallback-model");
});

test("runFacts leaves fields alone when the run says nothing", () => {
  assert.deepEqual(runFacts({ cacheReadTokens: 3 } as MissionTask, { run_id: "r", status: "completed" }), {
    pendingControls: [],
  });
});

test("the newest fork note goes into the next coding prompt", async () => {
  const { store, hermes, deps } = setup();
  store.seedAgent("workers");
  const m = store.seedMission({ phase: "executing" });
  const task = store.seedTask(m.id, { taskKey: "T1" });
  await store.insertArtifactOnce({ missionId: m.id, taskId: task.id, title: "Fork", kind: "fork_note", content: "Use SQLite", dedupeKey: `fork:${task.id}:1` });
  await store.insertArtifactOnce({ missionId: m.id, taskId: task.id, title: "Fork", kind: "fork_note", content: "Use Postgres", dedupeKey: `fork:${task.id}:2` });
  assert.equal(latestForkNote({ artifacts: store.artifacts }, task.id), "Use Postgres");
  await advanceMission(m.id, deps);
  const prompt = hermes.startsWithKeyPrefix("code-")[0].prompt;
  assert.match(prompt, /Try this approach instead:\nUse Postgres/);
  assert.doesNotMatch(prompt, /SQLite/);
});

const SKILL_OUTPUT = [
  "The mission added login.",
  "```skill",
  "---",
  "name: add-login",
  "description: Add email login to a Next.js app",
  "---",
  "1. Add the route.",
  "2. Test it.",
  "```",
].join("\n");

test("skill block: valid frontmatter only", () => {
  assert.equal(extractSkillBlock(SKILL_OUTPUT)?.name, "add-login");
  assert.equal(extractSkillBlock("```skill\n---\nname: x\n---\n1. a\n```"), null);
  assert.equal(extractSkillBlock("no fence"), null);
});

test("learn a skill: the summary run's SKILL.md is saved, and the mission ends", async () => {
  const { store, hermes, deps } = setup();
  store.seedAgent("orchestrator");
  const m = store.seedMission({ phase: "summarizing", learnSkillOnDone: true });
  await advanceMission(m.id, deps);
  const runId = store.missions.get(m.id)!.runId!;
  assert.ok(runId && !runId.startsWith("claim:"));
  assert.equal(store.missions.get(m.id)!.phase, "summarizing");
  assert.match(hermes.startsWithKeyPrefix("summary-")[0].prompt, /```skill/);

  hermes.setRun(runId, { status: "completed", output: SKILL_OUTPUT });
  await advanceMission(m.id, deps);
  const skill = store.artifactsOf(m.id, "learned_skill");
  assert.equal(skill.length, 1);
  assert.equal(skill[0].dedupeKey, `skill:${m.id}`);
  assert.equal(store.artifactsOf(m.id, "mission_summary")[0].content, "The mission added login.");
  assert.equal(store.missions.get(m.id)!.phase, "done");
});

test("learn a skill: an invalid block still finishes the mission, with no skill", async () => {
  const { store, hermes, deps } = setup();
  store.seedAgent("orchestrator");
  const m = store.seedMission({ phase: "summarizing", learnSkillOnDone: true });
  await advanceMission(m.id, deps);
  hermes.setRun(store.missions.get(m.id)!.runId!, { status: "completed", output: "Summary.\n```skill\nno frontmatter\n```" });
  await advanceMission(m.id, deps);
  assert.equal(store.artifactsOf(m.id, "learned_skill").length, 0);
  assert.equal(store.missions.get(m.id)!.status, "completed");
});

test("without learn-a-skill, summarizing starts no run", async () => {
  const { store, hermes, deps } = setup();
  store.seedAgent("orchestrator");
  const m = store.seedMission({ phase: "summarizing" });
  await advanceMission(m.id, deps);
  assert.equal(hermes.starts.length, 0);
  assert.equal(store.missions.get(m.id)!.phase, "done");
});
