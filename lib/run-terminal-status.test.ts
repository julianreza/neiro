import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyRun } from "./orchestrator";
import { askResultUpdate, askStatusFromRun } from "./ask-history";

test("interrupted and stopped runs fail instead of waiting forever", () => {
  assert.equal(classifyRun("interrupted"), "failure");
  assert.equal(classifyRun("STOPPED"), "failure");
});

test("terminal status normalization and chat persistence", () => {
  assert.equal(classifyRun("  Interrupted  "), "failure");
  for (const status of ["running", "queued", "stopping", "unknown", "waiting_for_approval"]) {
    assert.equal(classifyRun(status), "pending");
    assert.equal(askStatusFromRun(status), null);
  }
  assert.equal(askResultUpdate({ status: " INTERRUPTED ", output: "partial" })?.status, "failed");
  assert.equal(askResultUpdate({ status: " STOPPED " })?.status, "stopped");
  assert.match(askResultUpdate({ status: "interrupted" })?.error ?? "", /interrupted/i);
  assert.ok(askResultUpdate({ status: "stopped" })?.finished_at);
});
