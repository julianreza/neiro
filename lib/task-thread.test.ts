import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTaskThread, stripVerdict, usageMatcher } from "./task-thread";
import type { ThreadTask } from "./task-thread";
import type { MissionArtifact, TaskRunUsage } from "./types";

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

const use = (over: Partial<TaskRunUsage> & { at: string }): TaskRunUsage => ({
  runId: "",
  taskId: "t1",
  stage: "Coding",
  tokens: 0,
  model: null,
  ...over,
});

test("usageMatcher picks the artifact's own run by run id", () => {
  const spent = usageMatcher("t1", [
    use({ runId: "run_a", tokens: 100, model: "m-a", at: "2026-10-31T10:00:00Z" }),
    use({ runId: "run_b", tokens: 200, model: "m-b", at: "2026-10-31T10:05:00Z" }),
  ]);
  const code = { ...art("coding_output", "code:t1:0", "x"), runId: "run_a", runStartedAt: "2026-10-31T09:58:00Z" };
  assert.deepEqual(spent("Coding", code), { startedAt: "2026-10-31T09:58:00Z", model: "m-a", tokens: 100, runId: "run_a" });
});

test("usageMatcher falls back to the last row of that stage before the artifact", () => {
  const spent = usageMatcher("t1", [
    use({ runId: "r0", tokens: 10, model: "m0", at: "2026-10-31T10:00:00Z" }),
    // A failed retry: tokens recorded, no artifact saved.
    use({ runId: "r1", tokens: 20, model: "m1", at: "2026-10-31T10:01:00Z" }),
    use({ runId: "r2", tokens: 30, model: "m2", stage: "QA check", at: "2026-10-31T10:02:00Z" }),
    use({ runId: "r3", tokens: 40, model: "m3", at: "2026-10-31T10:03:00Z" }),
    use({ runId: "other", taskId: "t2", tokens: 99, at: "2026-10-31T10:00:30Z" }),
  ]);
  const at = (key: string, createdAt: string) => ({ ...art("x", key, "x"), createdAt });
  assert.deepEqual(spent("Coding", at("code:t1:0", "2026-10-31T10:01:01Z")), { startedAt: null, model: "m1", tokens: 20, runId: "r1" });
  assert.deepEqual(spent("QA check", at("qa:t1:0", "2026-10-31T10:02:01Z")), { startedAt: null, model: "m2", tokens: 30, runId: "r2" });
  // r1 is taken, so a later coding artifact gets r3, never r1 again.
  assert.deepEqual(spent("Coding", at("code:t1:1", "2026-10-31T10:03:01Z")), { startedAt: null, model: "m3", tokens: 40, runId: "r3" });
  // Nothing left for this stage: no facts, no crash.
  assert.deepEqual(spent("Final review", at("review:t1:1", "2026-10-31T10:04:00Z")), { startedAt: null });
});

test("buildTaskThread puts each run's model, tokens and start on its message", () => {
  const code = { ...art("coding_output", "code:t1:0", "done"), runId: "run_c", runStartedAt: "2026-10-31T09:00:00Z" };
  const qa = { ...art("qa_report", "qa:t1:0", "ok\nVERDICT: PASS"), runId: "run_q" };
  const msgs = buildTaskThread(task({ stage: "Final review", retries: 0 }), [code, qa], [
    use({ runId: "run_c", tokens: 1200, model: "opus", at: "2026-10-31T09:05:00Z" }),
    use({ runId: "run_q", stage: "QA check", tokens: 300, model: "haiku", at: "2026-10-31T09:06:00Z" }),
  ]);
  const coding = msgs.find((m) => m.kind === "coding");
  const check = msgs.find((m) => m.kind === "qa");
  assert.ok(coding && coding.kind === "coding" && check && check.kind === "qa");
  assert.equal(coding.model, "opus");
  assert.equal(coding.tokens, 1200);
  assert.equal(coding.startedAt, "2026-10-31T09:00:00Z");
  assert.equal(check.model, "haiku");
  assert.equal(check.tokens, 300);
});
