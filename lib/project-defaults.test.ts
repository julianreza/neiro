import { describe, it as test } from "node:test";
import assert from "node:assert/strict";
import { applyProjectDefaults, parseProjectDefaults } from "./project-defaults";

describe("project defaults", () => {
  test("explicit false, zero and null override project values", () => {
    assert.deepEqual(applyProjectDefaults({ pause_after_planning: false, token_budget: null, max_retries: 0 }, { pause_after_planning: true, token_budget: 5000, max_retries: 2 }), { pause_after_planning: false, token_budget: null, max_retries: 0 });
  });
  test("validates mission limits and rejects unknown defaults", () => {
    assert.equal(parseProjectDefaults({ max_parallel_workers: 11 }).ok, false);
    assert.equal(parseProjectDefaults({ token_budget: -1 }).ok, false);
    assert.equal(parseProjectDefaults({ unknown: 1 }).ok, false);
    assert.equal(parseProjectDefaults({ max_retries: 0, pause_after_planning: false, token_budget: null }).ok, true);
  });
});
