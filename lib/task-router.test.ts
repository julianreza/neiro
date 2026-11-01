/**
 * Unit tests for the pure parts of the task router. Laya itself is never
 * loaded here: these cover the schema, answer validation, the gate rule and
 * the on/off switch.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ROUTE_CONFIDENCE_THRESHOLD,
  buildDecisionSchema,
  buildRouteText,
  isRouterEnabled,
  parseDecision,
  routeOutcome,
  routerTimeoutMs,
  withTimeout,
} from "./task-router";
import type { Agent } from "./types";

function agent(id: string, stage: Agent["stage"], enabled = true): Agent {
  return {
    id,
    name: `${id} name`,
    role: stage,
    stage,
    specialty: `${id} work`,
    model: "m",
    profile: "default",
    prompt: "",
    url: "",
    key_enc: null,
    enabled,
    activeRun: false,
  };
}

const agents = [agent("backend-worker", "workers"), agent("qa-inspector", "qa")];

test("schema: agent_id enum comes from the given agents; no free confidence field", () => {
  const schema = buildDecisionSchema(agents);
  assert.deepEqual(schema.properties.agent_id.enum, ["backend-worker", "qa-inspector"]);
  assert.equal(schema.properties.urgency.type, "integer");
  assert.equal(schema.properties.urgency.minimum, 0);
  assert.equal(schema.properties.urgency.maximum, 2);
  assert.equal(schema.properties.needs_human.type, "boolean");
  assert.ok(!("confidence" in schema.properties));
  assert.deepEqual([...schema.required].sort(), ["agent_id", "needs_human", "urgency"]);
  assert.match(schema.properties.agent_id.description, /qa-inspector = qa-inspector name/);
});

test("schema: no agents is an error (the engine falls back)", () => {
  assert.throws(() => buildDecisionSchema([]), /No enabled agents/);
});

test("route text carries title, description and planner specialty", () => {
  const text = buildRouteText({ title: "Build API", result: "REST endpoints", agentName: "backend" });
  assert.match(text, /Build API/);
  assert.match(text, /REST endpoints/);
  assert.match(text, /backend/);
});

test("parseDecision: reads values and the agent_id confidence", () => {
  const d = parseDecision(
    {
      values: { agent_id: "qa-inspector", urgency: 2, needs_human: false },
      confidence: { agent_id: 0.83, urgency: 0.4, needs_human: 0.9 },
    },
    agents,
  );
  assert.deepEqual(d, { agentId: "qa-inspector", urgency: 2, needsHuman: false, confidence: 0.83 });
});

test("parseDecision: rejects an unknown agent and an out-of-range urgency", () => {
  assert.throws(
    () =>
      parseDecision(
        { values: { agent_id: "ghost", urgency: 1, needs_human: false }, confidence: { agent_id: 0.9 } },
        agents,
      ),
    /unknown agent/,
  );
  assert.throws(
    () =>
      parseDecision(
        { values: { agent_id: "backend-worker", urgency: 3, needs_human: false }, confidence: { agent_id: 0.9 } },
        agents,
      ),
    /urgency out of range/,
  );
});

test("parseDecision: missing confidence counts as 0", () => {
  const d = parseDecision(
    { values: { agent_id: "backend-worker", urgency: 0, needs_human: false }, confidence: {} },
    agents,
  );
  assert.equal(d.confidence, 0);
});

test("routeOutcome: 0.7 routes straight through; below it or needs_human waits", () => {
  const base = { agentId: "backend-worker", urgency: 1 as const, needsHuman: false };
  assert.equal(routeOutcome({ ...base, confidence: ROUTE_CONFIDENCE_THRESHOLD }).stage, "Routed");

  const low = routeOutcome({ ...base, confidence: 0.54 });
  assert.equal(low.stage, "Awaiting routing");
  assert.equal(low.routingStatus, "awaiting");
  assert.match(low.reason ?? "", /0\.54 di bawah 0\.7/);

  const human = routeOutcome({ ...base, needsHuman: true, confidence: 0.95 });
  assert.equal(human.stage, "Awaiting routing");
  assert.match(human.reason ?? "", /perlu manusia/);
});

test("isRouterEnabled: off switch and missing model path both disable it", () => {
  assert.equal(isRouterEnabled({ NEIRO_LAYA_MODEL_PATH: "/models/laya" }), true);
  assert.equal(isRouterEnabled({ NEIRO_ROUTER: "off", NEIRO_LAYA_MODEL_PATH: "/models/laya" }), false);
  assert.equal(isRouterEnabled({ NEIRO_ROUTER: "OFF", NEIRO_LAYA_MODEL_PATH: "/models/laya" }), false);
  assert.equal(isRouterEnabled({}), false);
});

test("routerTimeoutMs: defaults to 5000 and ignores junk", () => {
  assert.equal(routerTimeoutMs({}), 5000);
  assert.equal(routerTimeoutMs({ NEIRO_ROUTER_TIMEOUT_MS: "250" }), 250);
  assert.equal(routerTimeoutMs({ NEIRO_ROUTER_TIMEOUT_MS: "-1" }), 5000);
});

test("withTimeout: a call that never finishes is rejected", async () => {
  await assert.rejects(withTimeout(new Promise<never>(() => {}), 20), /timed out after 20 ms/);
  assert.equal(await withTimeout(Promise.resolve(7), 20), 7);
});

test("Jev router posts typed questions and projects validated answers", async () => {
  const { createJevRouter } = await import("./task-router");
  const originalFetch = globalThis.fetch;
  const before = { key: process.env.TYPESAFE_API_KEY, base: process.env.TYPESAFE_BASE_URL };
  process.env.TYPESAFE_API_KEY = "test-key";
  process.env.TYPESAFE_BASE_URL = "https://jev.example";
  try {
    globalThis.fetch = (async (input, init) => {
      assert.equal(String(input), "https://jev.example/v1/systemone");
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-key");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, "jev-latest");
      assert.equal(body.questions.agent_id.type, "choice");
      return Response.json({ answers: {
        agent_id: { type: "choice", choice: "backend-worker", confidence: 0.91, probabilities: { "backend-worker": 0.91, "qa-inspector": 0.09 } },
        urgency: { type: "score", score: 1, probabilities: { "0": 0.1, "1": 0.8, "2": 0.1 } },
        needs_human: { type: "noul", noul: 0.1 },
      } });
    }) as typeof fetch;
    const decision = await createJevRouter().decide({ title: "Fix bug", agentName: "", result: "" } as never, agents);
    assert.deepEqual(decision, { agentId: "backend-worker", urgency: 1, needsHuman: false, confidence: 0.91 });
  } finally {
    globalThis.fetch = originalFetch;
    if (before.key === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = before.key;
    if (before.base === undefined) delete process.env.TYPESAFE_BASE_URL; else process.env.TYPESAFE_BASE_URL = before.base;
  }
});

test("Jev tournament handles over 32 agents and requests a human for uncalibrated tournament confidence", async () => {
  const { createJevRouter } = await import("./task-router");
  const beforeKey = process.env.TYPESAFE_API_KEY;
  const beforeFetch = globalThis.fetch;
  process.env.TYPESAFE_API_KEY = "key";
  let requests = 0;
  try {
    globalThis.fetch = (async (_url, init) => {
      requests++;
      const body = JSON.parse(String(init?.body));
      const answers = Object.fromEntries(Object.entries(body.questions as Record<string, { type: string; criteria?: Record<string, unknown> }>).map(([id, q]) => [id, q.type === "choice"
        ? { type: "choice", choice: Object.keys(q.criteria ?? {})[0], confidence: .99 }
        : q.type === "noul" ? { type: "noul", noul: .1 }
          : { type: "score", score: 1 }]));
      return Response.json({ answers });
    }) as typeof fetch;
    const roster = Array.from({ length: 40 }, (_, i) => agent(`agent-${i}`, "workers"));
    const result = await createJevRouter().decide({ title: "Fix", result: null, agentName: "" } as never, roster);
    assert.ok(requests >= 2);
    assert.ok(roster.some((entry) => entry.id === result.agentId));
    assert.equal(result.confidence, 0);
    assert.equal(routeOutcome(result).stage, "Awaiting routing");
  } finally {
    globalThis.fetch = beforeFetch;
    if (beforeKey === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = beforeKey;
  }
});

test("router calibration ignores incomplete outcomes and measures human overrides", async () => {
  const { calibrateRouteOutcomes } = await import("./task-router");
  assert.equal(await calibrateRouteOutcomes([]), null);
  const result = await calibrateRouteOutcomes([
    { laya_agent_id: "a", human_agent_id: null, route_confidence: .9 },
    { laya_agent_id: "b", human_agent_id: "c", route_confidence: .5 },
    { laya_agent_id: null, human_agent_id: null, route_confidence: .8 },
    { laya_agent_id: "c", human_agent_id: null, route_confidence: -1 },
  ]);
  assert.deepEqual(result, { accept: .9, escalate: 0, samples: 2 });
});
