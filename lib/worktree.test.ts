import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, utimesSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import {
  discardMissionWorktree,
  missionBranchName,
  planWorktreeDiscard,
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

test("discard refuses a non-mission branch", async () => {
  const repo = makeRepo();
  await assert.rejects(
    discardMissionWorktree({ repoRoot: repo, worktreePath: path.join(repo, "x"), branch: "main" }),
    /non-mission branch/,
  );
});

test("discard refuses a path git has not registered as a worktree", async () => {
  const repo = makeRepo();
  await assert.rejects(
    discardMissionWorktree({
      repoRoot: repo,
      worktreePath: path.join(os.tmpdir(), "neiro-not-a-worktree"),
      branch: "neiro/x",
    }),
    /not a registered worktree/,
  );
});

test("discard refuses the main checkout even on a mission-named branch", async () => {
  const repo = makeRepo();
  await assert.rejects(
    discardMissionWorktree({ repoRoot: repo, worktreePath: repo, branch: "neiro/x" }),
    /main checkout/,
  );
});

test("discard works after NEIRO_WORKTREE_ROOT changes under it", async () => {
  const repo = makeRepo();
  // Create the worktree under one root...
  process.env.NEIRO_WORKTREE_ROOT = tmp("neiro-wt-a-");
  const ws = await prepareMissionWorkspace({
    workspacePath: path.join(repo, "app"),
    missionId: "mission-roam-99",
    baseBranch: "main",
    isolate: true,
  });
  assert.equal(ws.kind, "worktree");
  if (ws.kind !== "worktree") return;
  // ...then point the env var somewhere else entirely before discarding.
  process.env.NEIRO_WORKTREE_ROOT = tmp("neiro-wt-b-");
  await discardMissionWorktree({ repoRoot: ws.repoRoot, worktreePath: ws.worktreePath, branch: ws.branch });
  assert.ok(!existsSync(ws.worktreePath));
  assert.equal(git(repo, "branch", "--list", ws.branch), "");
});

test("planWorktreeDiscard: a mission with no worktree is rejected", () => {
  const plan = planWorktreeDiscard({ status: "cancelled", work_branch: null, worktree_path: null, repo_root: null });
  assert.deepEqual(plan, { ok: false, status: 409, error: "Mission has no worktree to discard" });
});

test("planWorktreeDiscard: a still-running mission is rejected", () => {
  const plan = planWorktreeDiscard({
    status: "running",
    work_branch: "neiro/1",
    worktree_path: "/w",
    repo_root: "/r",
  });
  assert.deepEqual(plan, { ok: false, status: 409, error: "Cancel the mission before discarding its worktree" });
});

test("planWorktreeDiscard: a stopped mission with a worktree is allowed", () => {
  for (const status of ["cancelled", "completed"]) {
    const plan = planWorktreeDiscard({
      status,
      work_branch: "neiro/1",
      worktree_path: "/w",
      repo_root: "/r",
    });
    assert.deepEqual(plan, { ok: true, repoRoot: "/r", worktreePath: "/w", branch: "neiro/1" });
  }
});

test("Hermes mission context stays untracked and will not overwrite a repository file", async () => {
  const { writeWorktreeHermesContext } = await import("./worktree");
  const repo = makeRepo();
  process.env.NEIRO_WORKTREE_ROOT = tmp("neiro-wt-");
  const ws = await prepareMissionWorkspace({ workspacePath: repo, missionId: "mission-context", baseBranch: "main", isolate: true });
  assert.equal(ws.kind, "worktree");
  if (ws.kind !== "worktree") return;
  await writeWorktreeHermesContext(ws.worktreePath, "# Mission\nDo the task\n");
  assert.equal(git(ws.worktreePath, "check-ignore", ".hermes.md"), ".hermes.md");
  git(ws.worktreePath, "add", "--all");
  assert.equal(git(ws.worktreePath, "status", "--porcelain"), "");
  await writeWorktreeHermesContext(ws.worktreePath, "# Mission\nUpdated\n");
  assert.equal(git(repo, "status", "--porcelain"), "");
});

test("merge readiness requires a clean registered mission worktree", async () => {
  const { missionWorktreeHead } = await import("./worktree");
  const repo = makeRepo();
  process.env.NEIRO_WORKTREE_ROOT = tmp("neiro-wt-");
  const ws = await prepareMissionWorkspace({ workspacePath: repo, missionId: "mission-merge", baseBranch: "main", isolate: true });
  assert.equal(ws.kind, "worktree");
  if (ws.kind !== "worktree") return;
  const head = await missionWorktreeHead(ws.repoRoot, ws.worktreePath, ws.branch);
  assert.match(head, /^[0-9a-f]{40,64}$/);
  writeFileSync(path.join(ws.worktreePath, "uncommitted.txt"), "keep this");
  await assert.rejects(missionWorktreeHead(ws.repoRoot, ws.worktreePath, ws.branch), /uncommitted/i);
  await assert.rejects(missionWorktreeHead(ws.repoRoot, ws.repoRoot, ws.branch));
});

test("parallel tasks use independent branches and merge without touching the main checkout", async () => {
  const { prepareTaskWorktree, mergeTaskWorktree, writeWorktreeHermesContext } = await import("./worktree");
  const repo = makeRepo();
  process.env.NEIRO_WORKTREE_ROOT = tmp("neiro-wt-");
  const mission = await prepareMissionWorkspace({ workspacePath: repo, missionId: "mission-isolated", baseBranch: "main", isolate: true });
  assert.equal(mission.kind, "worktree");
  if (mission.kind !== "worktree") return;
  await writeWorktreeHermesContext(mission.worktreePath, "Mission context");
  const first = await prepareTaskWorktree(mission, "task-one", "T1");
  const second = await prepareTaskWorktree(mission, "task-two", "T2");
  assert.notEqual(first.worktreePath, second.worktreePath);
  assert.notEqual(first.branch, second.branch);
  assert.ok(existsSync(path.join(first.worktreePath, ".hermes.md")));
  writeFileSync(path.join(first.worktreePath, "one.txt"), "one");
  writeFileSync(path.join(second.worktreePath, "two.txt"), "two");
  assert.equal(await mergeTaskWorktree(mission, first, "First"), "merged");
  assert.equal(await mergeTaskWorktree(mission, second, "Second"), "merged");
  assert.ok(existsSync(path.join(mission.worktreePath, "one.txt")));
  assert.ok(existsSync(path.join(mission.worktreePath, "two.txt")));
  assert.equal(existsSync(path.join(repo, "one.txt")), false);
  assert.equal(git(repo, "rev-parse", "--abbrev-ref", "HEAD"), "main");
});

test("conflicting task merges preserve both task work and clean mission state", async () => {
  const { prepareTaskWorktree, mergeTaskWorktree, TaskMergeConflict } = await import("./worktree");
  const repo = makeRepo();
  process.env.NEIRO_WORKTREE_ROOT = tmp("neiro-wt-");
  const mission = await prepareMissionWorkspace({ workspacePath: repo, missionId: "mission-conflict", baseBranch: "main", isolate: true });
  if (mission.kind !== "worktree") throw new Error("expected worktree");
  const first = await prepareTaskWorktree(mission, "task-one", "T1");
  const second = await prepareTaskWorktree(mission, "task-two", "T2");
  writeFileSync(path.join(first.worktreePath, "app", "a.txt"), "first\n");
  writeFileSync(path.join(second.worktreePath, "app", "a.txt"), "second\n");
  await mergeTaskWorktree(mission, first, "First");
  await assert.rejects(mergeTaskWorktree(mission, second, "Second"), (error: unknown) => error instanceof TaskMergeConflict && error.files.includes("app/a.txt"));
  assert.equal(git(mission.worktreePath, "status", "--porcelain"), "");
  assert.ok(existsSync(path.join(second.worktreePath, "app", "a.txt")));
});

test("a post-merge failure keeps the task worktree for an idempotent retry", async () => {
  const { prepareTaskWorktree, mergeTaskWorktree } = await import("./worktree");
  const repo = makeRepo();
  process.env.NEIRO_WORKTREE_ROOT = tmp("neiro-wt-");
  const mission = await prepareMissionWorkspace({ workspacePath: repo, missionId: "mission-retry", baseBranch: "main", isolate: true });
  if (mission.kind !== "worktree") throw new Error("expected worktree");
  const task = await prepareTaskWorktree(mission, "task-one", "T1");
  writeFileSync(path.join(task.worktreePath, "one.txt"), "one");
  await assert.rejects(mergeTaskWorktree(mission, task, "One", async () => { throw new Error("PR offline"); }), /PR offline/);
  assert.ok(existsSync(task.worktreePath));
  assert.equal(await mergeTaskWorktree(mission, task, "One", async () => {}), "merged");
  assert.equal(existsSync(task.worktreePath), false);
});

test("cleanup recovers a merged task after a crash and never removes new work", async () => {
  const { prepareTaskWorktree, mergeTaskWorktree, cleanupMergedTaskWorktree } = await import("./worktree");
  const repo = makeRepo();
  process.env.NEIRO_WORKTREE_ROOT = tmp("neiro-wt-");
  const mission = await prepareMissionWorkspace({ workspacePath: repo, missionId: "mission-recovery", baseBranch: "main", isolate: true });
  if (mission.kind !== "worktree") throw new Error("expected worktree");
  const task = await prepareTaskWorktree(mission, "task-one", "T1");
  writeFileSync(path.join(task.worktreePath, "one.txt"), "one");
  await assert.rejects(mergeTaskWorktree(mission, task, "One", async () => { throw new Error("process stopped after saving"); }));
  writeFileSync(path.join(task.worktreePath, "new.txt"), "new work");
  await assert.rejects(cleanupMergedTaskWorktree(mission, task), /changed|uncommitted/i);
  assert.ok(existsSync(path.join(task.worktreePath, "new.txt")));
  rmSync(path.join(task.worktreePath, "new.txt"));
  assert.equal(await cleanupMergedTaskWorktree(mission, task), "cleaned");
  assert.equal(await cleanupMergedTaskWorktree(mission, task), "cleaned");
  assert.equal(existsSync(task.worktreePath), false);
});

test("task cleanup preserves ignored files that Neiro did not create", async () => {
  const { prepareTaskWorktree, mergeTaskWorktree, cleanupMergedTaskWorktree } = await import("./worktree");
  const repo = makeRepo();
  writeFileSync(path.join(repo, ".gitignore"), ".env.local\n");
  git(repo, "add", ".gitignore");
  git(repo, "commit", "-q", "-m", "ignore local settings");
  process.env.NEIRO_WORKTREE_ROOT = tmp("neiro-wt-");
  const mission = await prepareMissionWorkspace({ workspacePath: repo, missionId: "mission-ignored", baseBranch: "main", isolate: true });
  if (mission.kind !== "worktree") throw new Error("expected worktree");
  const task = await prepareTaskWorktree(mission, "task-one", "T1");
  writeFileSync(path.join(task.worktreePath, "one.txt"), "one");
  await assert.rejects(mergeTaskWorktree(mission, task, "One", async () => { throw new Error("simulate interruption"); }));
  writeFileSync(path.join(task.worktreePath, ".env.local"), "keep this");
  await assert.rejects(cleanupMergedTaskWorktree(mission, task), /ignored/i);
  assert.equal(existsSync(path.join(task.worktreePath, ".env.local")), true);
});

test("an abandoned merge lock is reported without deleting task work", async () => {
  const { prepareTaskWorktree, mergeTaskWorktree } = await import("./worktree");
  const repo = makeRepo();
  process.env.NEIRO_WORKTREE_ROOT = tmp("neiro-wt-");
  const mission = await prepareMissionWorkspace({ workspacePath: repo, missionId: "mission-lock", baseBranch: "main", isolate: true });
  if (mission.kind !== "worktree") throw new Error("expected worktree");
  const task = await prepareTaskWorktree(mission, "task-one", "T1");
  const lock = path.resolve(mission.worktreePath, git(mission.worktreePath, "rev-parse", "--git-common-dir"), "neiro-task-merge.lock");
  mkdirSync(lock);
  assert.equal(await mergeTaskWorktree(mission, task, "One"), "busy");
  const old = new Date(Date.now() - 11 * 60_000);
  utimesSync(lock, old, old);
  await assert.rejects(mergeTaskWorktree(mission, task, "One"), /merge lock.*check.*remove/i);
  assert.ok(existsSync(lock));
  assert.ok(existsSync(task.worktreePath));
});
