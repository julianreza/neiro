import assert from "node:assert/strict";
import { test } from "node:test";
import { WORKTREE_REVIEW_PREFIX, worktreeReviewHref } from "./worktree-reviews";

test("worktree review links open the recorded mission artifact", () => {
  assert.equal(WORKTREE_REVIEW_PREFIX, "Task worktree review: ");
  assert.equal(worktreeReviewHref("mission:1", "a/b"), "/missions/mission%3A1?artifact=a%2Fb");
});
