import assert from "node:assert/strict";
import { test } from "node:test";
import { verificationPolicy } from "./verification-policy";

test("unavailable QA and review require explicit consent before skipping", () => {
  const checks = [{ id: "qa", status: "warning" as const, reason: "Unavailable" }, { id: "reviewer", status: "pass" as const, reason: "Ready" }];
  assert.deepEqual(verificationPolicy(checks, false), { ok: false });
  assert.deepEqual(verificationPolicy(checks, true), { ok: true, skipQa: true, skipReview: false });
  assert.deepEqual(verificationPolicy([{ id: "qa", status: "unknown", reason: "Could not verify" }], false), { ok: true, skipQa: false, skipReview: false });
});
