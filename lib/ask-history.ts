import type { SupabaseClient } from "@supabase/supabase-js";

/** One question asked in Ask mode, as History shows it. */
export type AskStatus = "running" | "completed" | "failed" | "stopped";

export type AskQuestionDTO = {
  id: string;
  agentId: string | null;
  agentName: string;
  question: string;
  workspacePath: string;
  /** Project (row in `projects`) the question was about; null before linking. */
  projectId: string | null;
  followUpOf: string | null;
  status: AskStatus;
  answer: string;
  error: string | null;
  tokens: number;
  createdAt: string;
  finishedAt: string | null;
};

export const ASK_TABLE = "ask_questions";

/** Split the "Files read:" line the ask rules request off the answer. */
export function splitAnswerFiles(output: string): { body: string; files: string[] } {
  const match = output.match(/\n\s*\**files read:?\**:?\s*(.+)\s*$/i);
  if (!match) return { body: output.trim(), files: [] };
  const files = match[1]
    .split(/[,\n]/)
    .map((f) => f.replace(/[`*]/g, "").trim())
    // Agents sometimes write "none" when they read no files.
    .filter((f) => f && !/^(none|no files?|n\/a|-)\.?$/i.test(f))
    .slice(0, 12);
  return { body: output.slice(0, match.index).trim(), files };
}

const ASK_STATUSES = new Set<AskStatus>(["running", "completed", "failed", "stopped"]);
const FAILED_RUN = new Set(["failed", "cancelled", "canceled", "expired_404"]);

/** Hermes run status -> saved status. null = the run is still going. */
export function askStatusFromRun(status: string): Exclude<AskStatus, "running" | "stopped"> | null {
  if (status === "completed") return "completed";
  if (FAILED_RUN.has(status)) return "failed";
  return null;
}

/** The fields to save once a run has finished, or null while it still runs. */
export function askResultUpdate(
  run: { status: string; output?: string; tokens?: number; error?: string },
  now: Date = new Date(),
) {
  const status = askStatusFromRun(run.status);
  if (!status) return null;
  return {
    status,
    answer: run.output ?? "",
    tokens: Number.isFinite(run.tokens) ? Math.max(0, Math.round(run.tokens ?? 0)) : 0,
    error: status === "completed" ? null : (run.error || `The question ended: ${run.status}`),
    finished_at: now.toISOString(),
  };
}

export function mapAskRow(row: Record<string, unknown>): AskQuestionDTO {
  const status = String(row.status) as AskStatus;
  return {
    id: String(row.id),
    agentId: typeof row.agent_id === "string" ? row.agent_id : null,
    agentName: typeof row.agent_name === "string" ? row.agent_name : "",
    question: String(row.question ?? ""),
    workspacePath: String(row.workspace_path ?? ""),
    projectId: typeof row.project_id === "string" ? row.project_id : null,
    followUpOf: typeof row.follow_up_of === "string" ? row.follow_up_of : null,
    status: ASK_STATUSES.has(status) ? status : "failed",
    answer: typeof row.answer === "string" ? row.answer : "",
    error: typeof row.error === "string" ? row.error : null,
    tokens: Number(row.tokens) || 0,
    createdAt: String(row.created_at),
    finishedAt: typeof row.finished_at === "string" ? row.finished_at : null,
  };
}

/** True when the error says the ask_questions table was never created. */
export function isMissingAskTable(message: string) {
  return message.includes(ASK_TABLE) && /does not exist|schema cache/i.test(message);
}

export const MISSING_ASK_TABLE =
  "The ask_questions table is missing. Apply supabase/migrations/20261028000400_ask_history.sql.";

/**
 * Saving is best effort: a failed write is logged and never breaks the
 * question itself, so Ask still works before the migration is applied.
 */
async function bestEffort(label: string, write: PromiseLike<{ error: { message: string } | null }>) {
  try {
    const { error } = await write;
    if (error) console.warn(`[ask-history] ${label} failed:`, error.message);
  } catch (err: unknown) {
    console.warn(`[ask-history] ${label} failed:`, err);
  }
}

export function recordAskStart(
  supabase: SupabaseClient,
  row: {
    id: string;
    agentId: string;
    agentName: string;
    question: string;
    workspacePath: string;
    followUpOf?: string;
  },
) {
  return bestEffort(
    "save question",
    supabase.from(ASK_TABLE).upsert({
      id: row.id,
      agent_id: row.agentId,
      agent_name: row.agentName,
      question: row.question,
      workspace_path: row.workspacePath,
      follow_up_of: row.followUpOf ?? null,
      status: "running",
    }),
  );
}

/** Saves the answer once the run ends. Only a still-running row is changed. */
export async function recordAskResult(
  supabase: SupabaseClient,
  runId: string,
  run: { status: string; output?: string; tokens?: number; error?: string },
) {
  const update = askResultUpdate(run);
  if (!update) return null;
  await bestEffort(
    "save answer",
    supabase.from(ASK_TABLE).update(update).eq("id", runId).eq("status", "running"),
  );
  return update;
}

export function recordAskStopped(supabase: SupabaseClient, runId: string) {
  return bestEffort(
    "save stop",
    supabase
      .from(ASK_TABLE)
      .update({ status: "stopped", error: "Stopped.", finished_at: new Date().toISOString() })
      .eq("id", runId)
      .eq("status", "running"),
  );
}
