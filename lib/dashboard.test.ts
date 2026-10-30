import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDashboard, buildPipe, MAX_PIPE_ITEMS } from "./dashboard";
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
  assert.equal(snap.tokens.length, 12);
  assert.equal(snap.tokens[11], 150);
  assert.equal(snap.tokens[9], 7);
});
