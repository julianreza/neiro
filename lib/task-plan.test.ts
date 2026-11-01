import assert from "node:assert/strict";
import { test } from "node:test";
import { validateTaskPlan } from "./task-plan";

test("task plans reject duplicate, unknown and cyclic dependencies", () => {
  assert.equal(validateTaskPlan([{ taskKey: "T1", depends: [] }, { taskKey: "T2", depends: ["T1"] }]), null);
  assert.match(validateTaskPlan([{ taskKey: "T1", depends: ["T2"] }, { taskKey: "T2", depends: ["T1"] }])!, /cycle/i);
  assert.match(validateTaskPlan([{ taskKey: "T1", depends: ["MISSING"] }])!, /unknown/i);
  assert.match(validateTaskPlan([{ taskKey: "T1", depends: [] }, { taskKey: "T1", depends: [] }])!, /duplicate/i);
  assert.match(validateTaskPlan([{ taskKey: "T1", depends: ["T1"] }])!, /cycle/i);
});

test("plan edits validate fields without changing dependency keys", async () => {
  const { parseTaskPlanEdit } = await import("./task-plan");
  assert.deepEqual(parseTaskPlanEdit({ task_key: "T3", title: "  New task ", result: "Details", agent_name: "backend", depends: ["T1"] }, true), { task_key: "T3", title: "New task", result: "Details", agent_name: "backend", depends: ["T1"] });
  assert.equal(parseTaskPlanEdit({ task_key: "../", title: "Bad", depends: [] }, true), null);
  assert.equal(parseTaskPlanEdit({ title: "Good", depends: [4] }, false), null);
  assert.equal(parseTaskPlanEdit({ title: "", depends: [] }, false), null);
});
