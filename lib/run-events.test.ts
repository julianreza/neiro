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

test("an internal response or tool completion does not claim the run finished", () => {
  assert.notEqual(parseRunEvent(JSON.stringify({ type: "response.output_item.done" }))?.kind, "done");
  assert.notEqual(parseRunEvent(JSON.stringify({ type: "tool.completed" }))?.kind, "done");
  assert.equal(parseRunEvent(JSON.stringify({ type: "run.completed" }))?.kind, "done");
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

test("subagent start and complete become one card, not the run ending", () => {
  const start = parseRunEvent(JSON.stringify({ event: "subagent.start", delegation_id: "d1", goal: "Write tests", timestamp: "t0" }))!;
  assert.equal(start.kind, "subagent");
  assert.deepEqual(start.subagent, { delegationId: "d1", status: "running", startedAt: "t0", summary: "Write tests" });
  const done = parseRunEvent(
    JSON.stringify({ event: "subagent.complete", delegation_id: "d1", child_session_id: "c1", status: "completed", summary: "Done", duration_seconds: 12.34, input_tokens: 100, output_tokens: 50 }),
  )!;
  assert.equal(done.kind, "subagent");
  assert.equal(done.subagent?.status, "completed");
  assert.equal(done.subagent?.durationSec, 12.3);
  assert.equal(done.subagent?.tokens, 150);
  let steps = appendStep([], start);
  steps = appendStep(steps, { kind: "tool", text: "Ran read", at: null });
  steps = appendStep(steps, done);
  assert.equal(steps.length, 2);
  assert.equal(steps[0].subagent?.status, "completed");
  assert.equal(steps[0].subagent?.startedAt, "t0");
  const failed = parseRunEvent(JSON.stringify({ type: "subagent.complete", delegation_id: "d2", status: "error" }))!;
  assert.equal(failed.subagent?.status, "failed");
});

test("reasoning deltas merge into one thinking step", () => {
  let steps = appendStep([], parseRunEvent(JSON.stringify({ type: "response.reasoning_summary_text.delta", delta: "Let me " }))!);
  steps = appendStep(steps, parseRunEvent(JSON.stringify({ type: "response.reasoning_summary_text.delta", delta: "check." }))!);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].kind, "reasoning");
  assert.equal(steps[0].text, "Let me check.");
  assert.equal(parseRunEvent(JSON.stringify({ reasoning_content: "hmm" }))?.kind, "reasoning");
  assert.equal(parseRunEvent(JSON.stringify({ item: { type: "reasoning", text: "plan" } }))?.kind, "reasoning");
});

test("commentary shows once: already-streamed interim messages are skipped", () => {
  const c = parseRunEvent(JSON.stringify({ type: "message.interim", text: "Looking at the repo" }));
  assert.equal(c?.kind, "commentary");
  assert.equal(c?.text, "Looking at the repo");
  assert.equal(parseRunEvent(JSON.stringify({ type: "message.interim", text: "x", already_streamed: true })), null);
  assert.equal(parseRunEvent(JSON.stringify({ type: "assistant.commentary", content: "Next I will test" }))?.kind, "commentary");
  assert.equal(parseRunEvent(JSON.stringify({ phase: "commentary", text: "hm" }))?.kind, "commentary");
});

test("a tool's end event adds its exit code and time to its start row", () => {
  let steps = appendStep([], parseRunEvent(JSON.stringify({ type: "tool.started", tool: "terminal", input: { command: "bun test" }, timestamp: "2026-10-31T10:00:00Z" }))!);
  steps = appendStep(steps, parseRunEvent(JSON.stringify({ type: "tool.completed", tool: "terminal", exit_code: 1, timestamp: "2026-10-31T10:00:03Z" }))!);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].exit, 1);
  assert.equal(steps[0].ms, 3000);
  assert.equal(steps[0].ended, true);
});
