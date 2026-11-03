const SUCCESS = new Set(["completed", "succeeded", "success"]);
const FAILURE = new Set(["failed", "error", "cancelled", "canceled", "interrupted", "stopped", "expired", "expired_404"]);

export type RunOutcome = "pending" | "success" | "failure";
export function classifyRun(status: string): RunOutcome {
  const normalized = status.trim().toLowerCase();
  if (SUCCESS.has(normalized)) return "success";
  if (FAILURE.has(normalized)) return "failure";
  return "pending";
}
