import assert from "node:assert/strict";
import { test } from "node:test";
import { groupByProject, groupThreads } from "./chats";
import type { AskQuestionDTO } from "./ask-history";

function q(id: string, over: Partial<AskQuestionDTO> = {}): AskQuestionDTO {
  return {
    id,
    agentId: "a",
    agentName: "Oracle",
    question: `q ${id}`,
    workspacePath: "",
    projectId: null,
    followUpOf: null,
    status: "completed",
    answer: "",
    error: null,
    tokens: 0,
    createdAt: "2026-10-01T00:00:00Z",
    finishedAt: null,
    ...over,
  };
}

test("follow-ups join the chat of their first question, oldest first", () => {
  const [chat, ...rest] = groupThreads([
    q("c", { followUpOf: "b", createdAt: "2026-10-01T00:03:00Z", status: "running" }),
    q("a", { createdAt: "2026-10-01T00:01:00Z", projectId: "p1" }),
    q("b", { followUpOf: "a", createdAt: "2026-10-01T00:02:00Z" }),
  ]);
  assert.equal(rest.length, 0);
  assert.equal(chat.id, "a");
  assert.equal(chat.title, "q a");
  assert.equal(chat.projectId, "p1");
  assert.deepEqual(chat.messages.map((m) => m.id), ["a", "b", "c"]);
  assert.equal(chat.status, "running");
});

test("a follow-up whose first question is gone starts its own chat", () => {
  const chats = groupThreads([q("x", { followUpOf: "missing" })]);
  assert.deepEqual(chats.map((c) => c.id), ["x"]);
});

test("chats with no project come first, then project groups", () => {
  const chats = groupThreads([
    q("loose", { createdAt: "2026-10-03T00:00:00Z" }),
    q("p1a", { projectId: "p1", createdAt: "2026-10-02T00:00:00Z" }),
    q("p2a", { projectId: "p2", createdAt: "2026-10-01T00:00:00Z" }),
  ]);
  assert.deepEqual(
    groupByProject(chats).map((g) => [g.projectId, g.threads.map((t) => t.id)]),
    [[null, ["loose"]], ["p1", ["p1a"]], ["p2", ["p2a"]]],
  );
});
