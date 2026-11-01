import { test } from "node:test";
import assert from "node:assert/strict";
import { loadMissionRunUsage, mapRunUsage } from "./run-usage";
import type { SupabaseClient } from "@supabase/supabase-js";

test("run usage retains missing cost and phase-level run IDs", () => {
  assert.deepEqual(mapRunUsage({ run_id: "r", task_id: null, stage: "planning", tokens: 42, cost_usd: "0.012345", created_at: "date" }), {
    runId: "r", taskId: "", stage: "planning", tokens: 42, model: null, inputTokens: null, outputTokens: null, cacheReadTokens: null, costUsd: 0.012345, at: "date",
  });
  assert.equal(mapRunUsage({ cost_usd: null }).costUsd, null);
});

test("mission usage loads every page and surfaces read errors", async () => {
  const source = Array.from({ length: 1001 }, (_, index) => ({ run_id: `r${index}`, cost_usd: "0.01" }));
  const chain = {
    select() { return this; }, eq() { return this; }, order() { return this; },
    async range(from: number, to: number) { return { data: source.slice(from, Math.min(to + 1, from + 300)), count: source.length, error: null }; },
  };
  const db = { from: () => chain } as unknown as SupabaseClient;
  const rows = await loadMissionRunUsage(db, "m");
  assert.equal(rows.length, 1001);
  assert.equal(rows[1000].runId, "r1000");
  const broken = { ...chain, range: async () => ({ data: null, error: { message: "unavailable" } }) };
  await assert.rejects(loadMissionRunUsage({ from: () => broken } as unknown as SupabaseClient, "m"), /unavailable/);
});
