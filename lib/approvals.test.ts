import { test } from "node:test";
import assert from "node:assert/strict";
import { approvalQuestion, normalizeApprovals } from "./approvals";

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
