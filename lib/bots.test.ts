import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { botInstructions, ensureCanonicalSession } from "./bots";
import type { Agent } from "./types";

/** Just enough of the Supabase query builder for agents.canonical_session_id. */
function fakeDb(row: { canonical_session_id: string | null }) {
  const db = {
    from() {
      return {
        update(values: { canonical_session_id: string }) {
          const filters: Array<(r: typeof row) => boolean> = [];
          const chain = {
            eq() {
              return chain;
            },
            is(_col: string, value: null) {
              filters.push((r) => r.canonical_session_id === value);
              return chain;
            },
            async select() {
              await Promise.resolve();
              if (filters.every((f) => f(row))) {
                row.canonical_session_id = values.canonical_session_id;
                return { data: [{ ...row }], error: null };
              }
              return { data: [], error: null };
            },
          };
          return chain;
        },
        select() {
          return { eq: () => ({ maybeSingle: async () => ({ data: { ...row }, error: null }) }) };
        },
      };
    },
  };
  return db as unknown as SupabaseClient;
}

// An Oh My Pi agent: its sessions are local keys, so no server is called.
const agent = { id: "forge", name: "Forge", role: "Backend", prompt: "", runtime: "ohmypi", canonicalSessionId: null } as unknown as Agent;

test("two first messages at once keep one forever-chat session", async () => {
  const row = { canonical_session_id: null as string | null };
  const db = fakeDb(row);
  const [a, b] = await Promise.all([ensureCanonicalSession(db, agent), ensureCanonicalSession(db, agent)]);
  assert.equal(a, b);
  assert.equal(row.canonical_session_id, a);
});

test("an existing session is reused", async () => {
  const db = fakeDb({ canonical_session_id: "s1" });
  assert.equal(await ensureCanonicalSession(db, { ...agent, canonicalSessionId: "s1" }), "s1");
});

test("the team roster is added only when the message mentions someone", () => {
  const team = [
    { id: "forge", handle: "forge", name: "Forge", role: "Backend" },
    { id: "lens", handle: "lens", name: "Lens", role: "Reviewer" },
  ];
  assert.doesNotMatch(botInstructions(agent, "hello", team), /teammates/);
  const withMention = botInstructions(agent, "ask @lens to check", team);
  assert.match(withMention, /@lens — Lens/);
  assert.doesNotMatch(withMention, /@forge —/);
});
