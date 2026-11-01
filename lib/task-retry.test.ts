import { test } from "node:test";
import assert from "node:assert/strict";
import { taskRetryPatch } from "./task-retry";

test("retry returns to the interrupted verification gate without redoing coding", () => {
  const patch = taskRetryPatch({ verification_wait_stage: "QA check", retries: 2, task_integration_pending: false });
  assert.equal(patch.stage, "QA check");
  assert.equal(patch.retries, 2);
  assert.equal(patch.verification_wait_stage, null);
  assert.ok(!("result_output" in patch));
});

test("invalid stored gate never selects an arbitrary stage", () => {
  const patch = taskRetryPatch({ verification_wait_stage: "bogus", retries: 1, task_integration_pending: false });
  assert.equal(patch.stage, "Queued");
  assert.equal(patch.retries, 2);
});
