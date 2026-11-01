import { test } from "node:test";
import assert from "node:assert/strict";
import { countCompletedTasks } from "./dashboard-counts";
import type { SupabaseClient } from "@supabase/supabase-js";

test("completed task count uses the recorded completion timestamp and preserves unknowns", async () => {
  const calls: string[] = [];
  const builder = {
    select(_s: string, opts: { count: string; head: boolean }) { assert.deepEqual(opts, { count: "exact", head: true }); return this; },
    eq(key: string, value: string) { calls.push(`${key}=${value}`); return this; },
    gte(key: string, value: string) { calls.push(`${key}>=${value}`); return this; },
    lte(key: string, value: string) { calls.push(`${key}<=${value}`); return Promise.resolve({ count: 375, error: null }); },
    is(key: string, value: null) { calls.push(`${key}=${value}`); return Promise.resolve({ count: 12, error: null }); },
  };
  const db = { from: () => builder } as unknown as SupabaseClient;
  assert.deepEqual(await countCompletedTasks(db, "start", "end"), { completed: 375, withoutTime: 12 });
  assert.ok(calls.includes("completed_at>=start"));
  assert.ok(calls.includes("completed_at<=end"));
  assert.ok(calls.includes("completed_at=null"));
});

test("a missing completion column remains unknown instead of becoming zero", async () => {
  const chain = {
    select() { return this; }, eq() { return this; }, gte() { return this; },
    async lte() { return { count: null, error: { message: "column missing" } }; },
    async is() { return { count: null, error: { message: "column missing" } }; },
  };
  assert.deepEqual(await countCompletedTasks({ from: () => chain } as unknown as SupabaseClient, "start", "end"), { completed: null, withoutTime: null });
});
