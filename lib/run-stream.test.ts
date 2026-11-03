import { test } from "node:test";
import assert from "node:assert/strict";
import { beginRunStream, consumeRunFrame, emptyRunStream } from "./run-stream";

const frame = (sequence: number | null, event: object) => `${sequence === null ? "" : `id: ${sequence}\n`}data: ${JSON.stringify(event)}`;

test("reconnect retains the draft and ignores replayed sequence IDs", () => {
  let state = emptyRunStream();
  state = consumeRunFrame(state, frame(1, { type: "message.delta", delta: "Hello" })).state;
  state = beginRunStream(state);
  state = consumeRunFrame(state, frame(1, { type: "message.delta", delta: "Hello" })).state;
  state = consumeRunFrame(state, frame(2, { type: "message.delta", delta: " world" })).state;
  assert.equal(state.answer, "Hello world");
  assert.equal(state.lastSeq, 2);
  assert.equal(state.incomplete, false);
});

test("truncated replay and legacy streams identify incomplete drafts", () => {
  let state = consumeRunFrame(emptyRunStream(), frame(2, { type: "message.delta", delta: "Old" })).state;
  state = beginRunStream(state);
  state = consumeRunFrame(state, frame(null, { type: "replay.truncated", oldest_retained_seq: 5 })).state;
  state = consumeRunFrame(state, frame(5, { type: "message.delta", delta: "New" })).state;
  assert.equal(state.answer, "New");
  assert.equal(state.incomplete, true);
  state = beginRunStream(state);
  state = consumeRunFrame(state, frame(null, { type: "message.delta", delta: "Legacy" })).state;
  assert.equal(state.answer, "Legacy");
  assert.equal(state.incomplete, true);
});

test("only terminal run events trigger reconciliation and whitespace is retained", () => {
  let state = emptyRunStream();
  const delta = consumeRunFrame(state, frame(1, { type: "message.delta", delta: "  " }));
  state = delta.state;
  assert.equal(state.answer, "  ");
  assert.equal(consumeRunFrame(state, frame(2, { type: "tool.error", error: "tool failed" })).terminal, false);
  assert.equal(consumeRunFrame(state, frame(2, { type: "run.failed", error: "failed" })).terminal, true);
});
