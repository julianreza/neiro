import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDashboard, buildPipe, MAX_PIPE_ITEMS, tokensByAgent, tokensByDay, tokensByModel, tokensByRuntime } from "./dashboard";
import type { PipeMission, PipeTask } from "./dashboard";

const NOW = Date.parse("2026-10-30T12:00:00Z");

test("buildPipe places missions by phase and tasks by stage", () => {
  const missions: PipeMission[] = [
    { id: "m1", title: "Plan me", status: "running", phase: "planning" },
    { id: "m2", title: "Spec me", status: "running", phase: "spec" },
    { id: "m3", title: "Approve me", status: "awaiting_plan_approval", phase: "spec" },
    { id: "m4", title: "Build", status: "running", phase: "executing" },
    { id: "m5", title: "Wrap up", status: "running", phase: "summarizing" },
    { id: "m6", title: "Old", status: "completed", phase: "done" },
  ];
  const tasks: PipeTask[] = [
    { id: "t1", missionId: "m4", title: "Code", stage: "Coding" },
    { id: "t2", missionId: "m4", title: "Stuck", stage: "Needs you" },
    { id: "t3", missionId: "m4", title: "Check", stage: "QA check" },
    { id: "t4", missionId: "m4", title: "Look", stage: "Final review" },
    { id: "t5", missionId: "m4", title: "Fresh", stage: "Done", updatedAt: "2026-10-30T08:00:00Z" },
    { id: "t6", missionId: "m6", title: "Stale", stage: "Done", updatedAt: "2026-10-27T08:00:00Z" },
    { id: "t7", missionId: "m6", title: "Closed mission", stage: "Coding" },
  ];
  const { counts, items } = buildPipe(missions, tasks, NOW);

  assert.deepEqual(counts, { plan: 1, spec: 2, code: 2, qa: 1, review: 2, done: 1 });
  assert.equal(items.find((i) => i.id === "m3")?.waiting, true);
  const stuck = items.find((i) => i.id === "t2");
  assert.equal(stuck?.stage, "code");
  assert.equal(stuck?.waiting, true);
  assert.equal(items.some((i) => i.id === "t7"), false);
});

test("buildPipe caps dots but not counts", () => {
  const missions: PipeMission[] = [{ id: "m", title: "Big", status: "running", phase: "executing" }];
  const tasks: PipeTask[] = Array.from({ length: MAX_PIPE_ITEMS + 5 }, (_, i) => ({
    id: `t${i}`,
    missionId: "m",
    title: "",
    stage: "Coding" as const,
  }));
  const { counts, items } = buildPipe(missions, tasks, NOW);
  assert.equal(counts.code, MAX_PIPE_ITEMS + 5);
  assert.equal(items.length, MAX_PIPE_ITEMS);
  assert.equal(items[0].title, "Big");
});

test("buildDashboard adds mission rows, newest activity first and hourly tokens", () => {
  const missions: PipeMission[] = [
    { id: "m1", title: "Build", status: "running", phase: "executing" },
    { id: "m2", title: "Approve", status: "awaiting_plan_approval", phase: "spec" },
  ];
  const tasks: PipeTask[] = [
    { id: "a", missionId: "m1", title: "A", stage: "Done", updatedAt: "2026-10-30T11:30:00Z", tokens: 100 },
    { id: "b", missionId: "m1", title: "B", stage: "Needs you", updatedAt: "2026-10-30T11:50:00Z", tokens: 50 },
    { id: "c", missionId: "m1", title: "C", stage: "Coding", updatedAt: "2026-10-30T09:10:00Z", tokens: 7 },
    { id: "d", missionId: "m1", title: "D", stage: "Queued" },
  ];
  const snap = buildDashboard(missions, tasks, NOW);

  assert.deepEqual(
    snap.missions.map((m) => [m.id, m.stage, m.waiting, m.done, m.total]),
    [
      ["m1", "code", true, 1, 4],
      ["m2", "spec", true, 0, 0],
    ],
  );
  assert.deepEqual(snap.activity.map((a) => [a.id, a.tone]), [
    ["b", "waiting"],
    ["a", "done"],
    ["c", "running"],
  ]);
  assert.equal(snap.tokens.length, 14);
  assert.equal(snap.tokens[13], 157);
  // No per-agent rows were passed, so every token is unsplit.
  assert.equal(snap.unsplitTokens, 157);
});

test("tokensByDay buckets by local day and skips old or future tasks", () => {
  const day = 24 * 60 * 60 * 1000;
  const iso = (at: number) => new Date(at).toISOString();
  const tokens = tokensByDay(
    [
      { updatedAt: iso(NOW - 1000), tokens: 5 },
      { updatedAt: iso(NOW - 3 * day), tokens: 9 },
      { updatedAt: iso(NOW - 30 * day), tokens: 100 },
      { updatedAt: iso(NOW + day), tokens: 100 },
      { updatedAt: null, tokens: 100 },
    ],
    NOW,
  );
  assert.equal(tokens.length, 14);
  assert.equal(tokens[13], 5);
  assert.equal(tokens[10], 9);
  assert.equal(tokens.reduce((a, b) => a + b, 0), 14);
});

test("tokensByRuntime labels runtimes and treats a missing one as Hermes", () => {
  const rows = tokensByRuntime([
    { runtime: "ohmypi", tokens: 30 },
    { runtime: "hermes", tokens: 10 },
    { runtime: null, tokens: 5 },
  ]);
  assert.deepEqual(rows.map((r) => [r.id, r.name, r.tokens]), [
    ["ohmypi", "OMP", 30],
    ["hermes", "Hermes", 15],
  ]);
});

test("tokensByModel sums per model and names a missing model", () => {
  const rows = tokensByModel([
    { agentId: "a", model: "gpt-5", tokens: 10 },
    { agentId: "b", model: "gpt-5", tokens: 5 },
    { agentId: "c", model: null, tokens: 7 },
  ]);
  assert.deepEqual(rows.map((r) => [r.name, r.tokens]), [
    ["gpt-5", 15],
    ["Not recorded", 7],
  ]);
});

test("tokensByAgent sums per agent and folds the tail into Others", () => {
  const rows = tokensByAgent(
    [
      { agentId: "a", agentName: "Dev", tokens: 50 },
      { agentId: "a", agentName: "Dev", tokens: 30 },
      { agentId: "b", agentName: "QA", tokens: 40 },
      { agentId: null, agentName: "", tokens: 5 },
      { agentId: "c", agentName: "Spec", tokens: 3 },
      { agentId: "d", agentName: "Ops", tokens: 0 },
    ],
    3,
  );
  assert.deepEqual(rows.map((r) => [r.name, r.tokens]), [
    ["Dev", 80],
    ["QA", 40],
    ["Others", 8],
  ]);
});

test("dashboard summary counts all active missions and activity excludes older and future tasks", () => {
  const missions: PipeMission[] = Array.from({ length: 7 }, (_, i) => ({ id: `m${i}`, title: `Mission ${i}`, status: "running", phase: "executing" }));
  const tasks: PipeTask[] = [
    { id: "recent", missionId: "m0", title: "Recent", stage: "Coding", updatedAt: "2026-10-30T11:00:00Z" },
    { id: "old", missionId: "m0", title: "Old", stage: "Coding", updatedAt: "2026-10-28T11:00:00Z" },
    { id: "future", missionId: "m0", title: "Future", stage: "Coding", updatedAt: "2026-10-31T11:00:00Z" },
  ];
  const dashboard = buildDashboard(missions, tasks, NOW);
  assert.equal(dashboard.summary.activeMissions, 7);
  assert.equal(dashboard.missions.length, 5);
  assert.deepEqual(dashboard.activity.map((item) => item.id), ["recent"]);
});

test("buildDashboard summary handles >5 missions and >300 recent tasks without capping totals", () => {
  const missions: PipeMission[] = Array.from({ length: 12 }, (_, i) => ({
    id: `m${i}`,
    title: `Mission ${i}`,
    status: i % 2 === 0 ? "running" : "awaiting_plan_approval",
    phase: "executing",
  }));
  // 350 completed tasks within the rolling 24-hour window
  const tasks: PipeTask[] = Array.from({ length: 350 }, (_, i) => ({
    id: `t${i}`,
    missionId: `m${i % 12}`,
    title: `Task ${i}`,
    stage: "Done",
    updatedAt: new Date(NOW - 1000 * 60 * (i + 1)).toISOString(),
  }));
  const snap = buildDashboard(missions, tasks, NOW);
  assert.equal(snap.summary.activeMissions, 12);
  assert.equal(snap.missions.length, 5);
  assert.equal(snap.summary.completedTasks24h, 350);
  assert.equal(snap.activity.length, 8);
});

test("buildDashboard handles missions without tasks cleanly with total: 0", () => {
  const missions: PipeMission[] = [
    { id: "m-empty", title: "Empty Mission", status: "running", phase: "planning" },
  ];
  const snap = buildDashboard(missions, [], NOW);
  assert.equal(snap.missions.length, 1);
  assert.equal(snap.missions[0].id, "m-empty");
  assert.equal(snap.missions[0].stage, "plan");
  assert.equal(snap.missions[0].total, 0);
  assert.equal(snap.missions[0].done, 0);
  assert.equal(snap.missions[0].waiting, false);
});
