import assert from "node:assert/strict";
import { test } from "node:test";
import { railStops } from "./mission-rail";

test("a completed mission stands at Done with every station passed", () => {
  const r = railStops({ status: "completed", phase: "done" });
  assert.equal(r.at, 4);
  assert.deepEqual(r.states, ["done", "done", "done", "done", "done"]);
  assert.equal(r.note, "Reached Done");
});

test("a cancelled mission stops at the phase it was in", () => {
  const r = railStops({ status: "cancelled", phase: "spec" });
  assert.equal(r.at, 1);
  assert.deepEqual(r.states, ["done", "stop", "todo", "todo", "todo"]);
  assert.equal(r.note, "Stopped at Spec");
});

test("a running mission is now at its phase", () => {
  const r = railStops({ status: "running", phase: "executing" });
  assert.equal(r.at, 2);
  assert.equal(r.states[2], "now");
  assert.equal(r.note, "Now at Build");
});

test("a plan waiting for approval waits at Plan", () => {
  const r = railStops({ status: "awaiting_plan_approval", phase: "spec" });
  assert.equal(r.at, 0);
  assert.deepEqual(r.states, ["wait", "todo", "todo", "todo", "todo"]);
});
