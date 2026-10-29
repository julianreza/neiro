import assert from "node:assert/strict";
import { test } from "node:test";
import {
  askContextBrief,
  askResultUpdate,
  askStatusFromRun,
  isMissingAskTable,
  mapAskRow,
  splitAnswerFiles,
  walkToRoot,
} from "./ask-history";

const parents = (map: Record<string, string>) => async (id: string) => map[id] ?? null;

test("a follow-up of a follow-up still reaches the chat's first run", async () => {
  assert.equal(await walkToRoot("run_c", parents({ run_c: "run_b", run_b: "run_a" })), "run_a");
});

test("the first run is its own chat session", async () => {
  assert.equal(await walkToRoot("run_a", parents({})), "run_a");
});

test("a loop in the links does not hang", async () => {
  assert.equal(await walkToRoot("run_a", parents({ run_a: "run_b", run_b: "run_a" })), "run_b");
});

test("a run still going saves nothing", () => {
  assert.equal(askStatusFromRun("running"), null);
  assert.equal(askResultUpdate({ status: "queued" }), null);
});

test("a finished run saves its answer and tokens", () => {
  const now = new Date("2026-10-28T12:00:00.000Z");
  assert.deepEqual(askResultUpdate({ status: "completed", output: "It is a dashboard.", tokens: 812.4 }, now), {
    status: "completed",
    answer: "It is a dashboard.",
    tokens: 812,
    error: null,
    finished_at: "2026-10-28T12:00:00.000Z",
  });
});

test("a cancelled or expired run is saved as failed with a reason", () => {
  assert.equal(askResultUpdate({ status: "cancelled" })?.status, "failed");
  assert.equal(askResultUpdate({ status: "cancelled" })?.error, "The question ended: cancelled");
  assert.equal(askResultUpdate({ status: "expired_404", error: "gone" })?.error, "gone");
});

test("rows map to the DTO and unknown statuses read as failed", () => {
  const item = mapAskRow({
    id: "run_1",
    agent_id: null,
    question: "What is this?",
    workspace_path: "/tmp/p",
    status: "weird",
    tokens: "5",
    created_at: "2026-10-28T12:00:00+00:00",
  });
  assert.equal(item.status, "failed");
  assert.equal(item.tokens, 5);
  assert.equal(item.answer, "");
  assert.equal(item.agentId, null);
});

test("detects the missing table error", () => {
  assert.equal(isMissingAskTable("Could not find the table 'public.ask_questions' in the schema cache"), true);
  assert.equal(isMissingAskTable("permission denied"), false);
});

test("splits the Files read line off the answer", () => {
  assert.deepEqual(splitAnswerFiles("It is a dashboard.\n\nFiles read: `app/page.tsx`, README.md"), {
    body: "It is a dashboard.",
    files: ["app/page.tsx", "README.md"],
  });
});

test("drops a 'none' Files read line instead of showing it as a file", () => {
  assert.deepEqual(splitAnswerFiles("mantap\n\nFiles read: none"), { body: "mantap", files: [] });
});

test("the mission context carries every Ask turn, without the files line", () => {
  const brief = askContextBrief([
    { question: "What should we do next?", answer: "1. Add login\n2. Add search\n\nFiles read: app/page.tsx" },
    { question: "Which is first?", answer: "Number 1." },
  ]);
  assert.match(brief, /Question 1:\nWhat should we do next\?/);
  assert.match(brief, /1\. Add login/);
  assert.match(brief, /Question 2:\nWhich is first\?/);
  assert.doesNotMatch(brief, /Files read/);
});

test("no Ask turns means no mission context", () => {
  assert.equal(askContextBrief([]), "");
});
