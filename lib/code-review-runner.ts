import { buildReviewPrompt, parseReviewOutput } from "@/lib/code-review";
import type { CodeReviewStore, ReviewPatch } from "@/lib/code-reviews-store";
import { fetchPr as realFetchPr, parsePrUrl, PrError, prSlug } from "@/lib/github-pr";
import { classifyRun, pickStageAgent, type HermesClient } from "@/lib/orchestrator";
import type { OrchestratorStore } from "@/lib/orchestrator-store";
import { readRepoRules as realReadRepoRules } from "@/lib/repo-rules";
import type { Agent, CodeReview } from "@/lib/types";

/**
 * Moves manual code reviews (source = 'manual') forward, one step per tick:
 *
 *   queued -> fetching (read the PR with gh, start the reviewer run)
 *          -> reviewing (poll the run) -> done | failed
 *
 * Mission reviews are moved by the orchestrator's Final review stage instead.
 * Runs inside runTick() (lib/tick.ts), next to advanceActiveMissions().
 */

export type ReviewRunnerDeps = {
  reviews: CodeReviewStore;
  store: Pick<OrchestratorStore, "listEnabledAgents" | "listAllEnabledAgents" | "recordTokenUsage">;
  hermes: Pick<HermesClient, "startRun" | "getRun">;
  fetchPr: typeof realFetchPr;
  /** A local checkout of `owner/repo` among the saved projects, or null. */
  findLocalCheckout: (repo: string) => Promise<string | null>;
  readRules: typeof realReadRepoRules;
  /** The admin's edited review rules, or null for the default. */
  loadRules: () => Promise<string | null>;
  now: () => Date;
};

/** A review stuck in `fetching` this long was cut off (crash, restart). */
export const FETCH_STALE_MS = 10 * 60_000;

export const NO_REVIEWER_MESSAGE = "No reviewer agent is turned on. Turn one on in AI team (/agents), then press Review again.";

export const REVIEW_TOKEN_STAGE = "Code review";

async function resolveDeps(deps?: Partial<ReviewRunnerDeps>): Promise<ReviewRunnerDeps> {
  // Loaded lazily: the Supabase stores and the real runtimes are server-only.
  const reviews = deps?.reviews ?? (await import("@/lib/code-reviews-store")).createCodeReviewStore();
  const store = deps?.store ?? (await import("@/lib/orchestrator-store")).createSupabaseStore();
  const hermes = deps?.hermes ?? (await import("@/lib/agent-runtime"));
  return {
    reviews,
    store,
    hermes,
    fetchPr: deps?.fetchPr ?? realFetchPr,
    findLocalCheckout:
      deps?.findLocalCheckout ??
      (deps?.reviews ? async () => null : (await import("@/lib/project-repos")).findLocalCheckout),
    readRules: deps?.readRules ?? realReadRepoRules,
    loadRules:
      deps?.loadRules ??
      (deps?.reviews ? async () => null : (await import("@/lib/review-rules-store")).loadReviewRulesText),
    now: deps?.now ?? (() => new Date()),
  };
}

/** The reviewer for a new manual review: a reviewer-stage agent, fullstack first. */
export async function pickReviewer(store: ReviewRunnerDeps["store"]): Promise<Agent | null> {
  return pickStageAgent("reviewer", undefined, { store: store as OrchestratorStore });
}

export type ReviewTickResult = { advanced: number; errors: string[] };

export async function advanceCodeReviews(deps?: Partial<ReviewRunnerDeps>): Promise<ReviewTickResult> {
  const d = await resolveDeps(deps);
  const active = (await d.reviews.listActiveReviews()).filter((r) => r.source === "manual");
  const errors: string[] = [];
  let advanced = 0;
  for (const review of active) {
    try {
      if (await advanceOne(review, d)) advanced++;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`Code review ${review.repo}#${review.prNumber}: ${message}`);
      // startReview may have moved it to "fetching" before it threw.
      for (const from of new Set([review.status, "fetching" as const])) {
        if (await d.reviews.claimReview(review.id, from, { status: "failed", error: message }).catch(() => false)) break;
      }
    }
  }
  return { advanced, errors };
}

async function advanceOne(review: CodeReview, d: ReviewRunnerDeps): Promise<boolean> {
  switch (review.status) {
    case "queued":
      return startReview(review, d);
    case "fetching": {
      const age = d.now().getTime() - new Date(review.updatedAt).getTime();
      if (!(age > FETCH_STALE_MS)) return false;
      return d.reviews.claimReview(review.id, "fetching", {
        status: "failed",
        error: "The review was cut off while reading the PR. Press Review again.",
      });
    }
    case "reviewing":
      return pollReview(review, d);
    default:
      return false;
  }
}

const fail = (d: ReviewRunnerDeps, review: CodeReview, from: CodeReview["status"], error: string, extra: ReviewPatch = {}) =>
  d.reviews.claimReview(review.id, from, { ...extra, status: "failed", error });

async function startReview(review: CodeReview, d: ReviewRunnerDeps): Promise<boolean> {
  if (!(await d.reviews.claimReview(review.id, "queued", { status: "fetching", error: null }))) return false;

  const ref = parsePrUrl(review.prUrl);
  if (!ref) return fail(d, review, "fetching", `Not a GitHub pull request URL: ${review.prUrl}`);

  const enabled = await d.store.listAllEnabledAgents();
  const chosen = review.agentId ? enabled.find((a) => a.id === review.agentId && a.stage === "reviewer") : undefined;
  const agent = chosen ?? (await pickReviewer(d.store));
  if (!agent) return fail(d, review, "fetching", NO_REVIEWER_MESSAGE);

  let pr;
  try {
    pr = await d.fetchPr(ref);
  } catch (err: unknown) {
    return fail(d, review, "fetching", err instanceof PrError ? err.message : `Reading the PR failed: ${String(err)}`);
  }
  await d.reviews.updateReview(review.id, {
    prTitle: pr.title || null,
    headRef: pr.headRef || null,
    baseRef: pr.baseRef || null,
    files: pr.files,
  });

  // A saved project with this repo gives the reviewer the code around the
  // diff and the repo's own rules. Best effort: the diff alone still works.
  const checkout = await d.findLocalCheckout(prSlug(ref)).catch(() => null);
  const repoRules = checkout ? await d.readRules(checkout).catch(() => null) : null;

  const prompt = buildReviewPrompt({
    repo: prSlug(ref),
    number: ref.number,
    url: pr.url,
    title: pr.title,
    body: pr.body,
    headRef: pr.headRef,
    baseRef: pr.baseRef,
    files: pr.files,
    diff: pr.diff,
    diffTruncated: pr.diffTruncated,
    checkout: checkout ? { path: checkout, onHead: false } : null,
    repoRules,
    rules: await d.loadRules().catch(() => null),
  });

  const started = await d.hermes.startRun(agent, {
    prompt,
    // The checkout (if any) is only read: "deny" refuses every write a CLI
    // agent asks for. Without one it runs in an empty folder.
    cwd: checkout ?? undefined,
    approvals: "deny",
    idempotencyKey: `review-${review.id}`,
  });
  if (started.kind === "deferred") {
    // The runtime is busy; the next tick tries again.
    return d.reviews.claimReview(review.id, "fetching", { status: "queued" });
  }
  return d.reviews.claimReview(review.id, "fetching", {
    status: "reviewing",
    runId: started.runId,
    agentId: agent.id,
    model: agent.model || null,
    runtime: agent.runtime ?? "hermes",
  });
}

async function pollReview(review: CodeReview, d: ReviewRunnerDeps): Promise<boolean> {
  if (!review.runId) return fail(d, review, "reviewing", "The review run was lost. Press Review again.");
  const agents = await d.store.listAllEnabledAgents();
  const agent = agents.find((a) => a.id === review.agentId);
  if (!agent) return fail(d, review, "reviewing", "The reviewer agent was turned off before it finished. Press Review again.");

  const run = await d.hermes.getRun(agent, review.runId);
  const outcome = classifyRun(run.status);
  if (outcome === "pending") return false;

  const tokens = Math.max(0, Math.round(run.tokens ?? 0));
  if (tokens > 0) {
    await d.store.recordTokenUsage({
      runId: review.runId,
      missionId: null,
      taskId: null,
      agentId: agent.id,
      agentName: agent.name,
      stage: REVIEW_TOKEN_STAGE,
      tokens,
      model: agent.model || null,
      runtime: agent.runtime ?? "hermes",
    });
  }

  const output = (run.output ?? "").trim();
  if (outcome === "failure") {
    return fail(d, review, "reviewing", run.error || `The review run ended with status "${run.status}".`, {
      tokens,
      rawOutput: output || null,
    });
  }

  const parsed = parseReviewOutput(output);
  if (!parsed.ok) return fail(d, review, "reviewing", parsed.error, { tokens, rawOutput: output || null });

  return d.reviews.claimReview(review.id, "reviewing", {
    status: "done",
    verdict: parsed.verdict,
    summary: parsed.summary || null,
    design: parsed.design,
    findings: parsed.findings,
    rawOutput: output,
    tokens,
    error: parsed.dropped > 0 ? `${parsed.dropped} finding(s) were not in the expected shape and were left out.` : null,
  });
}
