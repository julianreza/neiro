import { test } from "node:test";
import assert from "node:assert/strict";
import { costSourceForRun, costSourcesFromArtifacts, matchingCostSource, summarizeCostSources } from "./run-cost-sources";

test("cost source distinguishes runtime, subscription and catalog estimates without guessing", () => {
  assert.equal(costSourceForRun({ estimated_cost_usd: 0.4, cost_status: "actual" }, 0.4, false), "reported");
  assert.equal(costSourceForRun({ estimated_cost_usd: 0.4, cost_status: "estimated" }, 0.4, false), "runtime_estimate");
  assert.equal(costSourceForRun({ estimated_cost_usd: 0, cost_status: "included" }, 0, false), "included");
  assert.equal(costSourceForRun({}, 0.3, true), "catalog_estimate");
  assert.equal(costSourceForRun({}, 0.3, false), "unknown");
  assert.equal(costSourceForRun({ estimated_cost_usd: 0.4, cost_status: "actual" }, 0.9, false), "unknown");
});

test("cost metadata is joined by run and historical records stay unknown", () => {
  const sources = costSourcesFromArtifacts([
    { run_id: "r1", content: JSON.stringify({ runId: "r1", source: "reported", costUsd: 0.3 }) },
    { run_id: "r2", content: JSON.stringify({ runId: "wrong", source: "included" }) },
    { run_id: "r3", content: "invalid" },
  ]);
  assert.deepEqual(sources.get("r1"), { source: "reported", costUsd: 0.3 });
  assert.equal(matchingCostSource(0.3, sources.get("r1")), "reported");
  assert.equal(matchingCostSource(0.4, sources.get("r1")), "unknown");
  assert.equal(sources.has("r2"), false);
  assert.deepEqual(summarizeCostSources([
    { costUsd: 0.3, costSource: sources.get("r1")?.source },
    { costUsd: 0.2 },
    { costUsd: null, costSource: "included" },
  ]), {
    reported: { cost: 0.3, count: 1 }, runtime_estimate: { cost: 0, count: 0 }, catalog_estimate: { cost: 0, count: 0 }, included: { cost: 0, count: 0 }, unknown: { cost: 0.2, count: 1 },
  });
});
