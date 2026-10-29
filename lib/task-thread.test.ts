import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTaskThread, stripVerdict } from "./task-thread";
import type { ThreadTask } from "./task-thread";
import type { MissionArtifact } from "./types";

const art = (kind: string, dedupeKey: string, content: string): MissionArtifact => ({
  id: dedupeKey,
  missionId: "m1",
  taskId: "t1",
  title: dedupeKey,
  kind,
  content,
  dedupeKey,
});

const task = (over: Partial<ThreadTask> = {}): ThreadTask => ({
  rowId: "t1",
  title: "Inspect root",
  stage: "Queued",
  retries: 0,
  depends: [],
  brief: "Read README and package.json",
  ...over,
});

const shape = (t: ThreadTask, a: MissionArtifact[]) =>
  buildTaskThread(t, a).map((m) =>
    m.kind === "qa" || m.kind === "review"
      ? `${m.kind}${m.attempt}:${m.verdict}`
      : m.kind === "coding"
        ? `coding${m.attempt}:${m.text ?? "-"}`
        : m.kind === "failed-run"
          ? `failed${m.attempt}`
          : m.kind === "now"
            ? `now:${m.stage}`
            : m.kind,
  );

test("a new task is the brief plus what happens now", () => {
  assert.deepEqual(shape(task({ depends: ["T0"] }), []), ["brief", "now:Queued"]);
  assert.deepEqual(shape(task({ stage: "Coding" }), []), ["brief", "now:Coding"]);
});

test("a retried, finished task shows every attempt in order", () => {
  const a = [
    art("coding_output", "code:t1:0", "first try"),
    art("qa_report", "qa:t1:0", "Missing Cargo.toml\nVERDICT: FAIL"),
    art("coding_output", "code:t1:1", "second try"),
    art("qa_report", "qa:t1:1", "ok\nVERDICT: PASS"),
    art("review_report", "review:t1:1", "fine\nVERDICT: APPROVED"),
  ];
  assert.deepEqual(shape(task({ stage: "Done", retries: 1 }), a), [
    "brief",
    "coding0:first try",
    "qa0:FAIL",
    "coding1:second try",
    "qa1:PASS",
    "review1:APPROVED",
  ]);
});

test("a queued retry shows the rejected attempt, then the wait", () => {
  const a = [art("coding_output", "code:t1:0", "v1"), art("qa_report", "qa:t1:0", "VERDICT: FAIL")];
  assert.deepEqual(shape(task({ stage: "Queued", retries: 1 }), a), ["brief", "coding0:v1", "qa0:FAIL", "now:Queued"]);
});

test("a retry with nothing saved is a failed coding run", () => {
  assert.deepEqual(shape(task({ stage: "Coding", retries: 1 }), []), ["brief", "failed0", "now:Coding"]);
});

test("Needs you after the last QA fail keeps that attempt (retries is not bumped)", () => {
  const a = [
    art("coding_output", "code:t1:0", "a"),
    art("qa_report", "qa:t1:0", "VERDICT: FAIL"),
    art("coding_output", "code:t1:1", "b"),
    art("qa_report", "qa:t1:1", "VERDICT: FAIL"),
  ];
  assert.deepEqual(shape(task({ stage: "Needs you", retries: 1 }), a), [
    "brief",
    "coding0:a",
    "qa0:FAIL",
    "coding1:b",
    "qa1:FAIL",
    "now:Needs you",
  ]);
});

test("legacy tasks: the row's output goes on the latest attempt; older ones say not saved", () => {
  const a = [
    art("qa_report", "qa:t1:0", "VERDICT: FAIL"),
    art("qa_report", "qa:t1:1", "VERDICT: PASS"),
    art("review_report", "review:t1:1", "VERDICT: APPROVED"),
  ];
  assert.deepEqual(shape(task({ stage: "Done", retries: 1, resultOutput: "latest" }), a), [
    "brief",
    "coding0:-",
    "qa0:FAIL",
    "coding1:latest",
    "qa1:PASS",
    "review1:APPROVED",
  ]);
});

test("stripVerdict drops only the trailing verdict line", () => {
  assert.equal(stripVerdict("All good.\nVERDICT: PASS"), "All good.");
  assert.equal(stripVerdict("Broken.\n\n**VERDICT: FAIL**"), "Broken.");
  assert.equal(stripVerdict("No verdict here"), "No verdict here");
});
