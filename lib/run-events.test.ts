import assert from "node:assert/strict";
import { test } from "node:test";
import { appendStep, parseRunEvent } from "./run-events";

test("tool, approval, error and done events become labelled steps", () => {
  assert.equal(parseRunEvent(JSON.stringify({ type: "tool_call", tool: "bun test" }))?.text, "Ran bun test");
  const approval = parseRunEvent(JSON.stringify({ type: "approval.requested", tool: "shell", command: "git push" }));
  assert.equal(approval?.kind, "approval");
  assert.equal(approval?.detail, "git push");
  assert.equal(parseRunEvent(JSON.stringify({ type: "run.failed", error: "boom" }))?.kind, "error");
  assert.equal(parseRunEvent("[DONE]")?.kind, "done");
  assert.equal(parseRunEvent("plain text line")?.text, "plain text line");
  assert.equal(parseRunEvent("   "), null);
});

test("the SSE event name is used when the payload has no type", () => {
  assert.equal(parseRunEvent(JSON.stringify({ message: "x" }), "error")?.kind, "error");
});

test("streamed deltas merge into one line without extra spaces", () => {
  let steps = appendStep([], parseRunEvent(JSON.stringify({ delta: "Hel" }))!);
  steps = appendStep(steps, parseRunEvent(JSON.stringify({ delta: "lo" }))!);
  steps = appendStep(steps, parseRunEvent(JSON.stringify({ type: "tool_call", tool: "read" }))!);
  assert.deepEqual(steps.map((s) => s.text), ["Hello", "Ran read"]);
});

test("the log keeps only the newest steps", () => {
  let steps = [] as ReturnType<typeof appendStep>;
  for (let i = 0; i < 5; i++) steps = appendStep(steps, { kind: "tool", text: `t${i}`, at: null }, 3);
  assert.deepEqual(steps.map((s) => s.text), ["t2", "t3", "t4"]);
});
