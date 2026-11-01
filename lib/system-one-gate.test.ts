import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateSafeApproval } from "./system-one-gate";

const safe = { risk_level: 0, is_destructive: false, touches_secrets: false };

test("approval requires both a constrained command and confident safety decisions", async () => {
  const decide = async () => ({ values: safe, confidence: { risk_level: .99, is_destructive: .99, touches_secrets: .99 } });
  assert.equal(await evaluateSafeApproval({ tool: "bash", command: "git status" }, decide), true);
  assert.equal(await evaluateSafeApproval({ tool: "bash", command: "git status; rm -rf /" }, decide), false);
  assert.equal(await evaluateSafeApproval({ tool: "bash", command: "cat .env" }, decide), false);
  assert.equal(await evaluateSafeApproval({ tool: "bash", command: "npm test" }, decide), false);
  assert.equal(await evaluateSafeApproval({ tool: "write", command: "git status" }, decide), false);
  assert.equal(await evaluateSafeApproval({ tool: "bash", command: "git status" }, async () => ({ values: safe, confidence: { risk_level: .99, is_destructive: .4, touches_secrets: .99 } })), false);
  assert.equal(await evaluateSafeApproval({ tool: "bash", command: "git status" }, async () => { throw new Error("offline"); }), false);
});

test("prompt guard flags only confident injection or jailbreak answers", async () => {
  const { guardExternalPrompt } = await import("./system-one-gate");
  const run = async () => ({ answers: { prompt_injection: { type: "noul", noul: .91 }, jailbreak: { type: "noul", noul: .2 } } });
  assert.equal(await guardExternalPrompt("external text", run), "flagged");
  assert.equal(await guardExternalPrompt("ordinary", async () => ({ answers: { prompt_injection: { type: "noul", noul: .1 }, jailbreak: { type: "noul", noul: .1 } } })), "clear");
  assert.equal(await guardExternalPrompt("unknown", async () => ({ answers: {} })), "unknown");
  assert.equal(await guardExternalPrompt("offline", async () => { throw new Error("offline"); }), "unknown");
});

test("mission triage validates and bounds model suggestions", async () => {
  const { triageMission } = await import("./system-one-gate");
  const predict = async () => ({ answers: {
    suggested_mode: { type: "choice", choice: "fix" }, difficulty: { type: "score", score: 2.6 },
    recommended_workers: { type: "score", score: 2 }, is_ambiguous: { type: "noul", noul: .9 },
  } });
  assert.deepEqual(await triageMission("Fix broken tests", predict), { suggestedMode: "fix", complexity: 3, recommendedWorkers: 3, ambiguous: true });
  assert.equal(await triageMission("Broken", async () => ({ answers: {} })), null);
});
