import assert from "node:assert/strict";
import { test } from "node:test";
import { compactSteps, createStepCollector, readSavedSteps, RUN_ID } from "./run-steps";
import type { LogStep } from "./run-events";

test("the collector reads frames split across chunks", () => {
  const c = createStepCollector();
  const frame = (data: object) => `data: ${JSON.stringify(data)}\n\n`;
  const all =
    frame({ type: "tool.started", tool: "read_file", input: { path: "a.ts" } }) +
    frame({ type: "message.delta", delta: "Hello" });
  // Cut mid-frame: the first half must wait for the rest.
  c.feed(all.slice(0, 20));
  assert.equal(c.steps().length, 0);
  c.feed(all.slice(20));
  c.end();
  assert.ok(c.steps().length >= 1);
});

test("only run terminal events end activity; failed runs also end it", () => {
  const observed: boolean[] = [];
  const collector = createStepCollector((event) => observed.push(event.terminal));
  for (const type of ["tool.completed", "response.output_item.done", "subagent.complete", "run.failed"]) {
    collector.feed(`data: ${JSON.stringify({ type })}\n\n`);
  }
  assert.deepEqual(observed, [false, false, false, true]);
});

test("compactSteps drops answer text and cuts long details", () => {
  const steps: LogStep[] = [
    { kind: "tool", text: "Ran read_file", detail: "x".repeat(5000), at: "2026-10-31T10:00:00Z" },
    { kind: "message", text: "the answer", at: null },
    { kind: "reasoning", text: "think", at: null },
  ];
  const kept = compactSteps(steps);
  assert.deepEqual(
    kept.map((s) => s.kind),
    ["tool", "reasoning"],
  );
  assert.ok((kept[0].detail ?? "").length <= 2001);
});

test("readSavedSteps keeps good rows and drops the rest", () => {
  assert.deepEqual(readSavedSteps([{ kind: "tool", text: "Ran x", at: null }, { nope: 1 }, "bad"]), [
    { kind: "tool", text: "Ran x", at: null },
  ]);
  assert.deepEqual(readSavedSteps(null), []);
});

test("run ids are checked before use", () => {
  assert.ok(RUN_ID.test("run_abc-123"));
  assert.ok(RUN_ID.test("omp_1:2"));
  assert.ok(!RUN_ID.test("a b"));
  assert.ok(!RUN_ID.test("x".repeat(121)));
});
