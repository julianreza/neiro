import { execFile } from "node:child_process";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

/*
 * What one Coding run changed in the mission folder, as a real git diff,
 * whether the agent committed or not. Before the run: snapshot the whole
 * working tree as a git tree object. After: snapshot again and diff the two.
 *
 * Snapshots use a COPY of the index (GIT_INDEX_FILE), so the agent's own
 * index, branch and files are never touched. Folders that are not git
 * repositories give null and the chat just shows no diff.
 */
const run = promisify(execFile);

const MAX_PATCH = 60_000;

async function git(cwd: string, args: string[], env?: Record<string, string>): Promise<string> {
  // execFile, never a shell: the folder is passed as argv.
  const { stdout } = await run("git", ["-C", cwd, ...args], {
    timeout: 30_000,
    maxBuffer: 8 * 1024 * 1024,
    env: env ? { ...process.env, ...env } : process.env,
  });
  return stdout;
}

/** The working tree (tracked + new files, minus ignored) as a tree id; null if not a repo. */
export async function snapshotWorkspace(cwd: string | null | undefined): Promise<string | null> {
  if (!cwd) return null;
  let dir: string | null = null;
  try {
    const index = path.resolve(cwd, (await git(cwd, ["rev-parse", "--git-path", "index"])).trim());
    dir = await mkdtemp(path.join(tmpdir(), "neiro-snap-"));
    const temp = path.join(dir, "index");
    // Copying keeps git's stat cache, so `add -A` only rehashes changed files.
    await copyFile(index, temp).catch(() => undefined);
    const env = { GIT_INDEX_FILE: temp };
    await git(cwd, ["add", "-A", "--", "."], env);
    return (await git(cwd, ["write-tree"], env)).trim() || null;
  } catch {
    return null;
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export type WorkspaceDiff = {
  /** Unified diff with a/ b/ headers, cut at MAX_PATCH. */
  patch: string;
  files: { file: string; adds: number; dels: number }[];
  truncated: boolean;
};

/** What changed between a snapshot and now; null when nothing did or git can't tell. */
export async function diffWorkspace(cwd: string | null | undefined, from: string | null): Promise<WorkspaceDiff | null> {
  if (!cwd || !from) return null;
  const to = await snapshotWorkspace(cwd);
  if (!to || to === from) return null;
  try {
    const numstat = await git(cwd, ["diff", "--no-color", "--numstat", from, to]);
    const files = numstat
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [a, d, ...name] = line.split("\t");
        // Binary files show "-" counts.
        return { file: name.join("\t"), adds: Number(a) || 0, dels: Number(d) || 0 };
      });
    if (files.length === 0) return null;
    const full = await git(cwd, ["diff", "--no-color", "--no-ext-diff", from, to]);
    const truncated = full.length > MAX_PATCH;
    return { patch: truncated ? full.slice(0, MAX_PATCH) : full, files, truncated };
  } catch {
    return null;
  }
}
