/**
 * In-memory code_reviews store for tests. Not imported by app code.
 */
import type { CodeReviewStore, NewReviewRow, ReviewFilter, ReviewPatch } from "../code-reviews-store";
import type { CodeReview, ReviewStatus } from "../types";

const ACTIVE: ReviewStatus[] = ["queued", "fetching", "reviewing"];

export class MemoryReviewStore implements CodeReviewStore {
  rows = new Map<string, CodeReview>();
  private seq = 0;
  /** Clock for created_at / updated_at; tests may replace it. */
  now = () => new Date();

  seed(partial: Partial<CodeReview> = {}): CodeReview {
    const at = this.now().toISOString();
    const row: CodeReview = {
      id: partial.id ?? `review-${++this.seq}`,
      repo: "o/r",
      prNumber: 1,
      prUrl: "https://github.com/o/r/pull/1",
      prTitle: null,
      headRef: null,
      baseRef: null,
      files: [],
      source: "manual",
      missionId: null,
      taskId: null,
      taskAttempt: null,
      agentId: null,
      model: null,
      runtime: null,
      runId: null,
      status: "queued",
      verdict: null,
      summary: null,
      design: null,
      findings: [],
      rawOutput: null,
      error: null,
      tokens: 0,
      postedAt: null,
      createdBy: null,
      createdAt: at,
      updatedAt: at,
      ...partial,
    };
    this.rows.set(row.id, row);
    return row;
  }

  async listReviews(filter: ReviewFilter = {}) {
    return [...this.rows.values()]
      .filter((r) => (!filter.source || r.source === filter.source) && (!filter.status || r.status === filter.status))
      .filter((r) => !filter.missionId || r.missionId === filter.missionId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getReview(id: string) {
    return this.rows.get(id) ?? null;
  }

  async createReview(row: NewReviewRow) {
    return this.seed({ ...row });
  }

  async updateReview(id: string, patch: ReviewPatch) {
    const row = this.rows.get(id);
    if (!row) return null;
    const next = { ...row, ...patch, updatedAt: this.now().toISOString() };
    this.rows.set(id, next);
    return next;
  }

  async claimReview(id: string, from: ReviewStatus, patch: ReviewPatch) {
    const row = this.rows.get(id);
    if (!row || row.status !== from) return false;
    await this.updateReview(id, patch);
    return true;
  }

  async listActiveReviews() {
    return [...this.rows.values()].filter((r) => ACTIVE.includes(r.status));
  }

  async findReviewForTask(taskId: string, attempt: number) {
    return [...this.rows.values()].find((r) => r.taskId === taskId && r.taskAttempt === attempt) ?? null;
  }
}
