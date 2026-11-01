import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildModelOptions,
  cleanSessionKey,
  createHermesSession,
  clearHermesCapabilitiesCache,
  forkHermesSession,
  getHermesDetailedInventory,
  getHermesRun,
  getHermesServerCapabilities,
  readinessOf,
  probeHermesAgent,
  resolveHermesUnknownRun,
  startHermesRun,
  submitHermesRunApproval,
} from "./hermes";
import type { Agent } from "./types";

const originalFetch = globalThis.fetch;
const originalProvider = process.env.HERMES_PROVIDER_SLUG;

const agent = {
  id: "a1",
  name: "Forge",
  role: "Backend",
  stage: "workers",
  specialty: "",
  model: "",
  profile: "default",
  prompt: "You build things.",
  url: "https://hermes.example",
  key_enc: "k",
  enabled: true,
  activeRun: false,
} as Agent;

type Call = { url: string; init?: RequestInit; body: Record<string, unknown> | null };
let calls: Call[] = [];

function stub(respond: (call: Call, index: number) => Response) {
  globalThis.fetch = (async (input, init) => {
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    const call = { url: String(input), init, body };
    calls.push(call);
    return respond(call, calls.length - 1);
  }) as typeof fetch;
}

beforeEach(() => {
  calls = [];
  delete process.env.HERMES_PROVIDER_SLUG;
  clearHermesCapabilitiesCache();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalProvider === undefined) delete process.env.HERMES_PROVIDER_SLUG;
  else process.env.HERMES_PROVIDER_SLUG = originalProvider;
});

const header = (call: Call, name: string) => new Headers(call.init?.headers).get(name);

test("session creation accepts Hermes nested session responses", async () => {
  stub((call) => call.init?.method === "POST" ? Response.json({ object: "hermes.session", session: { id: "session-123" } }, { status: 201 }) : Response.json({}));
  assert.equal(await createHermesSession(agent, "Task"), "session-123");
  assert.equal(calls[1].url, "https://hermes.example/api/sessions/session-123");
});

test("a public health endpoint cannot hide rejected Hermes credentials", async () => {
  stub((call) => call.url.endsWith("/health/detailed") ? new Response("Unauthorized", { status: 401 }) : Response.json({ status: "ok" }));
  const result = await probeHermesAgent(agent);
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /401/);
  assert.equal(calls.length, 1);
});

test("the session key header is cleaned and capped at 256 characters", async () => {
  assert.equal(cleanSessionKey("neiro:project:1\r\nX-Evil: 1\0"), "neiro:project:1X-Evil: 1");
  assert.equal(cleanSessionKey("x".repeat(300)).length, 256);
  assert.equal(cleanSessionKey(undefined), "");

  stub(() => Response.json({ run_id: "r1" }));
  await startHermesRun(agent, { prompt: "hi", sessionKey: "neiro:project:p1\n" });
  assert.equal(header(calls[0], "X-Hermes-Session-Key"), "neiro:project:p1");

  await startHermesRun(agent, { prompt: "hi", sessionKey: "\r\n" });
  assert.equal(header(calls[1], "X-Hermes-Session-Key"), null);
});

test("model_options merge the run's options over the agent's, and are left out when empty", async () => {
  assert.deepEqual(buildModelOptions({ reasoningEffort: "high", serviceTier: "flex" }), {
    reasoning_effort: "high",
    service_tier: "flex",
  });
  assert.deepEqual(buildModelOptions({ reasoningEffort: "high" }, { reasoning_effort: "low" }), {
    reasoning_effort: "low",
  });
  assert.equal(buildModelOptions({}), undefined);

  stub(() => Response.json({ run_id: "r1" }));
  await startHermesRun({ ...agent, reasoningEffort: "medium" }, { prompt: "hi" });
  assert.deepEqual(calls[0].body?.model_options, { reasoning_effort: "medium" });
  await startHermesRun(agent, { prompt: "hi" });
  assert.equal("model_options" in (calls[1].body ?? {}), false);
});

test("skills and toolsets are never sent per run", async () => {
  stub(() => Response.json({ run_id: "r1" }));
  await startHermesRun(agent, { prompt: "hi" });
  const body = calls[0].body ?? {};
  assert.equal("skills" in body, false);
  assert.equal("toolsets" in body, false);
});

test("images go as one multimodal user message, retried as text when rejected", async () => {
  stub((call, index) =>
    index === 0
      ? Response.json({ error: { code: "invalid_image_url", message: "bad image" } }, { status: 400 })
      : Response.json({ run_id: "r2" }),
  );
  const result = await startHermesRun(agent, {
    prompt: "see this",
    images: [{ name: "a.png", dataUrl: "data:image/png;base64,AAAA" }],
  });
  assert.deepEqual(calls[0].body?.input, [
    {
      role: "user",
      content: [
        { type: "input_text", text: "see this" },
        { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
      ],
    },
  ]);
  assert.equal(calls[1].body?.input, "see this");
  assert.deepEqual(result, { kind: "started", runId: "r2", skippedImages: true });
});

test("approval choices: booleans map to once/deny, made-up ids are not sent", async () => {
  stub(() => Response.json({ ok: true }));
  await submitHermesRunApproval(agent, "r1", true, { requestId: "default", executionGeneration: null });
  assert.deepEqual(calls[0].body, { choice: "once" });
  await submitHermesRunApproval(agent, "r1", false);
  assert.deepEqual(calls[1].body, { choice: "deny" });
  await submitHermesRunApproval(agent, "r1", "always", { requestId: "apr_7", executionGeneration: 4 });
  assert.deepEqual(calls[2].body, { request_id: "apr_7", execution_generation: 4, choice: "always" });
  assert.ok(calls[2].url.endsWith("/v1/runs/r1/approval"));
});

test("resolve-unknown posts the admission details and reports success", async () => {
  stub((_, index) => (index === 0 ? Response.json({ ok: true }) : new Response("no", { status: 409 })));
  assert.equal(await resolveHermesUnknownRun(agent, "r 1", { admissionId: "adm", executionGeneration: 2 }), true);
  assert.ok(calls[0].url.endsWith("/v1/runs/r%201/resolve-unknown"));
  assert.deepEqual(calls[0].body, { admission_id: "adm", execution_generation: 2 });
  assert.equal(await resolveHermesUnknownRun(agent, "r1", { admissionId: "adm", executionGeneration: 2 }), false);
});

test("run status: cache tokens, runtime model, controls, and a missing status", async () => {
  stub(() =>
    Response.json({
      run_id: "r1",
      status: "completed",
      usage: { total_tokens: 120, cache_read_tokens: 80, cache_write_tokens: 10 },
      runtime: { provider: "anthropic", model: "claude-x", route_source: "fallback" },
      pending_controls: [{ kind: "approval", request_id: "p1", execution_generation: 3, choices: ["once", "always", "deny"] }],
    }),
  );
  const run = await getHermesRun(agent, "r1");
  assert.equal(run.cache_read_tokens, 80);
  assert.equal(run.cache_write_tokens, 10);
  assert.equal(run.model, "claude-x");
  assert.deepEqual(run.runtime, { provider: "anthropic", model: "claude-x", route_source: "fallback" });
  assert.equal(run.controls?.[0].requestId, "p1");
  assert.equal(run.controls?.[0].executionGeneration, 3);
  assert.equal(calls.length, 1, "the session is not read when the runtime names the model");

  stub(() => Response.json({ run_id: "r2" }));
  assert.equal((await getHermesRun(agent, "r2")).status, "missing_status");
});

test("capabilities: flags and endpoints, unavailable on 404, cached", async () => {
  stub(() =>
    Response.json({
      features: { run_unknown_resolution: true, run_approval: true, browser_extension_control: { enabled: false } },
      endpoints: { run_approval: { method: "POST", path: "/v1/runs/{run_id}/approval" } },
    }),
  );
  const caps = await getHermesServerCapabilities(agent);
  assert.equal(caps.available, true);
  assert.equal(caps.features.run_unknown_resolution, true);
  assert.equal(caps.features.browser_extension_control, false);
  assert.equal(caps.endpoints.run_approval.path, "/v1/runs/{run_id}/approval");
  await getHermesServerCapabilities(agent);
  assert.equal(calls.length, 1);

  clearHermesCapabilitiesCache();
  stub(() => new Response("not found", { status: 404 }));
  assert.deepEqual(await getHermesServerCapabilities(agent), { available: false, features: {}, endpoints: {} });
});

test("inventory reads { data: [...] } and plain arrays, and marks MCP toolsets", async () => {
  stub((call) =>
    call.url.endsWith("/v1/skills")
      ? Response.json({ object: "list", data: [{ name: "pdf", description: "Read PDFs", category: "docs" }] })
      : Response.json([{ name: "web", enabled: true, tools: ["web_search"] }, { name: "mcp-github", enabled: false, configured: false }]),
  );
  const inv = await getHermesDetailedInventory(agent);
  assert.deepEqual(inv.skills, [{ name: "pdf", description: "Read PDFs", category: "docs" }]);
  assert.equal(inv.toolsets[0].isMcp, false);
  assert.deepEqual(inv.toolsets[0].tools, ["web_search"]);
  assert.equal(inv.toolsets[1].isMcp, true);
  assert.equal(inv.toolsets[1].configured, false);
});

test("readiness reads nested and flat health fields", () => {
  assert.deepEqual(readinessOf({ status: "ok", db: { status: "ok" }, disk: { free_bytes: 10 }, active_runs: 2 }), {
    status: "ok",
    db: "ok",
    diskFreeBytes: 10,
    activeRuns: 2,
    pendingCompletions: undefined,
    activeDelegations: undefined,
  });
});

test("fork returns the new session id", async () => {
  stub(() => Response.json({ session: { id: "api_2" } }));
  assert.equal(await forkHermesSession(agent, "s1", "Fork: x"), "api_2");
  assert.ok(calls[0].url.endsWith("/api/sessions/s1/fork"));
  assert.deepEqual(calls[0].body, { title: "Fork: x" });
});

test("encrypted custom credentials are decrypted before sending to Hermes", async () => {
  const { encryptAgentKey } = await import("./crypto-keys");
  const previous = process.env.NEIRO_ENCRYPTION_KEY;
  process.env.NEIRO_ENCRYPTION_KEY = "test-hermes-encryption-key";
  try {
    const encrypted = await encryptAgentKey("custom-credential");
    stub(() => Response.json({ run_id: "r1" }));
    await startHermesRun({ ...agent, key_enc: encrypted }, { prompt: "hello" });
    assert.equal(header(calls[0], "Authorization"), "Bearer custom-credential");
  } finally {
    if (previous === undefined) delete process.env.NEIRO_ENCRYPTION_KEY;
    else process.env.NEIRO_ENCRYPTION_KEY = previous;
  }
});

test("steering sends trimmed input to the active Hermes run and surfaces rejection", async () => {
  const { steerHermesRun } = await import("./hermes");
  stub(() => Response.json({ accepted: true }));
  assert.deepEqual(await steerHermesRun(agent, "run/a", "  Check tests  "), { ok: true, status: 200 });
  assert.equal(calls[0].url, "https://hermes.example/v1/runs/run%2Fa/steer");
  assert.deepEqual(calls[0].body, { input: "Check tests" });
  stub(() => new Response("Run finished", { status: 409 }));
  assert.deepEqual(await steerHermesRun(agent, "run/a", "x"), { ok: false, status: 409, error: "Run finished" });
});

test("steering does not route an Oh My Pi run to Hermes", async () => {
  const { steerRun } = await import("./agent-runtime");
  const { UnsupportedRuntimeError } = await import("./types");
  await assert.rejects(steerRun(agent, "omp_7cce91df-3b59-477b-a6fa-9bf782921835", "check"), UnsupportedRuntimeError);
});

test("session chat preserves agent instructions and rollback uses Hermes session", async () => {
  const { sendHermesSessionChat } = await import("./hermes");
  const { rollbackSession } = await import("./agent-runtime");
  stub(() => Response.json({ response: "ok" }));
  await sendHermesSessionChat(agent, "session-1", { prompt: "hello", instructions: "Be concise" });
  assert.equal(calls[0].body?.instructions, "Be concise");
  await rollbackSession(agent, "session-1");
  assert.equal(calls[1].body?.message, "/rollback");
});
