import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { listHermesModelOptions } from "./hermes";

const originalFetch = globalThis.fetch;
const originalProvider = process.env.HERMES_PROVIDER_SLUG;
const originalUrl = process.env.HERMES_DEFAULT_URL;
const originalKey = process.env.HERMES_DEFAULT_KEY;
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalProvider === undefined) delete process.env.HERMES_PROVIDER_SLUG; else process.env.HERMES_PROVIDER_SLUG = originalProvider;
  if (originalUrl === undefined) delete process.env.HERMES_DEFAULT_URL; else process.env.HERMES_DEFAULT_URL = originalUrl;
  if (originalKey === undefined) delete process.env.HERMES_DEFAULT_KEY; else process.env.HERMES_DEFAULT_KEY = originalKey;
});

test("discovers models with the agent endpoint, profile and credential", async () => {
  let requested = "";
  let authorization = "";
  globalThis.fetch = (async (input, init) => {
    requested = String(input);
    authorization = new Headers(init?.headers).get("Authorization") || "";
    return Response.json({ provider: "anthropic", model: "claude", providers: [{ slug: "anthropic", is_current: true, models: ["claude"] }] });
  }) as typeof fetch;
  const agent = { url: "https://agent.example", profile: "engineering", key_enc: "agent-key" };
  await listHermesModelOptions(agent);
  assert.equal(requested, "https://agent.example/p/engineering/api/model/options");
  assert.equal(authorization, "Bearer agent-key");
});

test("uses the run provider override instead of the current provider", async () => {
  process.env.HERMES_DEFAULT_URL = "https://default.example";
  process.env.HERMES_DEFAULT_KEY = "key";
  process.env.HERMES_PROVIDER_SLUG = "openai";
  globalThis.fetch = (async () => Response.json({ provider: "anthropic", model: "claude", providers: [{ slug: "anthropic", is_current: true, models: ["claude"] }, { slug: "openai", models: ["gpt"] }] })) as typeof fetch;
  const result = await listHermesModelOptions();
  assert.deepEqual(result.models.map((model) => model.id), ["gpt"]);
});
