/**
 * One task as a chat: the PM's brief, then per attempt the coding output, the
 * QA report and the review report, then what is happening now. Built only
 * from saved artifacts, so it is a pure function shared by tests and the UI.
 *
 * Artifact keys per attempt N (N = task.retries when it ran):
 *   code:<task>:N    coding output  (saved since 2026-10-29)
 *   qa:<task>:N      QA report
 *   review:<task>:N  review report
 * Tasks from before coding outputs were saved only keep the latest output, on
 * the task row (resultOutput).
 */
import { extractGateVerdict } from "@/lib/orchestrator-parsers";
import type { MissionArtifact, TaskRunUsage, TaskStage } from "@/lib/types";

export type ThreadTask = {
  rowId: string;
  title: string;
  stage: TaskStage;
  retries: number;
  depends: string[];
  brief?: string | null;
  resultOutput?: string | null;
};

export type ThreadMessage =
  | { key: string; kind: "brief"; text: string }
  | {
      key: string;
      kind: "coding";
      attempt: number;
      text: string | null;
      /** What this attempt changed in the folder, as a git diff. */
      diff?: string;
      at?: string;
      startedAt?: string | null;
      /** The run that made it, for its saved steps. */
      runId?: string;
      inputTokens?: number | null;
      outputTokens?: number | null;
      cacheReadTokens?: number | null;
      model?: string | null;
      tokens?: number;
    }
  | {
      key: string;
      kind: "qa" | "review";
      attempt: number;
      text: string;
      passed: boolean;
      verdict: string;
      at?: string;
      startedAt?: string | null;
      /** The run that made it, for its saved steps. */
      runId?: string;
      inputTokens?: number | null;
      outputTokens?: number | null;
      cacheReadTokens?: number | null;
      model?: string | null;
      tokens?: number;
    }
  | {
      key: string;
      kind: "failed-run";
      attempt: number;
      /** Which stage's run failed; Coding when not saved. */
      stage?: TaskStage;
      /** Why, from the run (fail:<task>:<attempt>:<stage> artifact). */
      reason?: string;
      at?: string;
    }
  | { key: string; kind: "now"; stage: TaskStage; depends: string[] };

const PAST_CODING = new Set<TaskStage>(["QA check", "Final review", "Done"]);

type RunFacts = {
  startedAt?: string | null;
  model?: string | null;
  tokens?: number;
  runId?: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadTokens?: number | null;
};

/**
 * The run that made a saved output, and what it spent. Artifacts saved since
 * 20261031000100_artifact_run.sql name their run, so that row is exact.
 * Older ones fall back to the last unused row of that task and stage
 * recorded at or just before the artifact (the tick records usage, then
 * saves the output). Failed runs leave rows with no artifact; skipped.
 */
export function usageMatcher(taskId: string, usage: TaskRunUsage[]) {
  const mine = usage
    .filter((u) => u.taskId === taskId)
    .map((u) => ({ ...u, t: Date.parse(u.at) }))
    .sort((a, b) => a.t - b.t);
  const used = new Set<number>();
  const take = (i: number) => {
    used.add(i);
    const u = mine[i];
    return {
      model: u.model,
      tokens: u.tokens,
      ...(u.runId ? { runId: u.runId } : {}),
      ...(u.inputTokens != null ? { inputTokens: u.inputTokens } : {}),
      ...(u.outputTokens != null ? { outputTokens: u.outputTokens } : {}),
      ...(u.cacheReadTokens != null ? { cacheReadTokens: u.cacheReadTokens } : {}),
    };
  };
  return (stage: TaskStage, artifact: MissionArtifact): RunFacts => {
    const startedAt = artifact.runStartedAt ?? null;
    if (artifact.runId) {
      const i = mine.findIndex((u) => u.runId === artifact.runId);
      return i >= 0 ? { startedAt, ...take(i) } : { startedAt, runId: artifact.runId };
    }
    const limit = artifact.createdAt ? Date.parse(artifact.createdAt) + 5_000 : Number.POSITIVE_INFINITY;
    for (let i = mine.length - 1; i >= 0; i--) {
      const u = mine[i];
      if (used.has(i) || u.stage !== stage || !(u.t <= limit)) continue;
      return { startedAt, ...take(i) };
    }
    return { startedAt };
  };
}

export function buildTaskThread(
  task: ThreadTask,
  artifacts: MissionArtifact[],
  usage: TaskRunUsage[] = [],
): ThreadMessage[] {
  const byKey = new Map<string, MissionArtifact>();
  for (const a of artifacts) if (a.dedupeKey) byKey.set(a.dedupeKey, a);
  const at = (key: string) => byKey.get(key);
  const spent = usageMatcher(task.rowId, usage);

  const out: ThreadMessage[] = [
    { key: "brief", kind: "brief", text: (task.brief || task.title).trim() },
  ];

  // The attempt the row's resultOutput belongs to, for tasks saved before
  // every coding output became an artifact.
  let legacyAttempt = -1;
  if (PAST_CODING.has(task.stage)) legacyAttempt = task.retries;
  else {
    for (let a = task.retries; a >= 0; a--) {
      if (at(`qa:${task.rowId}:${a}`) || at(`review:${task.rowId}:${a}`)) {
        legacyAttempt = a;
        break;
      }
    }
  }

  // Escalation to "Needs you" does not bump retries, so its last attempt is retries.
  const ran = PAST_CODING.has(task.stage) || task.stage === "Needs you" ? task.retries : task.retries - 1;
  for (let attempt = 0; attempt <= ran; attempt++) {
    const code = at(`code:${task.rowId}:${attempt}`);
    const qa = at(`qa:${task.rowId}:${attempt}`);
    const review = at(`review:${task.rowId}:${attempt}`);
    const legacy = attempt === legacyAttempt ? (task.resultOutput ?? null) : null;
    const failed = (stageKey: string, stage: TaskStage) => {
      const f = at(`fail:${task.rowId}:${attempt}:${stageKey}`);
      return f ? { stage, reason: f.content, at: f.createdAt } : null;
    };

    if (!code && !qa && !review && !legacy) {
      // Nothing saved: the coding run failed (a retry followed) or never ran.
      const why = failed("code", "Coding");
      if (why || attempt < task.retries) {
        out.push({ key: `fail:${attempt}`, kind: "failed-run", attempt, ...(why ?? { stage: "Coding" }) });
      }
      continue;
    }
    out.push({
      key: `code:${attempt}`,
      kind: "coding",
      attempt,
      text: code?.content ?? legacy,
      at: code?.createdAt,
      ...(at(`diff:${task.rowId}:${attempt}`) ? { diff: at(`diff:${task.rowId}:${attempt}`)!.content } : {}),
      ...(code ? spent("Coding", code) : {}),
    });
    const qaFailed = qa ? null : failed("qa", "QA check");
    if (qaFailed) out.push({ key: `fail-qa:${attempt}`, kind: "failed-run", attempt, ...qaFailed });
    if (qa) {
      const v = extractGateVerdict(qa.content, "PASS", "FAIL").verdict;
      out.push({ key: `qa:${attempt}`, kind: "qa", attempt, text: qa.content, verdict: v, passed: v === "PASS", at: qa.createdAt, ...spent("QA check", qa) });
    }
    if (review) {
      const v = extractGateVerdict(review.content, "APPROVED", "CHANGES_REQUESTED").verdict;
      out.push({
        key: `review:${attempt}`,
        kind: "review",
        attempt,
        text: review.content,
        verdict: v,
        passed: v === "APPROVED",
        at: review.createdAt,
        ...spent("Final review", review),
      });
    }
    const reviewFailed = review ? null : failed("review", "Final review");
    if (reviewFailed) out.push({ key: `fail-review:${attempt}`, kind: "failed-run", attempt, ...reviewFailed });
  }

  if (task.stage !== "Done") {
    out.push({ key: "now", kind: "now", stage: task.stage, depends: task.depends });
  }
  return out;
}

/** Drop a trailing "VERDICT: X" line; the bubble shows the verdict as a tag. */
export function stripVerdict(text: string): string {
  return text.replace(/\n?\s*\**VERDICT:\s*[A-Z_]+\**\s*$/i, "").trim();
}
