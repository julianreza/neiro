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
