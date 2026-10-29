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
import type { MissionArtifact, TaskStage } from "@/lib/types";

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
  | { key: string; kind: "coding"; attempt: number; text: string | null; at?: string }
  | {
      key: string;
      kind: "qa" | "review";
      attempt: number;
      text: string;
      passed: boolean;
      verdict: string;
      at?: string;
    }
  | { key: string; kind: "failed-run"; attempt: number }
  | { key: string; kind: "now"; stage: TaskStage; depends: string[] };

const PAST_CODING = new Set<TaskStage>(["QA check", "Final review", "Done"]);

export function buildTaskThread(task: ThreadTask, artifacts: MissionArtifact[]): ThreadMessage[] {
  const byKey = new Map<string, MissionArtifact>();
  for (const a of artifacts) if (a.dedupeKey) byKey.set(a.dedupeKey, a);
  const at = (key: string) => byKey.get(key);

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

    if (!code && !qa && !review && !legacy) {
      // Nothing saved: the coding run failed (a retry followed) or never ran.
      if (attempt < task.retries) {
        out.push({ key: `fail:${attempt}`, kind: "failed-run", attempt });
      }
      continue;
    }
    out.push({
      key: `code:${attempt}`,
      kind: "coding",
      attempt,
      text: code?.content ?? legacy,
      at: code?.createdAt,
    });
    if (qa) {
      const v = extractGateVerdict(qa.content, "PASS", "FAIL").verdict;
      out.push({ key: `qa:${attempt}`, kind: "qa", attempt, text: qa.content, verdict: v, passed: v === "PASS", at: qa.createdAt });
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
      });
    }
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
