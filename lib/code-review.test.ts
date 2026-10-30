import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildReviewPrompt,
  countBySeverity,
  focusFiles,
  parseReviewOutput,
  reviewPassed,
  sortFindings,
} from "./code-review";
import type { ReviewFinding } from "./types";

const finding = (over: Partial<ReviewFinding>): ReviewFinding => ({
  id: "f",
  severity: "minor",
  category: "correctness",
  observation: "",
  evidence: "",
  dismissed: false,
  file: "a.ts",
  line: 1,
  problem: "p",
  consequence: "c",
  suggestion: "s",
  posted: false,
  ...over,
});

test("buildReviewPrompt carries the PR, the rules and the JSON shape", () => {
  const prompt = buildReviewPrompt(
    {
      repo: "o/r",
      number: 3,
      url: "https://github.com/o/r/pull/3",
      title: "Add login",
      body: "",
      headRef: "feat",
      baseRef: "main",
      files: [{ path: "a.ts", additions: 2, deletions: 1 }],
      diff: "diff --git a/a.ts b/a.ts",
      diffTruncated: true,
    },
    ["Mission task: Login form"],
  );
  assert.match(prompt, /Do not change, create or delete any file/);
  assert.match(prompt, /"severity": "blocker" \| "major" \| "minor" \| "nit"/);
  assert.match(prompt, /o\/r#3 https:\/\/github.com\/o\/r\/pull\/3/);
  assert.match(prompt, /feat -> main/);
  assert.match(prompt, /- a.ts \(\+2 -1\)/);
  assert.match(prompt, /\(no description\)/);
  assert.match(prompt, /Diff \(truncated/);
  assert.match(prompt, /Mission task: Login form/);
});

test("parseReviewOutput reads a valid fenced answer", () => {
  const out = [
    "I looked at the change.",
    "```json",
    JSON.stringify({
      verdict: "request_changes",
      summary: "Adds login.",
      findings: [
        { severity: "minor", file: "./b.ts", line: 4, problem: "Name", consequence: "x", suggestion: "y" },
        { severity: "BLOCKER", file: "a.ts", line: "12", problem: "SQL built from input", consequence: "c", suggestion: "s" },
      ],
    }),
    "```",
    "VERDICT: CHANGES_REQUESTED",
  ].join("\n");
  const r = parseReviewOutput(out);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.verdict, "request_changes");
  assert.equal(r.summary, "Adds login.");
  assert.equal(r.dropped, 0);
  assert.deepEqual(
    r.findings.map((f) => [f.severity, f.file, f.line]),
    [
      ["blocker", "a.ts", 12],
      ["minor", "b.ts", 4],
    ],
  );
  assert.ok(r.findings.every((f) => f.posted === false && f.id));
});

test("parseReviewOutput takes the last valid object, even without a fence", () => {
  const first = JSON.stringify({ verdict: "approve", summary: "old", findings: [] });
  const last = JSON.stringify({ verdict: "Approved", summary: "new", findings: [] });
  const r = parseReviewOutput(`Draft: ${first}\nFinal: ${last} done`);
  assert.equal(r.ok && r.summary, "new");
  assert.equal(r.ok && r.verdict, "approve");
});

test("parseReviewOutput drops invalid findings and keeps the rest", () => {
  const r = parseReviewOutput(
    "```json\n" +
      JSON.stringify({
        verdict: "comment",
        summary: "s",
        findings: [
          { severity: "critical", file: "a.ts", problem: "bad severity" },
          { severity: "major", file: "", problem: "no file" },
          { severity: "major", file: "a.ts", problem: "" },
          "not an object",
          { severity: "nit", file: "a.ts", line: -3, problem: "ok" },
        ],
      }) +
      "\n```",
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.dropped, 4);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].line, null);
});

test("parseReviewOutput fails on empty, missing or broken JSON", () => {
  assert.equal(parseReviewOutput("").ok, false);
  assert.equal(parseReviewOutput("Looks good to me. VERDICT: APPROVED").ok, false);
  assert.equal(parseReviewOutput('```json\n{ "verdict": "approve", "findings": [ \n```').ok, false);
  const wrongShape = parseReviewOutput('```json\n{ "verdict": "maybe", "findings": [] }\n```');
  assert.equal(wrongShape.ok, false);
  assert.match(!wrongShape.ok ? wrongShape.error : "", /expected shape/);
});

test("sortFindings orders by severity, file, then line", () => {
  const sorted = sortFindings([
    finding({ id: "1", severity: "nit", file: "a.ts" }),
    finding({ id: "2", severity: "major", file: "b.ts", line: 9 }),
    finding({ id: "3", severity: "major", file: "b.ts", line: 2 }),
    finding({ id: "4", severity: "major", file: "a.ts", line: 50 }),
    finding({ id: "5", severity: "blocker", file: "z.ts", line: null }),
  ]);
  assert.deepEqual(sorted.map((f) => f.id), ["5", "4", "3", "2", "1"]);
});

test("focusFiles puts risky files first and keeps clean ones last", () => {
  const files = [
    { path: "big.ts", additions: 400, deletions: 10 },
    { path: "small.ts", additions: 2, deletions: 0 },
    { path: "risky.ts", additions: 5, deletions: 5 },
  ];
  const out = focusFiles(
    [
      finding({ file: "risky.ts", severity: "blocker" }),
      finding({ file: "small.ts", severity: "minor" }),
      finding({ file: "small.ts", severity: "nit" }),
      finding({ file: "outside.ts", severity: "major" }),
    ],
    files,
  );
  assert.deepEqual(out.map((f) => f.path), ["risky.ts", "outside.ts", "small.ts", "big.ts"]);
  assert.equal(out[2].worst, "minor");
  assert.deepEqual(out[2].counts, { blocker: 0, major: 0, minor: 1, nit: 1 });
  assert.equal(out[3].worst, null);
});

test("reviewPassed fails on blocker, major or request_changes", () => {
  assert.equal(reviewPassed("approve", [finding({ severity: "minor" }), finding({ severity: "nit" })]), true);
  assert.equal(reviewPassed("comment", []), true);
  assert.equal(reviewPassed("approve", [finding({ severity: "major" })]), false);
  assert.equal(reviewPassed("comment", [finding({ severity: "blocker" })]), false);
  assert.equal(reviewPassed("request_changes", []), false);
  assert.deepEqual(countBySeverity([finding({ severity: "major" }), finding({ severity: "major" })]), {
    blocker: 0,
    major: 2,
    minor: 0,
    nit: 0,
  });
});

test("parseReviewOutput reads the design gate and the Sage-style finding fields", () => {
  const r = parseReviewOutput(
    "```json\n" +
      JSON.stringify({
        verdict: "comment",
        summary: "s",
        design: { gate: "concern", problem: "P", why_it_matters: "W", solution_fit: "F" },
        findings: [
          {
            severity: "major",
            category: "Security / auth",
            file: "a.ts",
            line: 2,
            title: "Token in log",
            observation: "The token is printed.",
            evidence: "console.log(token)",
            consequence: "c",
            suggestion: "s",
          },
          { severity: "minor", category: "made-up", file: "b.ts", problem: "x" },
        ],
      }) +
      "\n```",
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.design, { gate: "concern", problem: "P", whyItMatters: "W", solutionFit: "F" });
  const [first, second] = r.findings;
  assert.equal(first.problem, "Token in log");
  assert.equal(first.category, "security");
  assert.equal(first.observation, "The token is printed.");
  assert.equal(first.evidence, "console.log(token)");
  assert.equal(first.dismissed, false);
  assert.equal(second.category, "maintainability");
  assert.equal(parseReviewOutput('```json\n{"verdict":"approve","findings":[]}\n```').ok && true, true);
});

test("dismissed findings leave the counts and the focus files", () => {
  const list = [finding({ severity: "blocker", file: "a.ts", dismissed: true }), finding({ severity: "nit", file: "a.ts" })];
  assert.deepEqual(countBySeverity(list), { blocker: 0, major: 0, minor: 0, nit: 1 });
  assert.equal(focusFiles(list, [])[0].worst, "nit");
});
