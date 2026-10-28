import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Where a mission's agents work.
 * - "plain": the folder itself (not a git repo, or isolation turned off).
 * - "worktree": a git worktree on its own branch, so the user's checkout and
 *   branches are never edited and the whole attempt can be thrown away.
 */
export type MissionWorkspace =
  | { kind: "plain"; path: string }
  | {
      kind: "worktree";
      /** Folder the agents work in (worktree root plus the requested sub-folder). */
      path: string;
      /** Root of the git worktree, used to discard it. */
      worktreePath: string;
      branch: string;
      baseRef: string;
      repoRoot: string;
    };

async function git(cwd: string, args: string[]): Promise<string> {
  // execFile, never a shell: paths and branch names are passed as argv.
  const { stdout } = await run("git", ["-C", cwd, ...args], { timeout: 30_000 });
  return stdout.trim();
}

async function gitOrNull(cwd: string, args: string[]): Promise<string | null> {
  try {
    return await git(cwd, args);
  } catch {
    return null;
  }
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/** Short, branch-safe id: "mission-1730000000000-ab12c" -> "1730000000000-ab12c". */
export function missionSlug(missionId: string): string {
  return missionId.replace(/^mission-/, "").replace(/[^A-Za-z0-9-]/g, "-").slice(0, 60);
}

export function missionBranchName(missionId: string): string {
  return `neiro/${missionSlug(missionId)}`;
}

export function worktreeRoot(env: Record<string, string | undefined> = process.env): string {
  const custom = env.NEIRO_WORKTREE_ROOT?.trim();
  return custom ? path.resolve(custom) : path.join(os.homedir(), ".neiro", "worktrees");
}

/**
 * Resolve the folder the mission's agents work in, creating an isolated
 * worktree on branch `neiro/<mission>` when the folder is a git repo.
 * Idempotent: an existing worktree for the mission is reused.
 * Runs on the Neiro server, so the path must exist on that machine (the
 * same machine Hermes runs on for the agents to reach it).
 */
export async function prepareMissionWorkspace(input: {
  workspacePath: string;
  missionId: string;
  baseBranch: string | null;
  isolate: boolean;
}): Promise<MissionWorkspace> {
  const requested = path.resolve(input.workspacePath);
  if (!(await isDirectory(requested))) {
    throw new Error(`Workspace folder not found on the Neiro server: ${requested}`);
  }

  const repoRoot = await gitOrNull(requested, ["rev-parse", "--show-toplevel"]);
  if (!input.isolate || !repoRoot) {
    if (input.baseBranch && !repoRoot) {
      throw new Error(`base_branch was set but ${requested} is not a git repository`);
    }
    return { kind: "plain", path: requested };
  }

  // Keep the sub-folder the user pointed at, relative to the repo root.
  const subdir = path.relative(repoRoot, requested);
  const branch = missionBranchName(input.missionId);
  const worktreePath = path.join(worktreeRoot(), path.basename(repoRoot), missionSlug(input.missionId));

  let baseRef = input.baseBranch;
  if (!baseRef) {
    const current = await git(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
    baseRef = current === "HEAD" ? await git(repoRoot, ["rev-parse", "HEAD"]) : current;
  }

  if (await isDirectory(worktreePath)) {
    const top = await gitOrNull(worktreePath, ["rev-parse", "--show-toplevel"]);
    if (top && path.resolve(top) === path.resolve(worktreePath)) {
      return { kind: "worktree", path: path.join(worktreePath, subdir), worktreePath, branch, baseRef, repoRoot };
    }
    throw new Error(`Worktree folder exists but is not a git worktree: ${worktreePath}`);
  }

  const baseCommit = await gitOrNull(repoRoot, ["rev-parse", "--verify", "--quiet", `${baseRef}^{commit}`]);
  if (!baseCommit) {
    throw new Error(`Base branch "${baseRef}" does not exist in ${repoRoot}`);
  }

  const branchExists = await gitOrNull(repoRoot, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
  const addArgs = branchExists
    ? ["worktree", "add", worktreePath, branch]
    : ["worktree", "add", "-b", branch, worktreePath, baseCommit];
  await git(repoRoot, addArgs);

  return { kind: "worktree", path: path.join(worktreePath, subdir), worktreePath, branch, baseRef, repoRoot };
}

/**
 * List the worktrees git itself has registered for a repo, by absolute path.
 * This is git's own record, so it does not depend on NEIRO_WORKTREE_ROOT — a
 * worktree created under one root is still found after the env var changes.
 */
async function registeredWorktrees(repoRoot: string): Promise<string[]> {
  const out = await git(repoRoot, ["worktree", "list", "--porcelain"]);
  return out
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => path.resolve(line.slice("worktree ".length).trim()));
}

/**
 * Rollback: delete the mission worktree and its branch. The user's own
 * checkout is untouched. Uncommitted and committed work on the mission
 * branch is lost, so callers only allow it once the mission has stopped.
 */
export async function discardMissionWorktree(input: {
  repoRoot: string;
  worktreePath: string;
  branch: string;
}): Promise<void> {
  if (!input.branch.startsWith("neiro/")) {
    throw new Error(`Refusing to delete non-mission branch ${input.branch}`);
  }
  const target = path.resolve(input.worktreePath);
  const repoRoot = path.resolve(input.repoRoot);
  // Containment is checked against git's own registry for this repo, not a
  // volatile NEIRO_WORKTREE_ROOT, so a stale env value cannot block a discard
  // nor let one escape the repo. The main checkout is never a worktree we drop.
  const worktrees = await registeredWorktrees(repoRoot);
  if (path.resolve(target) === repoRoot) {
    throw new Error(`Refusing to remove the main checkout: ${target}`);
  }
  if (!worktrees.includes(target)) {
    throw new Error(
      `Refusing to remove ${target}: not a registered worktree of ${repoRoot}`,
    );
  }
  if (await isDirectory(target)) {
    await git(repoRoot, ["worktree", "remove", "--force", target]);
  }
  await git(repoRoot, ["worktree", "prune"]);
  await gitOrNull(repoRoot, ["branch", "-D", input.branch]);
}

/** A mission row as the control route reads it for a worktree discard. */
export type MissionDiscardRow = {
  status: string | null;
  work_branch: string | null;
  worktree_path: string | null;
  repo_root: string | null;
};

/**
 * Decide whether a mission's worktree may be discarded, without touching the
 * database or git. Pure so the route handler's destructive branch is testable:
 * the route maps `ok:false` straight to `{ status, error }`.
 */
export function planWorktreeDiscard(
  row: MissionDiscardRow,
):
  | { ok: true; repoRoot: string; worktreePath: string; branch: string }
  | { ok: false; status: number; error: string } {
  if (!row.work_branch || !row.worktree_path || !row.repo_root) {
    return { ok: false, status: 409, error: "Mission has no worktree to discard" };
  }
  if (!["cancelled", "completed"].includes(String(row.status))) {
    return { ok: false, status: 409, error: "Cancel the mission before discarding its worktree" };
  }
  return {
    ok: true,
    repoRoot: row.repo_root,
    worktreePath: row.worktree_path,
    branch: row.work_branch,
  };
}
