import "server-only";
import { NextRequest } from "next/server";
import { POST as createMission } from "@/app/api/missions/route";
import { buildFixBrief } from "@/lib/code-review";
import { advanceCodeReviews, pickReviewer } from "@/lib/code-review-runner";
import { createCodeReviewStore } from "@/lib/code-reviews-store";
import { fetchPrHead, postReviewComments } from "@/lib/github-pr";
import { createSupabaseStore } from "@/lib/orchestrator-store";
import { findLocalCheckout } from "@/lib/project-repos";
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
    startFix: async (review, findings) => {
      const checkout = await findLocalCheckout(review.repo);
      if (!checkout) {
        return {
          ok: false,
          status: 409,
          error: `No saved project is a checkout of ${review.repo}. Add its folder on the Projects page first.`,
        };
      }
      // The mission starts from the PR's latest commit, on its own neiro/ branch.
      const base = await fetchPrHead(checkout, review.headRef ?? "");
      const title = `Fix review of ${review.repo.split("/")[1] ?? review.repo}#${review.prNumber}`;
      // Reuse the normal mission route: same checks, worktree and project link.
      const res = await createMission(
        new NextRequest("http://neiro.local/api/missions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            prompt: buildFixBrief(review, findings),
            mode: "fix",
            workspace_path: checkout,
            base_branch: base,
            isolate_workspace: true,
          }),
        }),
      );
      const data = (await res.json().catch(() => ({}))) as { mission?: { id?: string }; error?: string };
      if (!res.ok || !data.mission?.id) {
        return { ok: false, status: res.status >= 400 ? res.status : 500, error: data.error ?? "Could not create the fix mission." };
      }
      return { ok: true, missionId: data.mission.id };
    },
  };
}
