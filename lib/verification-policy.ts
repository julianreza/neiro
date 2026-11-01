import type { PreflightCheck } from "@/lib/mission-preflight";

/** Only explicitly confirmed, known-unavailable verification stages are skipped. */
export function verificationPolicy(checks: PreflightCheck[], confirmed: boolean): { ok: false } | { ok: true; skipQa: boolean; skipReview: boolean } {
  const skipQa = checks.some((check) => check.id === "qa" && check.status === "warning");
  const skipReview = checks.some((check) => check.id === "reviewer" && check.status === "warning");
  if ((skipQa || skipReview) && !confirmed) return { ok: false };
  return { ok: true, skipQa, skipReview };
}
