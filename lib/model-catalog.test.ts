import { test } from "node:test";
import assert from "node:assert/strict";
import { modelSource } from "./model-catalog";

test("model sources use provider metadata or routed prefixes, never model family", () => {
  assert.equal(modelSource("9router/ag/gemini-high", "9router"), "Antigravity");
  assert.equal(modelSource("chatgpt/gpt-5", "9router"), "ChatGPT");
  assert.equal(modelSource("gpt-5", "Hermes"), "Other");
  assert.equal(modelSource("ag/gemini", "Example"), "Example");
  assert.equal(modelSource("custom/model", "9router"), "custom");
});
