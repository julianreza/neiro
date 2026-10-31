import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calloutKind,
  diffFiles,
  pathLine,
  shellRun,
  shortPath,
  splitOptions,
  splitThinking,
  stripCallout,
  testCounts,
  wordCallout,
} from "./reply-text";

test("splitOptions pulls the last OPTIONS line into buttons", () => {
  const { body, options } = splitOptions("Done.\n\n[OPTIONS: Commit it | Show the diff ]\n");
  assert.equal(body, "Done.");
  assert.deepEqual(options, ["Commit it", "Show the diff"]);
  assert.deepEqual(splitOptions("No buttons here."), { body: "No buttons here.", options: [] });
});

test("splitThinking splits a leading think block", () => {
  assert.deepEqual(splitThinking("<think>check a\nthen b</think>\nAnswer"), { thinking: "check a\nthen b", body: "Answer" });
  assert.deepEqual(splitThinking("Answer <think>x</think>"), { thinking: "", body: "Answer <think>x</think>" });
});

test("diffFiles counts each file's added and removed lines", () => {
  const text = [
    "```diff",
    "--- a/app/x.css",
    "+++ b/app/x.css",
    "@@ -1,2 +1,2 @@",
    "-  border: 0;",
    "+  border: 1px;",
    "+  color: red;",
    "--- /dev/null",
    "+++ b/lib/new.ts",
    "@@ -0,0 +1 @@",
    "+export {};",
    "```",
    "",
    "```ts",
    "const notADiff = 1;",
    "```",
  ].join("\n");
  assert.deepEqual(diffFiles(text), [
    { file: "app/x.css", adds: 2, dels: 1 },
    { file: "lib/new.ts", adds: 1, dels: 0 },
  ]);
});

test("testCounts reads pass and fail counts", () => {
  assert.deepEqual(testCounts(" 22 pass\n 0 fail\nRan 22 tests"), { pass: 22, fail: 0 });
  assert.deepEqual(testCounts("Tests: 3 passed, 1 failed"), { pass: 3, fail: 1 });
  assert.equal(testCounts("const x = 1;"), null);
});

test("shellRun reads a $ command, its output and the exit code", () => {
  assert.deepEqual(shellRun("$ bun run lint\n✔ no problems\nexit 0", "sh"), {
    command: "bun run lint",
    output: "✔ no problems",
    exit: 0,
  });
  assert.deepEqual(shellRun("$ tsc\nerror TS2741\n[exit code: 2]", "bash")?.exit, 2);
  assert.equal(shellRun("echo hi", "sh"), null);
  assert.equal(shellRun("$ echo hi", "ts"), null);
});

test("callouts and file paths", () => {
  assert.equal(calloutKind("[!WARNING] Run the migration"), "warning");
  assert.equal(calloutKind("Just a quote"), null);
  assert.equal(stripCallout("[!NOTE] Hello"), "Hello");
  assert.deepEqual(pathLine("lib/x.ts:42"), { path: "lib/x.ts", line: 42 });
  assert.deepEqual(pathLine("lib/x.ts:42:7"), { path: "lib/x.ts", line: 42 });
  assert.deepEqual(pathLine("lib/x.ts"), { path: "lib/x.ts", line: null });
});

test("plain-word callouts, line ranges and short paths", () => {
  assert.deepEqual(wordCallout("Peringatan: jalankan migration"), { kind: "warning", marker: "Peringatan: " });
  assert.equal(wordCallout("Note: x")?.kind, "note");
  assert.equal(wordCallout("Catatan kecil tanpa titik dua"), null);
  assert.deepEqual(pathLine("lib/task-thread.ts:94-106"), { path: "lib/task-thread.ts", line: 94 });
  assert.equal(shortPath("/Users/r/Documents/neiro/lib/task-thread.ts"), "…/neiro/lib/task-thread.ts");
  assert.equal(shortPath("lib/a.ts"), "lib/a.ts");
});
