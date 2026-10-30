import { parseTokenBudget } from "@/lib/budget";
import { MISSION_MODES } from "@/lib/types";
import type { MissionMode } from "@/lib/types";

/**
 * Validation for POST /api/missions. Kept framework-free so it is unit-tested
 * directly (lib/mission-input.test.ts).
 */

export const MISSION_LIMITS = {
  maxParallelWorkers: { min: 1, max: 10, default: 3 },
  maxRetries: { min: 0, max: 5, default: 2 },
  workspacePathMaxChars: 500,
  baseBranchMaxChars: 200,
  titleMaxChars: 200,
} as const;

export type MissionCreateInput = {
  title: string;
  prompt: string;
  pauseAfterPlanning: boolean;
  maxParallelWorkers: number;
  maxRetries: number;
  workspacePath: string | null;
  /** Branch the mission worktree starts from. Null = the repo's current HEAD. */
  baseBranch: string | null;
  /** Work in a git worktree on a new branch instead of in the folder itself. */
  isolateWorkspace: boolean;
  /** Max tokens for all tasks; null = no limit. */
  tokenBudget: number | null;
  /** Composer mode; null when the caller did not say (older clients). */
  mode: MissionMode | null;
};

// Conservative subset of `git check-ref-format`: no spaces, no "..", no "//",
// no leading "-" (it would read as a git option), no trailing "." or "/".
const BRANCH_NAME = /^(?!-)(?!.*\.\.)(?!.*\/\/)(?!.*\.lock$)[A-Za-z0-9._/-]+(?<![./])$/;

export function isValidBranchName(name: string): boolean {
  return name.length <= MISSION_LIMITS.baseBranchMaxChars && BRANCH_NAME.test(name);
}

export type MissionCreateParseResult =
  | { ok: true; value: MissionCreateInput }
  | { ok: false; error: string };

function intInRange(
  value: unknown,
  field: string,
  limits: { min: number; max: number; default: number },
): { ok: true; value: number } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, value: limits.default };
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return { ok: false, error: `${field} must be an integer` };
  }
  if (value < limits.min || value > limits.max) {
    return { ok: false, error: `${field} must be between ${limits.min} and ${limits.max}` };
  }
  return { ok: true, value };
}

export function parseMissionCreateBody(body: unknown): MissionCreateParseResult {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

  if (typeof b.prompt !== "string" || b.prompt.trim().length === 0) {
    return { ok: false, error: "Missing required mission prompt" };
  }
  const prompt = b.prompt.trim();

  if (b.title !== undefined && b.title !== null && typeof b.title !== "string") {
    return { ok: false, error: "title must be a string" };
  }
  const rawTitle = typeof b.title === "string" ? b.title.trim() : "";
  const title = (rawTitle || prompt.slice(0, 48).trim() || "Untitled Mission").slice(
    0,
    MISSION_LIMITS.titleMaxChars,
  );

  if (b.pause_after_planning !== undefined && typeof b.pause_after_planning !== "boolean") {
    return { ok: false, error: "pause_after_planning must be a boolean" };
  }

  const workers = intInRange(
    b.max_parallel_workers,
    "max_parallel_workers",
    MISSION_LIMITS.maxParallelWorkers,
  );
  if (!workers.ok) return workers;

  const retries = intInRange(b.max_retries, "max_retries", MISSION_LIMITS.maxRetries);
  if (!retries.ok) return retries;

  let workspacePath: string | null = null;
  if (b.workspace_path !== undefined && b.workspace_path !== null) {
    if (typeof b.workspace_path !== "string") {
      return { ok: false, error: "workspace_path must be a string" };
    }
    const trimmed = b.workspace_path.trim();
    if (trimmed.length > MISSION_LIMITS.workspacePathMaxChars) {
      return {
        ok: false,
        error: `workspace_path must be at most ${MISSION_LIMITS.workspacePathMaxChars} characters`,
      };
    }
    workspacePath = trimmed || null;
  }

  let baseBranch: string | null = null;
  if (b.base_branch !== undefined && b.base_branch !== null) {
    if (typeof b.base_branch !== "string") {
      return { ok: false, error: "base_branch must be a string" };
    }
    const trimmed = b.base_branch.trim();
    if (trimmed && !isValidBranchName(trimmed)) {
      return { ok: false, error: "base_branch is not a valid git branch name" };
    }
    baseBranch = trimmed || null;
  }

  if (b.isolate_workspace !== undefined && typeof b.isolate_workspace !== "boolean") {
    return { ok: false, error: "isolate_workspace must be a boolean" };
  }

  const budget = parseTokenBudget(b.token_budget, "token_budget");
  if (!budget.ok) return budget;

  let mode: MissionMode | null = null;
  if (b.mode !== undefined && b.mode !== null) {
    if (!MISSION_MODES.includes(b.mode as MissionMode)) {
      return { ok: false, error: `mode must be one of ${MISSION_MODES.join(", ")}` };
    }
    mode = b.mode as MissionMode;
  }

  return {
    ok: true,
    value: {
      title,
      prompt,
      pauseAfterPlanning: b.pause_after_planning === true,
      maxParallelWorkers: workers.value,
      maxRetries: retries.value,
      workspacePath,
      baseBranch,
      isolateWorkspace: b.isolate_workspace !== false,
      tokenBudget: budget.value,
      mode,
    },
  };
}
