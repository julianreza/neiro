import assert from "node:assert/strict";
import { test } from "node:test";
import {
  diffLines,
  formatPrdNotes,
  nextPrdVersion,
  parsePrdNotes,
  prdKey,
  prdNotesKey,
  prdOutline,
  prdRevisions,
  prdVersions,
} from "./prd";
import type { MissionArtifact } from "./types";

const art = (kind: string, dedupeKey: string, content = ""): MissionArtifact => ({
  id: dedupeKey,
  missionId: "m1",
  title: dedupeKey,
  kind,
  content,
  dedupeKey,
});

test("prd versions: v1 has the legacy key, later versions are suffixed, sorted", () => {
  const artifacts = [
    art("prd", prdKey("m1", 3)),
    art("task_plan", "plan:m1"),
    art("prd", prdKey("m1", 1)),
    art("prd", prdKey("m2", 2)),
    art("prd", prdKey("m1", 2)),
  ];
  assert.equal(prdKey("m1", 1), "prd:m1");
  assert.deepEqual(
    prdVersions(artifacts, "m1").map((v) => v.version),
    [1, 2, 3],
  );
});

test("next prd version is one past the last revised version", () => {
  assert.equal(nextPrdVersion([], "m1"), 1);
  assert.equal(nextPrdVersion([art("prd", "prd:m1")], "m1"), 1);
  const revised = [art("prd", "prd:m1"), art("prd_notes", prdNotesKey("m1", 1))];
  assert.equal(nextPrdVersion(revised, "m1"), 2);
  revised.push(art("prd", "prd:m1:v2"), art("prd_notes", prdNotesKey("m1", 2)));
  assert.equal(nextPrdVersion(revised, "m1"), 3);
  assert.equal(nextPrdVersion([art("prd_notes", prdNotesKey("m2", 4))], "m1"), 1);
});

test("revisions pair each version with the notes that revised it", () => {
  const list = prdRevisions(
    [art("prd", "prd:m1"), art("prd_notes", prdNotesKey("m1", 1), "1. more"), art("prd", "prd:m1:v2")],
    "m1",
  );
  assert.equal(list[0].notes?.content, "1. more");
  assert.equal(list[1].notes, null);
});

test("notes: validated, trimmed, quotes collapsed; formatted as a numbered list", () => {
  assert.equal(parsePrdNotes([]).ok, false);
  assert.equal(parsePrdNotes([{ note: "  " }]).ok, false);
  assert.equal(parsePrdNotes("x").ok, false);
  const parsed = parsePrdNotes([
    { quote: " Form shows\n an error ", note: "Say which text" },
    { note: "Add a risk section" },
  ]);
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  assert.equal(parsed.notes[0].quote, "Form shows an error");
  assert.equal(
    formatPrdNotes(parsed.notes),
    '1. On "Form shows an error":\n   Say which text\n2. Add a risk section',
  );
});

test("diff marks removed and added lines and keeps the rest", () => {
  const d = diffLines("# Goal\nA\nB\nC", "# Goal\nA\nB2\nC\nD");
  assert.deepEqual(
    d.map((l) => `${l.type[0]}:${l.text}`),
    ["s:# Goal", "s:A", "d:B", "a:B2", "s:C", "a:D"],
  );
  assert.ok(diffLines("same", "same").every((l) => l.type === "same"));
});

test("outline lists h1-h3 outside code fences", () => {
  const md = "# PRD\n## 1. Goal\ntext\n```\n## not a heading\n```\n### Pass criteria\n#### too deep";
  assert.deepEqual(
    prdOutline(md).map((o) => [o.level, o.text, o.id]),
    [
      [1, "PRD", "prd-prd"],
      [2, "1. Goal", "prd-1-goal"],
      [3, "Pass criteria", "prd-pass-criteria"],
    ],
  );
});
