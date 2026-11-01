import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyRun } from "./orchestrator";

test("interrupted and stopped runs fail instead of waiting forever", () => {
  assert.equal(classifyRun("interrupted"), "failure");
  assert.equal(classifyRun("STOPPED"), "failure");
});
