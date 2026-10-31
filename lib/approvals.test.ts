import { test } from "node:test";
import assert from "node:assert/strict";
import { approvalQuestion, isSyntheticRequestId, normalizeApprovals, normalizePendingControls } from "./approvals";

test("Oh My Pi pending controls keep the request id, tool and path", () => {
  assert.deepEqual(
    normalizeApprovals([{ kind: "approval", request_id: "a1", tool: "write", title: "Allow tool: write\nPath: src/a.ts\nContent:\nhi" }]),
    [{ requestId: "a1", tool: "write", detail: "src/a.ts" }],
  );
});

test("Hermes-style controls: command field, tool read from the title, clarify skipped", () => {
  assert.deepEqual(
    normalizeApprovals([
      { type: "approval", id: "r9", command: "rm -rf build" },
      { kind: "clarify", id: "c1", message: "Which branch?" },
      { title: "Allow tool: bash\nCommand: ls -la" },
    ]),
    [
      { requestId: "r9", tool: "a tool", detail: "rm -rf build" },
      { requestId: "2", tool: "bash", detail: "ls -la" },
    ],
  );
  assert.deepEqual(normalizeApprovals(undefined), []);
  assert.deepEqual(normalizeApprovals([null, "x"]), []);
});

test("the question names what the tool does", () => {
  assert.equal(approvalQuestion("write"), "May I change this file?");
  assert.equal(approvalQuestion("bash"), "May I run this command?");
  assert.equal(approvalQuestion("browser"), "May I use browser?");
});

test("normalized approvals keep their id when read again", () => {
  const once = normalizeApprovals([{ request_id: "r1", tool: "bash", command: "ls", execution_generation: 3, choices: ["once", "always", "deny", "bogus"] }]);
  assert.deepEqual(once, [{ requestId: "r1", tool: "bash", detail: "ls", executionGeneration: 3, choices: ["once", "always", "deny"] }]);
  assert.deepEqual(normalizeApprovals(once), once);
});

test("pending controls: approvals and clarify, choices default to once/deny", () => {
  assert.deepEqual(
    normalizePendingControls([
      { kind: "approval", prompt_id: "p1", tool: "write", path: "a.ts", execution_generation: 2, choices: ["once", "session", "always", "deny"] },
      { kind: "clarify", request_id: "c1", message: "Which branch?" },
      { title: "Allow tool: bash\nCommand: ls" },
    ]),
    [
      { requestId: "p1", executionGeneration: 2, kind: "approval", tool: "write", command: "a.ts", choices: ["once", "session", "always", "deny"] },
      { requestId: "c1", executionGeneration: null, kind: "clarify", tool: undefined, command: "Which branch?", choices: ["once", "deny"] },
      { requestId: "2", executionGeneration: null, kind: "approval", tool: "bash", command: "ls", choices: ["once", "deny"] },
    ],
  );
});

test("made-up request ids are recognised", () => {
  assert.equal(isSyntheticRequestId("default"), true);
  assert.equal(isSyntheticRequestId("2"), true);
  assert.equal(isSyntheticRequestId(""), true);
  assert.equal(isSyntheticRequestId("apr_9f2"), false);
});
