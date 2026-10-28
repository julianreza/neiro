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
  const root = path.resolve(worktreeRoot());
  const target = path.resolve(input.worktreePath);
  if (!target.startsWith(root + path.sep)) {
    throw new Error(`Refusing to remove a worktree outside ${root}: ${target}`);
  }
  if (await isDirectory(target)) {
    await git(input.repoRoot, ["worktree", "remove", "--force", target]);
  }
  await git(input.repoRoot, ["worktree", "prune"]);
  await gitOrNull(input.repoRoot, ["branch", "-D", input.branch]);
}
