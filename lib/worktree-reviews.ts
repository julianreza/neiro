/** Marks reports written after inspecting a task worktree, rather than a PR. */
export const WORKTREE_REVIEW_PREFIX = "Task worktree review: ";

export function worktreeReviewHref(missionId: string, artifactId: string): string {
  return `/missions/${encodeURIComponent(missionId)}?artifact=${encodeURIComponent(artifactId)}`;
}
