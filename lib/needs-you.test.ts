import assert from "node:assert/strict";
import { test } from "node:test";
import { buildNeedsYou, roomNeedsYou } from "./needs-you";
import { parseMissionCreateBody } from "./mission-input";

const base = { lastError: null, lastErrorAt: null };

test("Needs you lists plan approvals, agent picks, failures and errors in priority order", () => {
  const items = buildNeedsYou(
    [
      { id: "m1", title: "Plan", status: "awaiting_plan_approval", ...base },
      { id: "m2", title: "Run", status: "running", ...base },
      { id: "m3", title: "Broken", status: "running", lastError: "Hermes unreachable", lastErrorAt: "2026-10-28T00:00:00Z" },
    ],
    [
      { id: "t1", missionId: "m2", title: "API", stage: "Needs you", retries: 2, routeReason: null },
      { id: "t2", missionId: "m2", title: "UI", stage: "Awaiting routing", retries: 0, routeReason: "Low confidence" },
    ]
  );
  assert.deepEqual(items.map((i) => i.kind), ["plan_approval", "pick_agent", "task_failed", "mission_error"]);
  assert.equal(items[1].detail, "Low confidence");
  assert.match(items[2].detail, /3 attempt/);
});

test("a budget stop shows once as a budget item, not also as a mission error", () => {
  const items = buildNeedsYou(
    [{ id: "m1", title: "M", status: "running", lastError: "Mission token budget reached: 10 of 5", lastErrorAt: null }],
    [{ id: "t1", missionId: "m1", title: "T", stage: "Needs you", retries: 0, routeReason: null }]
  );
  assert.deepEqual(items.map((i) => i.kind), ["budget"]);
});

test("task integration failures show their actual reason without duplicating the mission", () => {
  const items = buildNeedsYou(
    [{ id: "m1", title: "M", status: "running", lastError: 'Task [t1]: Merge conflict: src/a.ts', lastErrorAt: null }],
    [{ id: "t1", missionId: "m1", title: "T", stage: "Needs you", retries: 0, routeReason: null }],
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].detail, "Merge conflict: src/a.ts");
});

test("tasks of missions that are not in the list are ignored", () => {
  const items = buildNeedsYou([], [
    { id: "t1", missionId: "gone", title: "T", stage: "Needs you", retries: 0, routeReason: null },
  ]);
  assert.equal(items.length, 0);
});

test("awaiting approval exposes its error alongside the approval; terminal errors stay out", () => {
  const items = buildNeedsYou(
    [
      { id: "waiting", title: "Plan", status: "awaiting_plan_approval", lastError: "Artifact save failed", lastErrorAt: null },
      { id: "done", title: "Done", status: "completed", lastError: "Old error", lastErrorAt: null },
      { id: "cancelled", title: "Cancelled", status: "cancelled", lastError: "Old error", lastErrorAt: null },
    ],
    []
  );
  assert.deepEqual(items.map((item) => [item.missionId, item.kind]), [
    ["waiting", "plan_approval"],
    ["waiting", "mission_error"],
  ]);
  assert.equal(items[1].detail, "Artifact save failed");
});

test("mission input accepts an optional token_budget", () => {
  const ok = parseMissionCreateBody({ prompt: "Do it", token_budget: 50_000 });
  assert.ok(ok.ok && ok.value.tokenBudget === 50_000);
  const none = parseMissionCreateBody({ prompt: "Do it" });
  assert.ok(none.ok && none.value.tokenBudget === null);
  assert.equal(parseMissionCreateBody({ prompt: "Do it", token_budget: -5 }).ok, false);
});

test("roomNeedsYou constructs room items and issues categorization matches failed/error/budget", () => {
  const rooms = roomNeedsYou([
    { id: "room-1", name: "War Room", updatedAt: "2026-10-30T10:00:00Z" },
  ]);
  assert.equal(rooms.length, 1);
  assert.equal(rooms[0].kind, "room_needs_you");
  assert.equal(rooms[0].missionId, "room-1");
  assert.equal(rooms[0].missionTitle, "War Room");

  const allItems = [
    ...rooms,
    { kind: "task_failed", missionId: "m1", missionTitle: "M1", taskId: "t1", taskTitle: "T1", detail: "failed", since: null },
    { kind: "mission_error", missionId: "m2", missionTitle: "M2", taskId: null, taskTitle: null, detail: "err", since: null },
    { kind: "budget", missionId: "m3", missionTitle: "M3", taskId: null, taskTitle: null, detail: "budget", since: null },
    { kind: "plan_approval", missionId: "m4", missionTitle: "M4", taskId: null, taskTitle: null, detail: "plan", since: null },
    { kind: "pick_agent", missionId: "m5", missionTitle: "M5", taskId: "t5", taskTitle: "T5", detail: "pick", since: null },
  ];

  const issues = allItems.filter((item) => ["task_failed", "mission_error", "budget"].includes(item.kind));
  assert.equal(issues.length, 3);
  assert.deepEqual(issues.map((i) => i.kind), ["task_failed", "mission_error", "budget"]);
});
