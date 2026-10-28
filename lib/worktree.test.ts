import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import {
  discardMissionWorktree,
  missionBranchName,
  prepareMissionWorkspace,
} from "./worktree";

const tmpDirs: string[] = [];
const savedRoot = process.env.NEIRO_WORKTREE_ROOT;

function tmp(prefix: string): string {
  const dir = mkdtempSync(path.join(process.env.KIROCREW_SCRATCH || os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

function makeRepo(): string {
  const repo = tmp("neiro-repo-");
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "t@example.com");
  git(repo, "config", "user.name", "t");
  mkdirSync(path.join(repo, "app"));
  writeFileSync(path.join(repo, "app", "a.txt"), "a\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "init");
  return repo;
}

afterEach(() => {
  process.env.NEIRO_WORKTREE_ROOT = savedRoot;
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

test("plain folder is used as-is", async () => {
  const dir = tmp("neiro-plain-");
  const ws = await prepareMissionWorkspace({
    workspacePath: dir,
    missionId: "mission-1-abc",
    baseBranch: null,
    isolate: true,
  });
  assert.deepEqual(ws, { kind: "plain", path: path.resolve(dir) });
});

test("missing folder is rejected", async () => {
  await assert.rejects(
    prepareMissionWorkspace({
      workspacePath: path.join(os.tmpdir(), "neiro-does-not-exist-xyz"),
      missionId: "mission-1",
      baseBranch: null,
      isolate: true,
    }),
    /not found/,
  );
});

test("git repo gets a worktree on neiro/<mission>, reused and discarded", async () => {
  const repo = makeRepo();
  process.env.NEIRO_WORKTREE_ROOT = tmp("neiro-wt-");

  const input = {
    workspacePath: path.join(repo, "app"),
    missionId: "mission-42-zz",
    baseBranch: "main",
    isolate: true,
  };
  const ws = await prepareMissionWorkspace(input);
  assert.equal(ws.kind, "worktree");
  if (ws.kind !== "worktree") return;
  assert.equal(ws.branch, missionBranchName("mission-42-zz"));
  assert.equal(ws.branch, "neiro/42-zz");
  assert.equal(path.basename(ws.path), "app");
  assert.ok(existsSync(path.join(ws.path, "a.txt")));
  // The user's checkout stays on its own branch.
  assert.equal(git(repo, "rev-parse", "--abbrev-ref", "HEAD"), "main");

  const again = await prepareMissionWorkspace(input);
  assert.deepEqual(again, ws);

  await discardMissionWorktree({ repoRoot: ws.repoRoot, worktreePath: ws.worktreePath, branch: ws.branch });
  assert.ok(!existsSync(ws.worktreePath));
  assert.equal(git(repo, "branch", "--list", ws.branch), "");
});

test("unknown base branch is rejected", async () => {
  const repo = makeRepo();
  process.env.NEIRO_WORKTREE_ROOT = tmp("neiro-wt-");
  await assert.rejects(
    prepareMissionWorkspace({ workspacePath: repo, missionId: "mission-7", baseBranch: "nope", isolate: true }),
    /does not exist/,
  );
});

test("discard refuses branches and paths it did not create", async () => {
  process.env.NEIRO_WORKTREE_ROOT = tmp("neiro-wt-");
  await assert.rejects(
    discardMissionWorktree({ repoRoot: "/", worktreePath: "/x", branch: "main" }),
    /non-mission branch/,
  );
  await assert.rejects(
    discardMissionWorktree({ repoRoot: "/", worktreePath: "/etc", branch: "neiro/x" }),
    /outside/,
  );
});
