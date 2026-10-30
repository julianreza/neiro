import "server-only";
import { advanceCodeReviews, pickReviewer } from "@/lib/code-review-runner";
import { createCodeReviewStore } from "@/lib/code-reviews-store";
import { postReviewComments } from "@/lib/github-pr";
import { createSupabaseStore } from "@/lib/orchestrator-store";
import type { ReviewsApiDeps } from "@/lib/reviews-api";

/** Real dependencies for the /api/reviews routes. */
export function reviewsApiDeps(): ReviewsApiDeps {
  return {
    reviews: createCodeReviewStore(),
    pickReviewer: () => pickReviewer(createSupabaseStore()),
    post: postReviewComments,
    // Start reading the PR now; the tick would otherwise wait up to a minute.
    kick: () => {
      void advanceCodeReviews().catch((err: unknown) => {
        console.warn("[reviews] immediate step failed; the next tick retries", err);
      });
    },
  };
}
