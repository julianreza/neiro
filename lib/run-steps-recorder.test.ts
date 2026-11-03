import assert from "node:assert/strict";
import { test } from "node:test";
import { listen } from "./run-steps-recorder";
import type { Agent } from "./types";
import type { LogStep } from "./run-events";

test("background stream stores completed delegations even if step storage fails once", async () => {
  const frame = (v: object) => `data: ${JSON.stringify(v)}\n\n`;
  const content = frame({ type: "subagent.start", delegation_id: "d1", child_session_id: "child" }) + frame({ type: "subagent.complete", delegation_id: "d1", status: "completed", tokens: 12 });
  const bytes = new TextEncoder().encode(content);
  const saved: LogStep[][] = [];
  let stepWrites = 0;
  await listen({ id: "origin-agent" } as Agent, "run-1", {
    openStream: async () => new ReadableStream({ start(controller) { controller.enqueue(bytes.slice(0, 25)); controller.enqueue(bytes.slice(25)); controller.close(); } }),
    saveSteps: async () => { if (++stepWrites === 1) throw new Error("temporary"); },
    saveSubagents: async (_id, steps) => { saved.push(steps); },
    recordActivity: async () => undefined,
    checkpointMs: 10000,
  });
  assert.equal(stepWrites, 2);
  assert.equal(saved.length, 2);
  assert.equal(saved.at(-1)?.[0].subagent?.status, "completed");
  assert.equal(saved.at(-1)?.[0].subagent?.childSessionId, "child");
  assert.equal(saved.at(-1)?.[0].subagent?.sourceAgentId, "origin-agent");
});

test("checkpoint finishes before final save and a failed delegation write is retried", async () => {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let release!: () => void;
  let signalStarted!: () => void;
  const started = new Promise<void>((resolve) => { signalStarted = resolve; });
  const held = new Promise<void>((resolve) => { release = resolve; });
  const seen: string[] = [];
  let writes = 0;
  const recording = listen({} as Agent, "run-2", {
    openStream: async () => new ReadableStream({ start(c) { controller = c; } }),
    saveSteps: async () => undefined,
    saveSubagents: async (_id, steps) => {
      const status = steps[0]?.subagent?.status ?? "none";
      seen.push(status);
      if (++writes === 1) { signalStarted(); await held; throw new Error("temporary"); }
    },
    recordActivity: async () => undefined,
    checkpointMs: 5,
  });
  await Promise.resolve();
  controller.enqueue(encoder.encode('data: {"type":"subagent.start","delegation_id":"d1"}\n\n'));
  await started;
  controller.enqueue(encoder.encode('data: {"type":"subagent.complete","delegation_id":"d1"}\n\n'));
  controller.close();
  release();
  await recording;
  assert.equal(seen[0], "running");
  assert.equal(seen.at(-1), "completed");
});
