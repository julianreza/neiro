import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { estimateAgentRunCost, estimateRunCost, summarizeRunCosts } from "./usage-cost";
import type { Agent } from "./types";

const originalFetch = globalThis.fetch;
const originalProvider = process.env.HERMES_PROVIDER_SLUG;
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalProvider === undefined) delete process.env.HERMES_PROVIDER_SLUG;
  else process.env.HERMES_PROVIDER_SLUG = originalProvider;
});

test("cost estimate requires complete token counts and rates and accounts for cached input", () => {
  assert.equal(estimateRunCost({ input_tokens: 1_000_000, output_tokens: 100_000, cache_read_tokens: 500_000 }, { input: 2, output: 10, cacheRead: 0.5 }), 2.25);
  assert.equal(estimateRunCost({ input_tokens: 100, output_tokens: 20 }, { input: 2, output: 4 }), 0.00028);
  assert.equal(estimateRunCost({ input_tokens: 100 }, { input: 2, output: 4 }), null);
  assert.equal(estimateRunCost({ input_tokens: 100, output_tokens: 20 }, { input: 2 }), null);
  assert.equal(estimateRunCost({ input_tokens: 100, output_tokens: 20, cache_read_tokens: 101 }, { input: 2, output: 4, cacheRead: 1 }), null);
});

test("cost totals distinguish no estimates, partial estimates, and free estimates", () => {
  assert.deepEqual(summarizeRunCosts([]), { cost: null, priced: 0, total: 0 });
  assert.deepEqual(summarizeRunCosts([{ costUsd: null }, { costUsd: 0 }, { costUsd: 0.25 }]), { cost: 0.25, priced: 2, total: 3 });
});

test("agent cost uses the actual provider and model or leaves pricing unknown", async () => {
  delete process.env.HERMES_PROVIDER_SLUG;
  globalThis.fetch = (async () => Response.json({ provider: "alpha", model: "a", providers: [
    { slug: "alpha", authenticated: true, models: ["a"], pricing: { a: { input: "$2", output: "$4" } } },
    { slug: "beta", authenticated: true, models: ["a"], pricing: { a: { input: "$10", output: "$20" } } },
  ] })) as typeof fetch;
  const agent = { id: "a", runtime: "hermes", url: "https://example.test", profile: "default", key_enc: "key", model: "a" } as Agent;
  const run = { run_id: "r", status: "completed", input_tokens: 1000, output_tokens: 1000, runtime: { provider: "beta", model: "a" } };
  assert.equal(await estimateAgentRunCost(agent, run), 0.03);
  assert.equal(await estimateAgentRunCost(agent, { ...run, runtime: { provider: "unknown", model: "a" } }), null);
  assert.equal(await estimateAgentRunCost(agent, { ...run, estimated_cost_usd: 0.007, cost_status: "actual" }), 0.007);
});
