import {
  REVIEW_CATEGORIES,
  REVIEW_SEVERITIES,
  REVIEW_VERDICTS,
  type ReviewCategory,
  type ReviewDesign,
  type ReviewFile,
  type ReviewFinding,
  type ReviewSeverity,
  type ReviewVerdict,
} from "@/lib/types";

/**
 * The reviewer's prompt and the parsing of its answer, shared by manual PR
 * reviews (lib/code-review-runner.ts) and a mission's Final review stage.
 * Framework-free so it is unit-tested directly (lib/code-review.test.ts).
 */

export type ReviewPromptInput = {
  repo: string;
  number: number;
  url: string;
  title: string;
  body: string;
  headRef: string;
  baseRef: string;
  files: ReviewFile[];
  diff: string;
  diffTruncated?: boolean;
};

const MAX_BODY_CHARS = 4000;

/** The JSON shape the reviewer must answer with, shown in the prompt. */
export const REVIEW_JSON_SHAPE = `{
  "verdict": "approve" | "request_changes" | "comment",
  "summary": "two or three sentences: what the change does and whether it is safe to ship",
  "design": {
    "gate": "pass" | "concern",
    "problem": "the problem this change solves, in one or two sentences",
    "why_it_matters": "who or what suffers if it is not solved",
    "solution_fit": "whether this change solves it in proportion, and the weakest part"
  },
  "findings": [
    {
      "severity": "blocker" | "major" | "minor" | "nit",
      "category": "${REVIEW_CATEGORIES.join('" | "')}",
      "file": "path/in/the/repo.ts",
      "line": 42,
      "problem": "the finding's title: what is wrong, in one sentence",
      "observation": "what you saw in the code, in two or three sentences",
      "evidence": "the few lines from the diff that show it, copied exactly",
      "consequence": "cause -> mechanism -> what the user or the system suffers",
      "suggestion": "the concrete fix"
    }
  ]
}`;

/** The rules and answer format, without the PR itself. */
export function reviewInstructions(): string[] {
  return [
    "You are a senior code reviewer. Review this pull request in one careful pass.",
    "",
    "Rules:",
    "- Do not change, create or delete any file. Do not run git commands that write. Only read.",
    "- Look at correctness, security, data loss, error handling, concurrency, performance, accessibility, tests, and whether the change solves the stated problem.",
    "- Every finding must trace its consequence: cause -> mechanism -> user or system impact. Drop any finding you cannot trace.",
    "- Before answering, re-read each finding and delete the ones that are style opinions or that the diff does not support.",
    "- `line` is the line number in the NEW version of the file, or null for a whole-file finding.",
    "- `evidence` quotes the diff exactly; leave it empty rather than invent code.",
    "- `design` judges the change as a whole: is the problem worth solving, and does this solution fit it?",
    "- Severity: blocker = must not merge (bug, security hole, data loss); major = should fix before merge; minor = worth fixing; nit = polish.",
    "- An empty `findings` list is a valid answer when the change is fine.",
    "",
    "Answer with exactly one fenced ```json block in this shape:",
    "```json",
    REVIEW_JSON_SHAPE,
    "```",
  ];
}

export function buildReviewPrompt(pr: ReviewPromptInput, extra: string[] = []): string {
  const body = pr.body.trim()
    ? pr.body.length > MAX_BODY_CHARS
      ? `${pr.body.slice(0, MAX_BODY_CHARS)}\n…`
      : pr.body
    : "(no description)";
  const files = pr.files.length
    ? pr.files.map((f) => `- ${f.path} (+${f.additions} -${f.deletions})`).join("\n")
    : "(file list not available)";
  return [
    ...reviewInstructions(),
    ...(extra.length ? ["", ...extra] : []),
    "",
    `Pull request: ${pr.repo}#${pr.number} ${pr.url}`,
    `Title: ${pr.title || "(no title)"}`,
    `Branch: ${pr.headRef || "?"} -> ${pr.baseRef || "?"}`,
    "",
    "Description:",
    body,
    "",
    "Changed files:",
    files,
    "",
    pr.diffTruncated ? "Diff (truncated, review what is shown and say so in the summary):" : "Diff:",
    "```diff",
    pr.diff,
    "```",
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/* Parsing the answer                                                  */
/* ------------------------------------------------------------------ */

export type ParsedReview =
  | {
      ok: true;
      verdict: ReviewVerdict;
      summary: string;
      design: ReviewDesign | null;
      findings: ReviewFinding[];
      dropped: number;
    }
  | { ok: false; error: string };

/** Every top-level `{...}` candidate: fenced json blocks first, then bare objects. */
function jsonCandidates(text: string): string[] {
  const fenced = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/gi)].map((m) => m[1].trim());
  const bare: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = depth > 0;
    else if (c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}" && depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) bare.push(text.slice(start, i + 1));
    }
  }
  return [...fenced, ...bare];
}

const text = (v: unknown, max = 4000): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

function toLine(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

function toVerdict(v: unknown): ReviewVerdict | null {
  const s = typeof v === "string" ? v.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
  if (REVIEW_VERDICTS.includes(s as ReviewVerdict)) return s as ReviewVerdict;
  if (s === "approved") return "approve";
  if (s === "changes_requested") return "request_changes";
  return null;
}

/**
 * Reads the reviewer's answer: the LAST JSON object that has a valid verdict
 * and a findings array. Invalid findings are dropped and counted.
 */
export function parseReviewOutput(output: string): ParsedReview {
  if (!output.trim()) return { ok: false, error: "The reviewer returned an empty answer." };
  const candidates = jsonCandidates(output);
  if (candidates.length === 0) return { ok: false, error: "The reviewer's answer has no JSON block." };

  for (const raw of candidates.reverse()) {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) continue;
    const obj = data as Record<string, unknown>;
    const verdict = toVerdict(obj.verdict);
    if (!verdict || !Array.isArray(obj.findings)) continue;

    let dropped = 0;
    const findings: ReviewFinding[] = [];
    for (const f of obj.findings) {
      const finding = toFinding(f, `f${findings.length + 1}`);
      if (finding) findings.push({ ...finding, id: `f${findings.length + 1}`, posted: false, dismissed: false });
      else dropped++;
    }
    return {
      ok: true,
      verdict,
      summary: text(obj.summary, 2000),
      design: toDesign(obj.design),
      findings: sortFindings(findings),
      dropped,
    };
  }
  return { ok: false, error: "The reviewer's JSON is not in the expected shape (verdict + findings)." };
}

function toCategory(v: unknown): ReviewCategory {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (REVIEW_CATEGORIES.includes(s as ReviewCategory)) return s as ReviewCategory;
  if (/secur|auth|inject|xss|csrf/.test(s)) return "security";
  if (/a11y|access/.test(s)) return "accessibility";
  if (/perf|speed|slow/.test(s)) return "performance";
  if (/test/.test(s)) return "tests";
  if (/error|exception|fail/.test(s)) return "errors";
  if (/race|concurr|lock/.test(s)) return "concurrency";
  if (/data|migration|schema/.test(s)) return "data";
  if (/design|fit|scope/.test(s)) return "design";
  if (/correct|bug|logic|regress/.test(s)) return "correctness";
  return "maintainability";
}

/**
 * One finding from the reviewer's JSON or from a stored row, or null when it
 * lacks a valid severity, a file or a title. `title` is accepted for `problem`.
 */
export function toFinding(raw: unknown, id: string): ReviewFinding | null {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const severity = typeof r.severity === "string" ? (r.severity.trim().toLowerCase() as ReviewSeverity) : null;
  const file = text(r.file, 500).replace(/^\.?\//, "");
  const problem = text(r.problem, 500) || text(r.title, 500);
  if (!severity || !REVIEW_SEVERITIES.includes(severity) || !file || !problem) return null;
  return {
    id: text(r.id, 40) || id,
    severity,
    category: toCategory(r.category),
    file,
    line: toLine(r.line),
    problem,
    observation: text(r.observation),
    evidence: text(r.evidence, 2000),
    consequence: text(r.consequence),
    suggestion: text(r.suggestion),
    posted: r.posted === true,
    dismissed: r.dismissed === true,
  };
}

/** The design gate, or null when the reviewer gave none. */
export function toDesign(raw: unknown): ReviewDesign | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const design: ReviewDesign = {
    gate: typeof r.gate === "string" && /concern|fail/i.test(r.gate) ? "concern" : "pass",
    problem: text(r.problem, 2000),
    whyItMatters: text(r.why_it_matters ?? r.whyItMatters, 2000),
    solutionFit: text(r.solution_fit ?? r.solutionFit, 2000),
  };
  return design.problem || design.whyItMatters || design.solutionFit ? design : null;
}

/* ------------------------------------------------------------------ */
/* Ordering and the pass rule                                          */
/* ------------------------------------------------------------------ */

const RANK: Record<ReviewSeverity, number> = { blocker: 0, major: 1, minor: 2, nit: 3 };

/** blocker > major > minor > nit, then file, then line (file-level first). */
export function sortFindings(findings: ReviewFinding[]): ReviewFinding[] {
  return [...findings].sort(
    (a, b) =>
      RANK[a.severity] - RANK[b.severity] ||
      a.file.localeCompare(b.file) ||
      (a.line ?? 0) - (b.line ?? 0),
  );
}

export type FocusFile = ReviewFile & {
  /** Worst severity found in the file; null when it has no findings. */
  worst: ReviewSeverity | null;
  counts: Record<ReviewSeverity, number>;
};

const emptyCounts = (): Record<ReviewSeverity, number> => ({ blocker: 0, major: 0, minor: 0, nit: 0 });

export function countBySeverity(findings: ReviewFinding[]): Record<ReviewSeverity, number> {
  const counts = emptyCounts();
  for (const f of findings) if (!f.dismissed) counts[f.severity]++;
  return counts;
}

/**
 * Files in reading order, like a Focus Report: worst finding first, then the
 * number of findings, then the size of the change. Files that only appear in
 * findings (not in the PR file list) are kept too.
 */
export function focusFiles(findings: ReviewFinding[], files: ReviewFile[]): FocusFile[] {
  const byPath = new Map<string, FocusFile>();
  for (const f of files) byPath.set(f.path, { ...f, worst: null, counts: emptyCounts() });
  for (const f of findings) {
    if (f.dismissed) continue;
    const entry = byPath.get(f.file) ?? { path: f.file, additions: 0, deletions: 0, worst: null, counts: emptyCounts() };
    entry.counts[f.severity]++;
    if (entry.worst === null || RANK[f.severity] < RANK[entry.worst]) entry.worst = f.severity;
    byPath.set(f.file, entry);
  }
  const total = (e: FocusFile) => e.counts.blocker + e.counts.major + e.counts.minor + e.counts.nit;
  return [...byPath.values()].sort(
    (a, b) =>
      (a.worst === null ? 9 : RANK[a.worst]) - (b.worst === null ? 9 : RANK[b.worst]) ||
      total(b) - total(a) ||
      b.additions + b.deletions - (a.additions + a.deletions) ||
      a.path.localeCompare(b.path),
  );
}

/** A review passes when nothing must be fixed and the reviewer did not ask for changes. */
export function reviewPassed(verdict: ReviewVerdict, findings: ReviewFinding[]): boolean {
  if (verdict === "request_changes") return false;
  return !findings.some((f) => f.severity === "blocker" || f.severity === "major");
}
