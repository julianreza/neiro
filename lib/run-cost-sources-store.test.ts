import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadRunCostSources } from "./run-cost-sources-store";

test("provenance loading batches run IDs and follows server pagination", async () => {
  const rows = Array.from({ length: 205 }, (_, i) => ({ run_id: `r${i}`, content: JSON.stringify({ runId: `r${i}`, source: "reported", costUsd: 0.5 }) }));
  const calls: number[] = [];
  const db = { from() {
    let selected: string[] = [];
    return {
      select() { return this; }, eq() { return this; }, order() { return this; },
      in(_name: string, ids: string[]) { selected = ids; calls.push(ids.length); return this; },
      async range(from: number, to: number) { const found = rows.filter((row) => selected.includes(row.run_id)); return { data: found.slice(from, Math.min(to + 1, from + 30)), count: found.length, error: null }; },
    };
  } } as unknown as SupabaseClient;
  const result = await loadRunCostSources(db, rows.map((row) => row.run_id));
  assert.equal(result.size, 205);
  assert.deepEqual(calls, [100, 100, 100, 100, 100, 100, 100, 100, 5]);
});
