import type { Role } from "@/lib/auth";
import { countBySeverity } from "@/lib/code-review";
import type { CodeReviewStore, ReviewFilter } from "@/lib/code-reviews-store";
import { parsePrUrl, postReviewComments, PrError, prSlug, prUrlOf } from "@/lib/github-pr";
import { REVIEW_STATUSES, type CodeReview, type ReviewSeverity, type ReviewStatus } from "@/lib/types";

/**
 * The /api/reviews handlers without Next.js, so they are unit-tested
 * directly (lib/reviews-api.test.ts). The proxy already refuses anonymous
 * calls (401) and viewer writes (403); these check again so a route never
 * depends on the proxy alone.
 */

export type Caller = { sub: string; role: Role } | null;
export type ApiResult = { status: number; body: Record<string, unknown> };

export type ReviewsApiDeps = {
  reviews: CodeReviewStore;
  /** The reviewer a new manual review would use; null = none is turned on. */
  pickReviewer: () => Promise<{ id: string } | null>;
  post: typeof postReviewComments;
  /** Starts the next review step now instead of on the next tick. */
  kick?: () => void;
};

/** Headers the proxy sets (proxy.ts SESSION_HEADERS); clients cannot send them. */
export function callerFrom(headers: Headers): Caller {
  const sub = headers.get("x-neiro-user");
  const role = headers.get("x-neiro-role");
  if (!sub || (role !== "admin" && role !== "viewer")) return null;
  return { sub, role };
}

const UNAUTHORIZED: ApiResult = { status: 401, body: { error: "Sign in first." } };
const FORBIDDEN: ApiResult = { status: 403, body: { error: "Your role can't do this. Ask an admin." } };
const NOT_FOUND: ApiResult = { status: 404, body: { error: "Review not found." } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MISSION_ID = /^[A-Za-z0-9._:-]{1,200}$/;

function guardWrite(caller: Caller): ApiResult | null {
  if (!caller) return UNAUTHORIZED;
  if (caller.role !== "admin") return FORBIDDEN;
  return null;
}

/** A list row: no raw output or finding text, only what the list shows. */
export type ReviewSummary = Omit<CodeReview, "rawOutput" | "findings"> & {
  counts: Record<ReviewSeverity, number>;
  findingCount: number;
};

export function summarize(r: CodeReview): ReviewSummary {
  const { rawOutput: _raw, findings, ...rest } = r;
  void _raw;
  return { ...rest, counts: countBySeverity(findings), findingCount: findings.length };
}

function failure(err: unknown, action: string): ApiResult {
  const message = err instanceof Error ? err.message : String(err);
  return { status: 500, body: { error: `${action}: ${message}` } };
}

export async function listReviewsApi(params: URLSearchParams, caller: Caller, deps: ReviewsApiDeps): Promise<ApiResult> {
  if (!caller) return UNAUTHORIZED;
  const filter: ReviewFilter = {};
  const source = params.get("source");
  if (source === "manual" || source === "mission") filter.source = source;
  const status = params.get("status");
  if (status && REVIEW_STATUSES.includes(status as ReviewStatus)) filter.status = status as ReviewStatus;
  const missionId = params.get("missionId");
  if (missionId) {
    if (!MISSION_ID.test(missionId)) return { status: 400, body: { error: "missionId is not valid." } };
    filter.missionId = missionId;
  }
  const limit = Number(params.get("limit"));
  if (Number.isInteger(limit) && limit > 0) filter.limit = Math.min(limit, 500);
  try {
    const rows = await deps.reviews.listReviews(filter);
    return { status: 200, body: { reviews: rows.map(summarize) } };
  } catch (err) {
    return failure(err, "Could not load reviews");
  }
}

export async function getReviewApi(id: string, caller: Caller, deps: ReviewsApiDeps): Promise<ApiResult> {
  if (!caller) return UNAUTHORIZED;
  if (!UUID.test(id)) return NOT_FOUND;
  try {
    const review = await deps.reviews.getReview(id);
    return review ? { status: 200, body: { review } } : NOT_FOUND;
  } catch (err) {
    return failure(err, "Could not load the review");
  }
}

export async function createReviewApi(body: unknown, caller: Caller, deps: ReviewsApiDeps): Promise<ApiResult> {
  const denied = guardWrite(caller);
  if (denied) return denied;
  const url = body && typeof body === "object" ? (body as Record<string, unknown>).url : undefined;
  const ref = parsePrUrl(url);
  if (!ref) {
    return { status: 400, body: { error: "Paste a GitHub pull request URL, like https://github.com/owner/repo/pull/12." } };
  }
  try {
    if (!(await deps.pickReviewer())) {
      return { status: 409, body: { error: "No reviewer agent is turned on. Turn one on in AI team (/agents) first." } };
    }
    const review = await deps.reviews.createReview({
      repo: prSlug(ref),
      prNumber: ref.number,
      prUrl: prUrlOf(ref),
      source: "manual",
      createdBy: caller!.sub,
    });
    deps.kick?.();
    return { status: 201, body: { review: summarize(review) } };
  } catch (err) {
    return failure(err, "Could not start the review");
  }
}

/** Review again: a new manual row for the same PR; the old one stays. */
export async function rerunReviewApi(id: string, caller: Caller, deps: ReviewsApiDeps): Promise<ApiResult> {
  const denied = guardWrite(caller);
  if (denied) return denied;
  if (!UUID.test(id)) return NOT_FOUND;
  try {
    const old = await deps.reviews.getReview(id);
    if (!old) return NOT_FOUND;
    if (old.status !== "done" && old.status !== "failed") {
      return { status: 409, body: { error: "This review is still running." } };
    }
    if (!(await deps.pickReviewer())) {
      return { status: 409, body: { error: "No reviewer agent is turned on. Turn one on in AI team (/agents) first." } };
    }
    const review = await deps.reviews.createReview({
      repo: old.repo,
      prNumber: old.prNumber,
      prUrl: old.prUrl,
      source: "manual",
      missionId: old.missionId,
      createdBy: caller!.sub,
    });
    deps.kick?.();
    return { status: 201, body: { review: summarize(review) } };
  } catch (err) {
    return failure(err, "Could not start the review again");
  }
}

/** Post to GitHub: the chosen findings become one GitHub review. */
export async function postFindingsApi(id: string, body: unknown, caller: Caller, deps: ReviewsApiDeps): Promise<ApiResult> {
  const denied = guardWrite(caller);
  if (denied) return denied;
  if (!UUID.test(id)) return NOT_FOUND;
  const raw = body && typeof body === "object" ? (body as Record<string, unknown>).findingIds : undefined;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 200 || !raw.every((x) => typeof x === "string")) {
    return { status: 400, body: { error: "Choose at least one finding to post." } };
  }
  const wanted = new Set(raw as string[]);
  try {
    const review = await deps.reviews.getReview(id);
    if (!review) return NOT_FOUND;
    if (review.status !== "done") return { status: 409, body: { error: "Only a finished review can be posted." } };
    const ref = parsePrUrl(review.prUrl);
    if (!ref) return { status: 409, body: { error: "This review has no valid PR URL." } };

    const chosen = review.findings.filter((f) => wanted.has(f.id) && !f.posted && !f.dismissed);
    if (chosen.length === 0) return { status: 400, body: { error: "Those findings are already posted, or do not exist." } };

    const sent = new Set(await deps.post(ref, chosen));
    const findings = review.findings.map((f) => (sent.has(f.id) ? { ...f, posted: true } : f));
    const updated = await deps.reviews.updateReview(id, { findings, postedAt: new Date().toISOString() });
    return { status: 200, body: { review: updated ?? { ...review, findings }, posted: [...sent] } };
  } catch (err) {
    if (err instanceof PrError) return { status: 502, body: { error: err.message } };
    return failure(err, "Could not post to GitHub");
  }
}

/** Dismiss (or bring back) one finding. Body: `{ findingId, dismissed }`. */
export async function dismissFindingApi(id: string, body: unknown, caller: Caller, deps: ReviewsApiDeps): Promise<ApiResult> {
  const denied = guardWrite(caller);
  if (denied) return denied;
  if (!UUID.test(id)) return NOT_FOUND;
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (typeof b.findingId !== "string" || typeof b.dismissed !== "boolean") {
    return { status: 400, body: { error: "Send findingId and dismissed (true or false)." } };
  }
  try {
    const review = await deps.reviews.getReview(id);
    if (!review) return NOT_FOUND;
    const target = review.findings.find((f) => f.id === b.findingId);
    if (!target) return { status: 404, body: { error: "Finding not found." } };
    if (target.posted && b.dismissed) return { status: 409, body: { error: "This finding is already on GitHub." } };
    const findings = review.findings.map((f) => (f.id === b.findingId ? { ...f, dismissed: b.dismissed as boolean } : f));
    const updated = await deps.reviews.updateReview(id, { findings });
    return { status: 200, body: { review: updated ?? { ...review, findings } } };
  } catch (err) {
    return failure(err, "Could not change the finding");
  }
}
