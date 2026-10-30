import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ExecError,
  PrError,
  ensureMissionPr,
  fetchPr,
  fetchPrHead,
  isPushableBranch,
  isSafeBranch,
  listOpenPulls,
  parsePrUrl,
  parseRepoSlug,
  postReviewComments,
  projectRepos,
  repoFromRemote,
  reviewPayload,
  truncateDiff,
  type Exec,
  type ExecOptions,
} from "./github-pr";
import type { ReviewFinding } from "./types";

type Call = { cmd: string; args: string[]; opts?: ExecOptions };

/** Fake exec: the first rule whose `match` is found in "cmd args" answers. */
function fakeExec(rules: [string, string | Error][]): { exec: Exec; calls: Call[] } {
  const calls: Call[] = [];
  const exec: Exec = async (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    const line = `${cmd} ${args.join(" ")}`;
    const rule = rules.find(([match]) => line.includes(match));
    if (!rule) return { stdout: "", stderr: "" };
    if (rule[1] instanceof Error) throw rule[1];
    return { stdout: rule[1], stderr: "" };
  };
  return { exec, calls };
}

const failed = (stderr: string, code: string | number | null = 1) => new ExecError("failed", stderr, code);

const mission = {
  id: "mission-1",
  title: "Pricing page",
  prompt: "Build a pricing page",
  worktreePath: "/wt/mission-1",
  workBranch: "neiro/1",
  baseBranch: null,
};

test("parsePrUrl accepts only GitHub PR URLs", () => {
  assert.deepEqual(parsePrUrl("https://github.com/julianreza/neiro/pull/12"), {
    owner: "julianreza",
    repo: "neiro",
    number: 12,
  });
  assert.deepEqual(parsePrUrl(" https://github.com/a-b/c.d_e/pull/3/ "), { owner: "a-b", repo: "c.d_e", number: 3 });
  for (const bad of [
    "http://github.com/a/b/pull/1",
    "https://gitlab.com/a/b/pull/1",
    "https://github.com/a/b/issues/1",
    "https://github.com/a/b/pull/0",
    "https://github.com/a/b/pull/1/files",
    "https://github.com/-a/b/pull/1",
    "https://github.com/a/../pull/1",
    "https://user:pw@github.com/a/b/pull/1",
    "https://github.com/a/b/pull/1x",
    "not a url",
    42,
  ]) {
    assert.equal(parsePrUrl(bad), null, String(bad));
  }
});

test("isPushableBranch allows only neiro mission branches", () => {
  assert.equal(isPushableBranch("neiro/1730-ab"), true);
  for (const b of ["main", "master", "neiro/", "feature/x", "neiro/a/b", "neiro/a..b", null]) {
    assert.equal(isPushableBranch(b), false, String(b));
  }
});

test("truncateDiff cuts big diffs on a line break", () => {
  assert.deepEqual(truncateDiff("a\nb\n", 100), { diff: "a\nb\n", truncated: false });
  const out = truncateDiff("line1\nline2\nline3\n", 9);
  assert.equal(out.truncated, true);
  assert.ok(out.diff.startsWith("line1\n\n[diff truncated"));
});

test("fetchPr reads the PR and its diff", async () => {
  const { exec, calls } = fakeExec([
    [
      "gh pr view",
      JSON.stringify({
        title: "Add login",
        body: "Body",
        headRefName: "feat",
        baseRefName: "main",
        url: "https://github.com/o/r/pull/5",
        files: [{ path: "a.ts", additions: 3, deletions: 1 }, { nope: true }],
      }),
    ],
    ["gh pr diff", "diff --git a/a.ts b/a.ts\n"],
  ]);
  const pr = await fetchPr({ owner: "o", repo: "r", number: 5 }, exec);
  assert.equal(pr.title, "Add login");
  assert.equal(pr.headRef, "feat");
  assert.deepEqual(pr.files, [{ path: "a.ts", additions: 3, deletions: 1 }]);
  assert.equal(pr.diffTruncated, false);
  assert.deepEqual(calls[0].args.slice(0, 5), ["pr", "view", "5", "--repo", "o/r"]);
});

test("fetchPr names the cause when gh fails", async () => {
  const missing = fakeExec([["gh pr view", failed("", "ENOENT")]]);
  await assert.rejects(fetchPr({ owner: "o", repo: "r", number: 1 }, missing.exec), (e: PrError) => e.reason === "gh_missing");

  const auth = fakeExec([["gh pr view", failed("To get started with GitHub CLI, please run:  gh auth login")]]);
  await assert.rejects(fetchPr({ owner: "o", repo: "r", number: 1 }, auth.exec), (e: PrError) => e.reason === "gh_auth");

  const gone = fakeExec([["gh pr view", failed("GraphQL: Could not resolve to a PullRequest")]]);
  await assert.rejects(fetchPr({ owner: "o", repo: "r", number: 1 }, gone.exec), (e: PrError) => e.reason === "pr_unreadable");
});

test("ensureMissionPr commits, pushes and opens a draft PR", async () => {
  const { exec, calls } = fakeExec([
    ["rev-parse --abbrev-ref HEAD", "neiro/1\n"],
    ["remote get-url origin", "git@github.com:o/r.git\n"],
    ["status --porcelain", " M app/page.tsx\n"],
    ["config user.email", "me@example.com\n"],
    ["gh pr list", "[]"],
    ["gh pr create", "https://github.com/o/r/pull/9\n"],
  ]);
  const pr = await ensureMissionPr({ ...mission, baseBranch: "origin/develop" }, "Add hero section", exec);
  assert.deepEqual(pr, { ref: { owner: "o", repo: "r", number: 9 }, url: "https://github.com/o/r/pull/9", number: 9, created: true, committed: true });

  const lines = calls.map((c) => `${c.cmd} ${c.args.join(" ")}`);
  assert.ok(lines.includes("git -C /wt/mission-1 add -A"));
  assert.ok(lines.includes("git -C /wt/mission-1 commit -q -m neiro: Add hero section"));
  assert.ok(lines.includes("git -C /wt/mission-1 push origin neiro/1"));
  const create = calls.find((c) => c.args[1] === "create")!;
  assert.ok(create.args.includes("--draft"));
  assert.deepEqual(create.args.slice(-2), ["--base", "develop"]);
  assert.equal(create.opts?.cwd, "/wt/mission-1");
  assert.match(create.opts?.input ?? "", /Build a pricing page/);
});

test("ensureMissionPr reuses the open PR and skips an empty commit", async () => {
  const { exec, calls } = fakeExec([
    ["rev-parse --abbrev-ref HEAD", "neiro/1\n"],
    ["status --porcelain", ""],
    ["gh pr list", JSON.stringify([{ number: 4, url: "https://github.com/o/r/pull/4" }])],
  ]);
  const pr = await ensureMissionPr(mission, "Task", exec);
  assert.equal(pr.created, false);
  assert.equal(pr.committed, false);
  assert.equal(pr.number, 4);
  assert.ok(!calls.some((c) => c.args.includes("commit")));
  assert.ok(!calls.some((c) => c.args[1] === "create"));
  assert.ok(calls.some((c) => c.args.join(" ") === "-C /wt/mission-1 push origin neiro/1"));
});

test("ensureMissionPr uses a fallback identity when git has none", async () => {
  const { exec, calls } = fakeExec([
    ["rev-parse --abbrev-ref HEAD", "neiro/1\n"],
    ["status --porcelain", "?? new.ts\n"],
    ["config user.email", failed("")],
    ["gh pr list", JSON.stringify([{ number: 4, url: "https://github.com/o/r/pull/4" }])],
  ]);
  await ensureMissionPr(mission, "Task", exec);
  const commit = calls.find((c) => c.args.includes("commit"))!;
  assert.ok(commit.args.includes("user.email=neiro@localhost"));
});

test("ensureMissionPr refuses what it must not push", async () => {
  const { exec, calls } = fakeExec([]);
  await assert.rejects(ensureMissionPr({ ...mission, worktreePath: null }, "T", exec), (e: PrError) => e.reason === "not_worktree");
  await assert.rejects(ensureMissionPr({ ...mission, workBranch: "main" }, "T", exec), (e: PrError) => e.reason === "forbidden_branch");
  assert.equal(calls.length, 0);

  const wrong = fakeExec([["rev-parse --abbrev-ref HEAD", "main\n"]]);
  await assert.rejects(ensureMissionPr(mission, "T", wrong.exec), (e: PrError) => e.reason === "command_failed");
  assert.ok(!wrong.calls.some((c) => c.args.includes("push")));
});

test("ensureMissionPr reports a missing origin, a bad repo and gh errors", async () => {
  const noOrigin = fakeExec([
    ["rev-parse --abbrev-ref HEAD", "neiro/1\n"],
    ["remote get-url origin", failed("error: No such remote 'origin'")],
  ]);
  await assert.rejects(ensureMissionPr(mission, "T", noOrigin.exec), (e: PrError) => e.reason === "no_origin");

  const notRepo = fakeExec([["rev-parse", failed("fatal: not a git repository")]]);
  await assert.rejects(ensureMissionPr(mission, "T", notRepo.exec), (e: PrError) => e.reason === "not_worktree");

  const noAuth = fakeExec([
    ["rev-parse --abbrev-ref HEAD", "neiro/1\n"],
    ["gh pr list", failed("You are not logged into any GitHub hosts. Run gh auth login")],
  ]);
  await assert.rejects(ensureMissionPr(mission, "T", noAuth.exec), (e: PrError) => e.reason === "gh_auth");
});

const finding = (over: Partial<ReviewFinding>): ReviewFinding => ({
  id: "f1",
  severity: "major",
  category: "correctness",
  observation: "",
  evidence: "",
  dismissed: false,
  file: "a.ts",
  line: 10,
  problem: "Missing await",
  consequence: "promise not awaited -> error swallowed -> user sees success",
  suggestion: "await it",
  posted: false,
  ...over,
});

test("reviewPayload puts line findings inline and the rest in the body", () => {
  const p = reviewPayload([finding({}), finding({ id: "f2", line: null, file: "b.ts", problem: "Whole-file issue" })]);
  assert.equal(p.event, "COMMENT");
  assert.equal(p.comments.length, 1);
  assert.deepEqual({ path: p.comments[0].path, line: p.comments[0].line, side: p.comments[0].side }, { path: "a.ts", line: 10, side: "RIGHT" });
  assert.match(p.comments[0].body, /\*\*\[major · correctness\]\*\* Missing await/);
  assert.match(p.body, /`b.ts`[\s\S]*Whole-file issue/);
});

test("postReviewComments sends the payload on stdin", async () => {
  const { exec, calls } = fakeExec([["gh api", "{}"]]);
  const ids = await postReviewComments({ owner: "o", repo: "r", number: 2 }, [finding({})], exec);
  assert.deepEqual(ids, ["f1"]);
  assert.deepEqual(calls[0].args, ["api", "--method", "POST", "repos/o/r/pulls/2/reviews", "--input", "-"]);
  assert.equal(JSON.parse(calls[0].opts?.input ?? "{}").comments.length, 1);
  assert.deepEqual(await postReviewComments({ owner: "o", repo: "r", number: 2 }, [], exec), []);
  assert.equal(calls.length, 1);
});

test("ensureMissionPr picks up a PR another tick opened a moment ago", async () => {
  let lists = 0;
  const exec: Exec = async (cmd, args) => {
    const line = `${cmd} ${args.join(" ")}`;
    if (line.includes("rev-parse --abbrev-ref HEAD")) return { stdout: "neiro/1\n", stderr: "" };
    if (line.includes("gh pr list")) {
      lists++;
      return { stdout: lists === 1 ? "[]" : JSON.stringify([{ number: 8, url: "https://github.com/o/r/pull/8" }]), stderr: "" };
    }
    if (line.includes("gh pr create")) throw failed('a pull request for branch "neiro/1" into branch "main" already exists');
    return { stdout: "", stderr: "" };
  };
  const pr = await ensureMissionPr(mission, "T", exec);
  assert.equal(pr.number, 8);
  assert.equal(pr.created, false);
});

test("repoFromRemote reads GitHub remotes only", () => {
  for (const [remote, repo] of [
    ["git@github.com:julianreza/neiro.git", "julianreza/neiro"],
    ["https://github.com/julianreza/neiro.git\n", "julianreza/neiro"],
    ["https://github.com/julianreza/neiro", "julianreza/neiro"],
    ["https://token@github.com/o/r.js.git", "o/r.js"],
    ["ssh://git@github.com/o/r.git", "o/r"],
  ] as const) {
    assert.equal(repoFromRemote(remote), repo, remote);
  }
  for (const bad of ["git@gitlab.com:o/r.git", "https://github.com/o", "https://github.com/o/r/x", "/local/path", ""]) {
    assert.equal(repoFromRemote(bad), null, bad);
  }
});

test("projectRepos keeps only projects with a GitHub origin", async () => {
  const exec: Exec = async (_cmd, args) => {
    const path = args[1];
    if (path === "/a") return { stdout: "git@github.com:o/a.git\n", stderr: "" };
    if (path === "/b") return { stdout: "git@gitlab.com:o/b.git\n", stderr: "" };
    throw failed("fatal: not a git repository");
  };
  const out = await projectRepos(
    [
      { id: "1", name: "A", path: "/a" },
      { id: "2", name: "B", path: "/b" },
      { id: "3", name: "C", path: "/c" },
    ],
    exec,
  );
  assert.deepEqual(out, [{ repo: "o/a", projectId: "1", projectName: "A", path: "/a" }]);
});

test("listOpenPulls reads gh pr list, newest first", async () => {
  const { exec, calls } = fakeExec([
    [
      "gh pr list",
      JSON.stringify([
        { number: 3, title: "Old", url: "https://github.com/o/r/pull/3", author: { login: "a" }, headRefName: "x", isDraft: false, updatedAt: "2026-10-01T00:00:00Z" },
        { number: 18, title: "Code review", url: "https://github.com/o/r/pull/18", author: { login: "julianreza" }, headRefName: "feat/code-review-page", isDraft: true, updatedAt: "2026-10-30T14:00:00Z" },
        { number: "bad" },
      ]),
    ],
  ]);
  const pulls = await listOpenPulls("o/r", exec);
  assert.deepEqual(pulls.map((p) => [p.number, p.author, p.isDraft]), [[18, "julianreza", true], [3, "a", false]]);
  assert.deepEqual(calls[0].args.slice(0, 7), ["pr", "list", "--repo", "o/r", "--state", "open", "--limit"]);
  await assert.rejects(listOpenPulls("o/r/x", exec), (e: PrError) => e.reason === "pr_unreadable");
  assert.equal(parseRepoSlug("julianreza/neiro"), "julianreza/neiro");
  assert.equal(parseRepoSlug("-x/r"), null);
});

test("fetchPrHead fetches the PR branch and refuses odd names and forks", async () => {
  const ok = fakeExec([]);
  assert.equal(await fetchPrHead("/repo", "feat/code-review-page", ok.exec), "origin/feat/code-review-page");
  assert.deepEqual(ok.calls[0].args, ["-C", "/repo", "fetch", "--quiet", "origin", "feat/code-review-page"]);

  for (const bad of ["-upload-pack=x", "a..b", "", "x.lock"]) {
    await assert.rejects(fetchPrHead("/repo", bad, ok.exec), PrError, bad);
  }
  assert.equal(isSafeBranch("neiro/1730-ab"), true);

  const fork = fakeExec([["fetch", failed("fatal: couldn't find remote ref feat/x")]]);
  await assert.rejects(fetchPrHead("/repo", "feat/x", fork.exec), /forks are not supported/);
});
