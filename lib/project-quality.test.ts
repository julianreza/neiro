import assert from "node:assert/strict";
import { test } from "node:test";
import { buildProjectQuality } from "./project-quality";
import type { MissionResult } from "./mission-result";

test("quality covers every mission and excludes unknown duration and QA", () => {
  const results = Array.from({ length: 1200 }, (_, i) => ({ durationMs: i < 2 ? null : i * 1000, retries: 1, qaPassed: 1, qaKnown: 1, tasks: [{}, {}] }) as unknown as MissionResult);
  const result = buildProjectQuality(results, 7);
  assert.equal(result.missions, 1200);
  assert.equal(result.retries, 1200);
  assert.equal(result.missingDuration, 2);
  assert.equal(result.missingCompletionDates, 7);
  assert.equal(result.qaPassed, 1200);
  assert.equal(result.qaKnown, 1200);
  assert.equal(result.qaUnknown, 1200);
  assert.equal(result.medianDurationMs, 600500);
});
