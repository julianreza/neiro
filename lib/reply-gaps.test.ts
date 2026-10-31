import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { breakdownText, stepBreakdown } from "./step-kinds";
import { buildTaskThread } from "./task-thread";
import { diffWorkspace, snapshotWorkspace } from "./workspace-diff";
import type { LogStep } from "./run-events";
import type { MissionArtifact } from "./types";

const sh = promisify(execFile);

test("a coding attempt's diff covers commits and uncommitted files, and leaves the index alone", async () => {
  const root = process.env.KIROCREW_SCRATCH || path.join(process.cwd(), ".tmp-test");
  await mkdir(root, { recursive: true });
  const dir = await mkdtemp(path.join(root, "wsdiff-"));
  try {
    const git = (...args: string[]) => sh("git", ["-C", dir, ...args]);
    await git("init", "-q");
    await git("config", "user.email", "t@t");
    await git("config", "user.name", "t");
    await writeFile(path.join(dir, "a.ts"), "one\n");
    await git("add", "a.ts");
    await git("commit", "-qm", "init");

    const before = await snapshotWorkspace(dir);
    assert.ok(before);

    // The agent commits one change and leaves a new file uncommitted.
    await writeFile(path.join(dir, "a.ts"), "one\ntwo\n");
    await git("commit", "-qam", "edit");
    await writeFile(path.join(dir, "b.ts"), "new\n");

    const diff = await diffWorkspace(dir, before);
    assert.ok(diff);
    assert.deepEqual(
      diff.files.sort((x, y) => x.file.localeCompare(y.file)),
      [
        { file: "a.ts", adds: 1, dels: 0 },
        { file: "b.ts", adds: 1, dels: 0 },
      ],
    );
    assert.match(diff.patch, /\+two/);
    // The real index was not touched: b.ts is still untracked.
    const { stdout } = await git("status", "--porcelain");
    assert.match(stdout, /^\?\? b\.ts/m);
    assert.equal(await diffWorkspace(dir, await snapshotWorkspace(dir)), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a folder that is not a git repo gives no snapshot", async () => {
  assert.equal(await snapshotWorkspace("/definitely/not/a/repo"), null);
  assert.equal(await snapshotWorkspace(null), null);
});

test("step breakdown counts reads, changes and failed commands", () => {
  const step = (text: string, detail: string, exit?: number): LogStep => ({ kind: "tool", text, detail, at: null, ...(exit !== undefined ? { exit } : {}) });
  const b = stepBreakdown([
    step("Ran read_file", '{"path":"a.ts"}'),
    step("Ran read_file", '{"path":"b.ts"}'),
    step("Ran edit_file", '{"path":"a.ts"}'),
    step("Ran terminal", '{"command":"bun test"}', 1),
    step("Ran terminal", '{"command":"bun run lint"}', 0),
    { kind: "message", text: "hi", at: null },
  ]);
  assert.deepEqual(b, { read: 2, edit: 1, command: 2, search: 0, failed: 1, total: 5 });
  assert.equal(breakdownText(b), "2 read · 1 changed · 2 commands (1 failed)");
});

test("the thread carries each attempt's git diff and why a run failed", () => {
  const art = (dedupeKey: string, content: string): MissionArtifact => ({
    id: dedupeKey,
    missionId: "m1",
    taskId: "t1",
    title: dedupeKey,
    kind: "x",
    content,
    dedupeKey,
  });
  const msgs = buildTaskThread(
    { rowId: "t1", title: "T", stage: "Needs you", retries: 1, depends: [] },
    [
      art("fail:t1:0:code", "Hermes said: model overloaded"),
      art("code:t1:1", "done"),
      art("diff:t1:1", "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@\n+x"),
      art("fail:t1:1:qa", "The agent returned an empty answer."),
    ],
  );
  const fails = msgs.filter((m) => m.kind === "failed-run");
  assert.deepEqual(
    fails.map((m) => m.kind === "failed-run" && [m.attempt, m.stage, m.reason]),
    [
      [0, "Coding", "Hermes said: model overloaded"],
      [1, "QA check", "The agent returned an empty answer."],
    ],
  );
  const coding = msgs.find((m) => m.kind === "coding");
  assert.ok(coding && coding.kind === "coding" && coding.diff?.includes("+x"));
});
