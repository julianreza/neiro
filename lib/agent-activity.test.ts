import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { agentActivity } from "@/lib/agent-activity";

test("activity combines all sources, deduplicates runs and reads every page", async () => {
  const rows: Record<string, Record<string, unknown>[]> = {
    missions: Array.from({ length: 1201 }, (_, i) => ({ id: `m${i}`, run_id: `r${i}`, run_agent_id: "planner" })),
    mission_tasks: [{ id: "t", run_id: "review-run", run_agent_id: "reviewer" }],
    ask_questions: [{ id: "ask", agent_id: "chat" }],
    bot_rooms: [{ id: "room", driver: { claim: { agentId: "room-bot", runId: "claim:room" } } }],
    code_reviews: [{ id: "review", run_id: "review-run", agent_id: "reviewer" }],
  };
  const db = { from(table: string) {
    const query = {
      select() { return query; }, not() { return query; }, eq() { return query; }, in() { return query; }, order() { return query; },
      range(from: number, to: number) { return Promise.resolve({ data: rows[table].slice(from, to + 1), count: rows[table].length, error: null }); },
    };
    return query;
  } } as unknown as SupabaseClient;
  const activity = await agentActivity(db);
  assert.equal(activity.get("planner")?.size, 1201);
  assert.equal(activity.get("reviewer")?.size, 1);
  assert.equal(activity.get("chat")?.has("ask"), true);
  assert.equal(activity.get("room-bot")?.has("claim:room"), true);
});
