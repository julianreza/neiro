import type { SupabaseClient } from "@supabase/supabase-js";
import { writeDroppingMissing } from "@/lib/missing-column";
import { classifyRun } from "@/lib/run-status";

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
  /** The model that answered (20261030000300_ask_model.sql); null on older rows. */
  model?: string | null;
  /** Token split (20261031000300_token_split.sql); null when not recorded. */
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadTokens?: number | null;
  createdAt: string;
  finishedAt: string | null;
};

export const ASK_TABLE = "ask_questions";

/** Split the "Files read:" line the ask rules request off the answer. */
export function splitAnswerFiles(output: string): { body: string; files: string[] } {
  // An "[OPTIONS: …]" line after it stays with the body (it becomes buttons).
  const match = output.match(/\n\s*\**files read:?\**:?\s*([^\n]+?)\s*(\n\s*\[OPTIONS:[^\]\n]*\]\s*)?$/i);
  if (!match) return { body: output.trim(), files: [] };
  const files = match[1]
    .split(/[,\n]/)
    .map((f) => f.replace(/[`*]/g, "").trim())
    // Agents sometimes write "none" when they read no files.
    .filter((f) => f && !/^(none|no files?|n\/a|-)\.?$/i.test(f))
    .slice(0, 12);
  return { body: `${output.slice(0, match.index)}${match[2] ?? ""}`.trim(), files };
}

/** One finished question and its answer, from the composer's Ask thread. */
export type AskTurn = {
  question: string;
  answer: string;
  /** Shown under an earlier turn in the Ask thread; optional, context only needs the text. */
  runId?: string;
  model?: string | null;
  tokens?: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadTokens?: number | null;
  startedAt?: string;
  finishedAt?: string | null;
};

const CONTEXT_LIMIT = 12000;

/**
 * The Ask thread as a block a mission prompt can carry, so an objective like
 * "do number 1" still knows what "number 1" was. Newest turns win the limit.
 */
export function askContextBrief(turns: AskTurn[]): string {
  const blocks = turns
    .map((t) => ({ q: t.question.trim(), a: splitAnswerFiles(t.answer).body }))
    .filter((t) => t.q || t.a)
    .map((t, i) => `Question ${i + 1}:\n${t.q}\n\nAnswer ${i + 1}:\n${t.a || "(no answer)"}`);
  const kept: string[] = [];
  let size = 0;
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (kept.length && size + blocks[i].length > CONTEXT_LIMIT) break;
    kept.unshift(blocks[i].slice(0, CONTEXT_LIMIT));
    size += blocks[i].length;
  }
  if (!kept.length) return "";
  return [
    "Context: this mission comes from an earlier question in Ask mode.",
    "Read it to understand the objective (for example, which numbered item it means).",
    "",
    kept.join("\n\n---\n\n"),
  ].join("\n");
}

const ASK_STATUSES = new Set<AskStatus>(["running", "completed", "failed", "stopped"]);
/** Hermes run status -> saved status. null = the run is still going. */
export function askStatusFromRun(status: string): Exclude<AskStatus, "running"> | null {
  const outcome = classifyRun(status);
  if (outcome === "success") return "completed";
  if (outcome === "failure") return status.trim().toLowerCase() === "stopped" ? "stopped" : "failed";
  return null;
}

/** The fields to save once a run has finished, or null while it still runs. */
export function askResultUpdate(
  run: {
    status: string;
    output?: string;
    tokens?: number;
    model?: string;
    error?: string;
    input_tokens?: number;
    output_tokens?: number;
    cache_read_tokens?: number;
  },
  now: Date = new Date(),
) {
  const status = askStatusFromRun(run.status);
  if (!status) return null;
  return {
    status,
    answer: run.output ?? "",
    tokens: Number.isFinite(run.tokens) ? Math.max(0, Math.round(run.tokens ?? 0)) : 0,
    // The model Hermes really used; an agent with no model runs on its default.
    ...(run.model ? { model: run.model } : {}),
    // In / out split (20261031000300_token_split.sql), when the run says it.
    ...(run.input_tokens !== undefined ? { input_tokens: run.input_tokens } : {}),
    ...(run.output_tokens !== undefined ? { output_tokens: run.output_tokens } : {}),
    ...(run.cache_read_tokens !== undefined ? { cache_read_tokens: run.cache_read_tokens } : {}),
    error: status === "completed" ? null : (run.error || `The question ended: ${run.status}`),
    finished_at: now.toISOString(),
  };
}

const numOrNull = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v) || 0);

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
    model: typeof row.model === "string" && row.model ? row.model : null,
    inputTokens: numOrNull(row.input_tokens),
    outputTokens: numOrNull(row.output_tokens),
    cacheReadTokens: numOrNull(row.cache_read_tokens),
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

export async function recordAskStart(
  supabase: SupabaseClient,
  row: {
    id: string;
    agentId: string;
    agentName: string;
    question: string;
    workspacePath: string;
    followUpOf?: string;
    /** The chat's Hermes session. A new chat's session is its own run id. */
    sessionId?: string;
    /** The model and runtime the agent answered with, kept even if the agent changes later. */
    model?: string;
    runtime?: string;
    /** Where to send the answer once it is done, e.g. "telegram:<chatId>". */
    replyTo?: string;
  },
) {
  const base = {
    id: row.id,
    agent_id: row.agentId,
    agent_name: row.agentName,
    question: row.question,
    workspace_path: row.workspacePath,
    follow_up_of: row.followUpOf ?? null,
    status: "running",
  };
  const save = (values: Record<string, unknown>) =>
    Promise.resolve(supabase.from(ASK_TABLE).upsert(values)).catch((err: unknown) => ({
      error: { message: String(err) },
    }));
  // Optional columns, each added by a later migration. A missing one is
  // dropped from the row and the save retried, so one absent migration never
  // costs the others (or the question itself).
  const optional: Record<string, unknown> = {
    session_id: row.sessionId ?? row.id, // 20261029000300_ask_session.sql
    model: row.model || null, // 20261030000300_ask_model.sql
    runtime: row.runtime || null, // 20261030000300_ask_model.sql
    reply_to: row.replyTo || null, // 20261031000000_hermes_full_suite.sql
  };
  if (!row.replyTo) delete optional.reply_to;
  const { error } = await writeDroppingMissing(
    { ...base, ...optional },
    Object.keys(optional),
    save,
    "ask-history",
  );
  if (error) console.warn("[ask-history] save question failed:", error.message);
}

/** Saves the answer once the run ends. Only a still-running row is changed. */
export async function recordAskResult(
  supabase: SupabaseClient,
  runId: string,
  run: {
    status: string;
    output?: string;
    tokens?: number;
    model?: string;
    error?: string;
    input_tokens?: number;
    output_tokens?: number;
    cache_read_tokens?: number;
  },
) {
  const update = askResultUpdate(run);
  if (!update) return null;
  // Optional columns from later migrations are dropped if missing, so the
  // answer itself is always saved.
  await bestEffort(
    "save answer",
    writeDroppingMissing(
      update,
      ["model", "input_tokens", "output_tokens", "cache_read_tokens"],
      async (row) => await supabase.from(ASK_TABLE).update(row).eq("id", runId).eq("status", "running"),
      "ask-history",
    ),
  );
  return update;
}

/**
 * Follows `followUpOf` links back to the chat's first question. `parentOf`
 * gives a run's parent, or null at the root. Stops on a loop or after
 * `maxHops`, returning the furthest run reached.
 */
export async function walkToRoot(
  start: string,
  parentOf: (id: string) => Promise<string | null>,
  maxHops = 100,
): Promise<string> {
  const seen = new Set([start]);
  let at = start;
  for (let hop = 0; hop < maxHops; hop++) {
    const parent = await parentOf(at);
    if (!parent || seen.has(parent)) break;
    seen.add(parent);
    at = parent;
  }
  return at;
}

/**
 * The Hermes session of a chat. A run started without a session gets a
 * session named after its own run id, so a chat's session is the id of its
 * first question. Every follow-up must send that id, not the latest run's,
 * or Hermes opens a fresh session and forgets the chat.
 *
 * Reads the stored `session_id` first. Rows saved before that column existed
 * fall back to walking `follow_up_of`.
 */
export async function chatSessionId(supabase: SupabaseClient, runId: string) {
  const { data, error } = await supabase
    .from(ASK_TABLE)
    .select("session_id")
    .eq("id", runId)
    .maybeSingle();
  if (!error && typeof data?.session_id === "string" && data.session_id) return data.session_id;

  return walkToRoot(runId, async (id) => {
    const { data, error } = await supabase
      .from(ASK_TABLE)
      .select("follow_up_of")
      .eq("id", id)
      .maybeSingle();
    if (error || !data) return null;
    return typeof data.follow_up_of === "string" ? data.follow_up_of : null;
  });
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
