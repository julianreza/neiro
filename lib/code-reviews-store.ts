import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toDesign, toFinding } from "@/lib/code-review";
import { getSupabaseAdmin } from "@/lib/supabase";
import { asRuntime, REVIEW_STATUSES, REVIEW_VERDICTS } from "@/lib/types";
import type {
  CodeReview,
  ReviewFile,
  ReviewFinding,
  ReviewSource,
  ReviewStatus,
  ReviewVerdict,
} from "@/lib/types";

export const CODE_REVIEWS_TABLE = "code_reviews";

/** Statuses the tick still has to move forward. */
export const ACTIVE_REVIEW_STATUSES: ReviewStatus[] = ["queued", "fetching", "reviewing"];

export type ReviewFilter = {
  source?: ReviewSource;
  status?: ReviewStatus;
  missionId?: string;
  limit?: number;
};

export type NewReviewRow = {
  repo: string;
  prNumber: number;
  prUrl: string;
  source: ReviewSource;
  prTitle?: string | null;
  headRef?: string | null;
  baseRef?: string | null;
  files?: ReviewFile[];
  missionId?: string | null;
  taskId?: string | null;
  taskAttempt?: number | null;
  agentId?: string | null;
  status?: ReviewStatus;
  createdBy?: string | null;
};

export type ReviewPatch = Partial<
  Pick<
    CodeReview,
    | "prTitle"
    | "headRef"
    | "baseRef"
    | "files"
    | "agentId"
    | "model"
    | "runtime"
    | "runId"
    | "status"
    | "verdict"
    | "summary"
    | "design"
    | "findings"
    | "rawOutput"
    | "error"
    | "tokens"
    | "postedAt"
  >
>;

/** Store contract; the tick and the API use it, tests pass a fake. */
export interface CodeReviewStore {
  listReviews(filter?: ReviewFilter): Promise<CodeReview[]>;
  getReview(id: string): Promise<CodeReview | null>;
  createReview(row: NewReviewRow): Promise<CodeReview>;
  updateReview(id: string, patch: ReviewPatch): Promise<CodeReview | null>;
  /**
   * Moves a review from `from` to `patch.status` only if it is still in
   * `from`, so two ticks never both start the same review.
   */
  claimReview(id: string, from: ReviewStatus, patch: ReviewPatch): Promise<boolean>;
  listActiveReviews(): Promise<CodeReview[]>;
  /** The review of one task attempt, if the orchestrator already made it. */
  findReviewForTask(taskId: string, attempt: number): Promise<CodeReview | null>;
}

type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const int = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

function oneOf<T extends string>(values: readonly T[], v: unknown): T | null {
  return values.includes(v as T) ? (v as T) : null;
}

function mapFiles(v: unknown): ReviewFile[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((f) => {
    const r = (f ?? {}) as Row;
    const path = str(r.path);
    if (!path) return [];
    return [{ path, additions: int(r.additions) ?? 0, deletions: int(r.deletions) ?? 0 }];
  });
}

function mapFindings(v: unknown): ReviewFinding[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((f, i) => {
    const finding = toFinding(f, `f${i + 1}`);
    return finding ? [finding] : [];
  });
}

export function mapReviewRow(row: Row): CodeReview {
  return {
    id: String(row.id ?? ""),
    repo: String(row.repo ?? ""),
    prNumber: int(row.pr_number) ?? 0,
    prUrl: String(row.pr_url ?? ""),
    prTitle: str(row.pr_title),
    headRef: str(row.head_ref),
    baseRef: str(row.base_ref),
    files: mapFiles(row.files),
    source: row.source === "mission" ? "mission" : "manual",
    missionId: str(row.mission_id),
    taskId: str(row.task_id),
    taskAttempt: int(row.task_attempt),
    agentId: str(row.agent_id),
    model: str(row.model),
    runtime: row.runtime ? asRuntime(row.runtime) : null,
    runId: str(row.run_id),
    status: oneOf<ReviewStatus>(REVIEW_STATUSES, row.status) ?? "queued",
    verdict: oneOf<ReviewVerdict>(REVIEW_VERDICTS, row.verdict),
    summary: str(row.summary),
    design: toDesign(row.design),
    findings: mapFindings(row.findings),
    rawOutput: str(row.raw_output),
    error: str(row.error),
    tokens: int(row.tokens) ?? 0,
    postedAt: str(row.posted_at),
    createdBy: str(row.created_by),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

const PATCH_COLUMNS: Record<keyof ReviewPatch, string> = {
  prTitle: "pr_title",
  headRef: "head_ref",
  baseRef: "base_ref",
  files: "files",
  agentId: "agent_id",
  model: "model",
  runtime: "runtime",
  runId: "run_id",
  status: "status",
  verdict: "verdict",
  summary: "summary",
  design: "design",
  findings: "findings",
  rawOutput: "raw_output",
  error: "error",
  tokens: "tokens",
  postedAt: "posted_at",
};

export function reviewPatchToRow(patch: ReviewPatch, now = new Date()): Row {
  const row: Row = { updated_at: now.toISOString() };
  for (const [key, column] of Object.entries(PATCH_COLUMNS) as [keyof ReviewPatch, string][]) {
    if (patch[key] !== undefined) row[column] = patch[key];
  }
  return row;
}

function newRowToDb(row: NewReviewRow): Row {
  return {
    repo: row.repo,
    pr_number: row.prNumber,
    pr_url: row.prUrl,
    source: row.source,
    pr_title: row.prTitle ?? null,
    head_ref: row.headRef ?? null,
    base_ref: row.baseRef ?? null,
    files: row.files ?? [],
    mission_id: row.missionId ?? null,
    task_id: row.taskId ?? null,
    task_attempt: row.taskAttempt ?? null,
    agent_id: row.agentId ?? null,
    status: row.status ?? "queued",
    created_by: row.createdBy ?? null,
  };
}

/** Error text that means the code_reviews migration has not been run. */
export const REVIEWS_MIGRATION_HINT =
  "Run supabase/migrations/20261030000400_code_reviews.sql in Supabase first.";

function fail(action: string, message: string): never {
  const hint = /code_reviews/.test(message) ? ` ${REVIEWS_MIGRATION_HINT}` : "";
  throw new Error(`[code-reviews] ${action}: ${message}${hint}`);
}

export function createCodeReviewStore(client?: SupabaseClient): CodeReviewStore {
  const db = () => client ?? getSupabaseAdmin();

  return {
    async listReviews(filter = {}) {
      let query = db()
        .from(CODE_REVIEWS_TABLE)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(Math.min(Math.max(filter.limit ?? 100, 1), 500));
      if (filter.source) query = query.eq("source", filter.source);
      if (filter.status) query = query.eq("status", filter.status);
      if (filter.missionId) query = query.eq("mission_id", filter.missionId);
      const { data, error } = await query;
      if (error) fail("list", error.message);
      return (data ?? []).map((r) => mapReviewRow(r as Row));
    },

    async getReview(id) {
      const { data, error } = await db().from(CODE_REVIEWS_TABLE).select("*").eq("id", id).maybeSingle();
      if (error) fail("get", error.message);
      return data ? mapReviewRow(data as Row) : null;
    },

    async createReview(row) {
      const { data, error } = await db().from(CODE_REVIEWS_TABLE).insert(newRowToDb(row)).select("*").single();
      if (error) fail("create", error.message);
      return mapReviewRow(data as Row);
    },

    async updateReview(id, patch) {
      const { data, error } = await db()
        .from(CODE_REVIEWS_TABLE)
        .update(reviewPatchToRow(patch))
        .eq("id", id)
        .select("*")
        .maybeSingle();
      if (error) fail("update", error.message);
      return data ? mapReviewRow(data as Row) : null;
    },

    async claimReview(id, from, patch) {
      const { data, error } = await db()
        .from(CODE_REVIEWS_TABLE)
        .update(reviewPatchToRow(patch))
        .eq("id", id)
        .eq("status", from)
        .select("id");
      if (error) fail("claim", error.message);
      return (data ?? []).length > 0;
    },

    async listActiveReviews() {
      const { data, error } = await db()
        .from(CODE_REVIEWS_TABLE)
        .select("*")
        .in("status", ACTIVE_REVIEW_STATUSES)
        .order("created_at", { ascending: true });
      if (error) fail("list active", error.message);
      return (data ?? []).map((r) => mapReviewRow(r as Row));
    },

    async findReviewForTask(taskId, attempt) {
      const { data, error } = await db()
        .from(CODE_REVIEWS_TABLE)
        .select("*")
        .eq("task_id", taskId)
        .eq("task_attempt", attempt)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) fail("find for task", error.message);
      return data ? mapReviewRow(data as Row) : null;
    },
  };
}
