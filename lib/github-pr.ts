import { execFile } from "node:child_process";
import type { Mission, ReviewFile, ReviewFinding } from "@/lib/types";

/**
 * GitHub pull requests through the `gh` CLI, and the git steps a mission needs
 * before its PR can be reviewed. Every command runs through `exec` with argv
 * (execFile, never a shell); tests pass a fake.
 */

export type ExecOptions = { cwd?: string; input?: string; timeoutMs?: number };
export type ExecResult = { stdout: string; stderr: string };
export type Exec = (cmd: "git" | "gh", args: string[], opts?: ExecOptions) => Promise<ExecResult>;

/** Error from a failed command, with the stderr text the CLI printed. */
export class ExecError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
    readonly code: string | number | null,
  ) {
    super(message);
    this.name = "ExecError";
  }
}

export const defaultExec: Exec = (cmd, args, opts = {}) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      cmd,
      args,
      {
        cwd: opts.cwd,
        timeout: opts.timeoutMs ?? 60_000,
        maxBuffer: 32 * 1024 * 1024,
        env: { ...process.env, GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" },
      },
      (err, stdout, stderr) => {
        if (err) {
          const code = (err as NodeJS.ErrnoException).code ?? null;
          reject(new ExecError(`${cmd} ${args[0] ?? ""} failed: ${String(stderr || err.message).trim()}`, String(stderr ?? ""), code));
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      },
    );
    child.stdin?.end(opts.input ?? "");
  });

/* ------------------------------------------------------------------ */
/* PR URLs                                                             */
/* ------------------------------------------------------------------ */

export type PrRef = { owner: string; repo: string; number: number };

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^[A-Za-z0-9_.-]{1,100}$/;

/** `https://github.com/<owner>/<repo>/pull/<n>` (trailing "/" allowed), else null. */
export function parsePrUrl(raw: unknown): PrRef | null {
  if (typeof raw !== "string") return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password || url.port) {
    return null;
  }
  const parts = url.pathname.replace(/\/$/, "").split("/").slice(1);
  if (parts.length !== 4 || parts[2] !== "pull") return null;
  const [owner, repo, , n] = parts;
  if (!OWNER.test(owner) || !REPO.test(repo) || repo === "." || repo === "..") return null;
  if (!/^[1-9][0-9]{0,9}$/.test(n)) return null;
  return { owner, repo, number: Number(n) };
}

export const prSlug = (ref: PrRef) => `${ref.owner}/${ref.repo}`;
export const prUrlOf = (ref: PrRef) => `https://github.com/${prSlug(ref)}/pull/${ref.number}`;

/* ------------------------------------------------------------------ */
/* Errors people can act on                                            */
/* ------------------------------------------------------------------ */

export type PrErrorReason =
  | "gh_missing"
  | "gh_auth"
  | "not_worktree"
  | "no_origin"
  | "forbidden_branch"
  | "pr_unreadable"
  | "command_failed";

export class PrError extends Error {
  constructor(
    readonly reason: PrErrorReason,
    message: string,
  ) {
    super(message);
    this.name = "PrError";
  }
}

/** Turns a failed `gh` call into a PrError that names the cause. */
function ghError(err: unknown, what: string): PrError {
  const stderr = err instanceof ExecError ? err.stderr : "";
  const text = `${stderr} ${err instanceof Error ? err.message : String(err)}`;
  if (err instanceof ExecError && err.code === "ENOENT") {
    return new PrError("gh_missing", "The gh CLI is not installed on the neiro host. Install it, then run `gh auth login`.");
  }
  if (/gh auth login|not logged in|authentication|HTTP 401|bad credentials/i.test(text)) {
    return new PrError("gh_auth", "The gh CLI is not logged in. Run `gh auth login` on the neiro host.");
  }
  if (/could not resolve|not found|HTTP 404|no pull requests? found/i.test(text)) {
    return new PrError("pr_unreadable", `${what}: the pull request or repository was not found, or gh cannot see it.`);
  }
  return new PrError("command_failed", `${what}: ${firstLine(stderr) || (err instanceof Error ? err.message : String(err))}`);
}

function firstLine(s: string): string {
  return s.trim().split("\n")[0]?.trim() ?? "";
}

/* ------------------------------------------------------------------ */
/* Reading a PR                                                        */
/* ------------------------------------------------------------------ */

/** The diff sent to the reviewer is cut here so a huge PR cannot blow the prompt. */
export const MAX_DIFF_BYTES = 200 * 1024;

export type PrData = {
  ref: PrRef;
  url: string;
  title: string;
  body: string;
  headRef: string;
  baseRef: string;
  files: ReviewFile[];
  diff: string;
  diffTruncated: boolean;
};

export function truncateDiff(diff: string, max = MAX_DIFF_BYTES): { diff: string; truncated: boolean } {
  const bytes = Buffer.byteLength(diff, "utf8");
  if (bytes <= max) return { diff, truncated: false };
  const cut = Buffer.from(diff, "utf8").subarray(0, max).toString("utf8");
  const end = cut.lastIndexOf("\n");
  return {
    diff: `${end > 0 ? cut.slice(0, end) : cut}\n\n[diff truncated: ${bytes} bytes total, first ${max} bytes shown]\n`,
    truncated: true,
  };
}

export async function fetchPr(ref: PrRef, exec: Exec = defaultExec): Promise<PrData> {
  const repo = prSlug(ref);
  const n = String(ref.number);
  let view: Record<string, unknown>;
  try {
    const { stdout } = await exec("gh", [
      "pr", "view", n, "--repo", repo, "--json", "title,body,headRefName,baseRefName,files,url",
    ]);
    view = JSON.parse(stdout) as Record<string, unknown>;
  } catch (err) {
    if (err instanceof SyntaxError) throw new PrError("command_failed", "gh pr view returned text that is not JSON.");
    throw ghError(err, `Reading ${repo}#${n}`);
  }

  let rawDiff: string;
  try {
    rawDiff = (await exec("gh", ["pr", "diff", n, "--repo", repo], { timeoutMs: 120_000 })).stdout;
  } catch (err) {
    throw ghError(err, `Reading the diff of ${repo}#${n}`);
  }
  const { diff, truncated } = truncateDiff(rawDiff);

  const files = Array.isArray(view.files)
    ? view.files.flatMap((f) => {
        const r = (f ?? {}) as Record<string, unknown>;
        return typeof r.path === "string"
          ? [{ path: r.path, additions: Number(r.additions) || 0, deletions: Number(r.deletions) || 0 }]
          : [];
      })
    : [];

  return {
    ref,
    url: typeof view.url === "string" ? view.url : prUrlOf(ref),
    title: typeof view.title === "string" ? view.title : "",
    body: typeof view.body === "string" ? view.body : "",
    headRef: typeof view.headRefName === "string" ? view.headRefName : "",
    baseRef: typeof view.baseRefName === "string" ? view.baseRefName : "",
    files,
    diff,
    diffTruncated: truncated,
  };
}

/* ------------------------------------------------------------------ */
/* The mission's PR                                                    */
/* ------------------------------------------------------------------ */

export type MissionPrInput = Pick<Mission, "id" | "title" | "prompt" | "worktreePath" | "workBranch" | "baseBranch">;
export type MissionPr = { ref: PrRef; url: string; number: number; created: boolean; committed: boolean };

const PROTECTED = new Set(["main", "master", "mainline", "develop", "trunk"]);

/** Only neiro's own mission branches may be pushed. */
export function isPushableBranch(branch: string | null | undefined): branch is string {
  if (!branch || !branch.startsWith("neiro/") || PROTECTED.has(branch)) return false;
  return /^neiro\/[A-Za-z0-9._-]+$/.test(branch) && !branch.includes("..");
}

/** `origin/main` -> `main`: gh wants the branch name on the remote. */
function remoteBranch(base: string | null): string | null {
  if (!base) return null;
  const name = base.replace(/^refs\/heads\//, "").replace(/^origin\//, "");
  return name && !name.startsWith("-") ? name : null;
}

export function missionPrBody(m: Pick<Mission, "id" | "prompt">): string {
  const brief = m.prompt.length > 4000 ? `${m.prompt.slice(0, 4000)}\n…` : m.prompt;
  return [
    "Opened by neiro for a Build / Fix mission. Each task is pushed here before its Final review.",
    "",
    `Mission: \`${m.id}\``,
    "",
    "## Objective",
    "",
    brief,
  ].join("\n");
}

/**
 * Commit what the agents left in the mission worktree, push the mission
 * branch, and open its draft PR (or reuse the one already open).
 * Throws PrError with the cause when any step cannot be done.
 */
export async function ensureMissionPr(
  mission: MissionPrInput,
  taskTitle: string,
  exec: Exec = defaultExec,
): Promise<MissionPr> {
  const cwd = mission.worktreePath;
  const branch = mission.workBranch;
  if (!cwd || !branch) {
    throw new PrError("not_worktree", "This mission does not run in a git worktree, so neiro cannot open a PR for it.");
  }
  if (!isPushableBranch(branch)) {
    throw new PrError("forbidden_branch", `Refusing to push branch "${branch}": only neiro/<mission> branches are pushed.`);
  }

  const git = async (args: string[], what: string) => {
    try {
      return (await exec("git", ["-C", cwd, ...args])).stdout.trim();
    } catch (err) {
      const stderr = err instanceof ExecError ? err.stderr : "";
      if (/not a git repository/i.test(stderr)) {
        throw new PrError("not_worktree", `${cwd} is not a git worktree.`);
      }
      throw new PrError("command_failed", `${what}: ${firstLine(stderr) || (err instanceof Error ? err.message : String(err))}`);
    }
  };

  const current = await git(["rev-parse", "--abbrev-ref", "HEAD"], "Reading the worktree branch");
  if (current !== branch) {
    throw new PrError("command_failed", `The worktree is on "${current}", expected "${branch}".`);
  }

  try {
    await exec("git", ["-C", cwd, "remote", "get-url", "origin"]);
  } catch {
    throw new PrError("no_origin", "The repository has no `origin` remote, so the mission branch cannot be pushed.");
  }

  let committed = false;
  const status = await git(["status", "--porcelain"], "Reading the worktree status");
  if (status) {
    await git(["add", "-A"], "Staging the agents' changes");
    let identity: string[] = [];
    try {
      const { stdout } = await exec("git", ["-C", cwd, "config", "user.email"]);
      if (!stdout.trim()) throw new Error("no email");
    } catch {
      identity = ["-c", "user.name=Neiro", "-c", "user.email=neiro@localhost"];
    }
    const subject = `neiro: ${taskTitle.replace(/\s+/g, " ").trim().slice(0, 120) || "task"}`;
    try {
      await exec("git", ["-C", cwd, ...identity, "commit", "-q", "-m", subject]);
    } catch (err) {
      const stderr = err instanceof ExecError ? err.stderr : "";
      throw new PrError("command_failed", `Committing the agents' changes: ${firstLine(stderr) || String(err)}`);
    }
    committed = true;
  }

  await git(["push", "origin", branch], "Pushing the mission branch");

  let existing: { number?: unknown; url?: unknown }[] = [];
  try {
    const { stdout } = await exec(
      "gh",
      ["pr", "list", "--head", branch, "--state", "open", "--json", "number,url", "--limit", "1"],
      { cwd },
    );
    existing = JSON.parse(stdout || "[]");
  } catch (err) {
    if (err instanceof SyntaxError) throw new PrError("command_failed", "gh pr list returned text that is not JSON.");
    throw ghError(err, "Looking for the mission PR");
  }
  const open = existing.find((p) => typeof p.url === "string" && parsePrUrl(p.url));
  if (open) {
    const ref = parsePrUrl(open.url)!;
    return { ref, url: prUrlOf(ref), number: ref.number, created: false, committed };
  }

  const base = remoteBranch(mission.baseBranch);
  const args = [
    "pr", "create", "--draft",
    "--head", branch,
    "--title", mission.title.slice(0, 200) || `neiro mission ${mission.id}`,
    "--body-file", "-",
    ...(base ? ["--base", base] : []),
  ];
  let out: string;
  try {
    out = (await exec("gh", args, { cwd, input: missionPrBody(mission) })).stdout;
  } catch (err) {
    // Another tick opened it a moment ago: use that one.
    const stderr = err instanceof ExecError ? err.stderr : "";
    if (/already exists/i.test(stderr)) {
      const again = await exec(
        "gh",
        ["pr", "list", "--head", branch, "--state", "open", "--json", "number,url", "--limit", "1"],
        { cwd },
      ).catch(() => ({ stdout: "[]", stderr: "" }));
      let found: { url?: unknown }[] = [];
      try {
        found = JSON.parse(again.stdout || "[]");
      } catch {
        found = [];
      }
      const ref = found.map((p) => parsePrUrl(p.url)).find((r): r is PrRef => r !== null);
      if (ref) return { ref, url: prUrlOf(ref), number: ref.number, created: false, committed };
    }
    throw ghError(err, "Opening the mission PR");
  }
  const url = out.trim().split(/\s+/).reverse().find((w) => parsePrUrl(w));
  const ref = url ? parsePrUrl(url) : null;
  if (!ref) throw new PrError("command_failed", `gh pr create did not print a PR URL: ${firstLine(out)}`);
  return { ref, url: prUrlOf(ref), number: ref.number, created: true, committed };
}

/* ------------------------------------------------------------------ */
/* Posting findings                                                    */
/* ------------------------------------------------------------------ */

export function findingCommentBody(
  f: Pick<ReviewFinding, "severity" | "problem" | "consequence" | "suggestion"> &
    Partial<Pick<ReviewFinding, "category" | "observation" | "evidence">>,
): string {
  const tick3 = "`".repeat(3);
  const fence = f.evidence && !f.evidence.includes(tick3) ? `\n${tick3}\n${f.evidence}\n${tick3}` : "";
  return [
    `**[${f.severity}${f.category ? ` · ${f.category}` : ""}]** ${f.problem}`,
    f.observation ? `\n${f.observation}` : "",
    fence,
    f.consequence ? `\n**Consequence:** ${f.consequence}` : "",
    f.suggestion ? `\n**Suggestion:** ${f.suggestion}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** The GitHub "create review" payload: line findings inline, the rest in the body. */
export function reviewPayload(findings: ReviewFinding[]) {
  const inline = findings.filter((f) => f.line !== null && f.line > 0);
  const general = findings.filter((f) => f.line === null || f.line <= 0);
  const body = [
    "Review from neiro.",
    ...general.map((f) => `\n---\n\`${f.file}\`\n\n${findingCommentBody(f)}`),
  ].join("\n");
  return {
    event: "COMMENT" as const,
    body,
    comments: inline.map((f) => ({ path: f.file, line: f.line as number, side: "RIGHT" as const, body: findingCommentBody(f) })),
  };
}

/** Posts the findings as one GitHub review (event COMMENT). Returns the ids sent. */
export async function postReviewComments(
  ref: PrRef,
  findings: ReviewFinding[],
  exec: Exec = defaultExec,
): Promise<string[]> {
  if (findings.length === 0) return [];
  try {
    await exec(
      "gh",
      ["api", "--method", "POST", `repos/${prSlug(ref)}/pulls/${ref.number}/reviews`, "--input", "-"],
      { input: JSON.stringify(reviewPayload(findings)) },
    );
  } catch (err) {
    throw ghError(err, `Posting the review to ${prSlug(ref)}#${ref.number}`);
  }
  return findings.map((f) => f.id);
}

/* ------------------------------------------------------------------ */
/* GitHub repos of local projects                                      */
/* ------------------------------------------------------------------ */

/**
 * `owner/repo` from a GitHub remote URL (https, ssh or scp form), else null.
 * Remotes on other hosts return null: the reviewer only reads GitHub PRs.
 */
export function repoFromRemote(remote: string): string | null {
  const url = remote.trim();
  const m =
    /^(?:https:\/\/(?:[^@/]+@)?github\.com\/|ssh:\/\/git@github\.com(?::\d+)?\/|git@github\.com:)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url);
  if (!m) return null;
  const [, owner, repo] = m;
  if (!OWNER.test(owner) || !REPO.test(repo) || repo === "." || repo === "..") return null;
  return `${owner}/${repo}`;
}

export type ProjectRepo = { repo: string; projectId: string; projectName: string; path: string };

/** The GitHub repo (origin remote) of each project folder that is a git repo. */
export async function projectRepos(
  projects: { id: string; name: string; path: string }[],
  exec: Exec = defaultExec,
): Promise<ProjectRepo[]> {
  const found = await Promise.all(
    projects.map(async (p) => {
      try {
        const { stdout } = await exec("git", ["-C", p.path, "remote", "get-url", "origin"], { timeoutMs: 5_000 });
        const repo = repoFromRemote(stdout);
        return repo ? { repo, projectId: p.id, projectName: p.name, path: p.path } : null;
      } catch {
        return null; // not a git repo, no origin, or the folder is gone
      }
    }),
  );
  return found.filter((r): r is ProjectRepo => r !== null);
}

/* ------------------------------------------------------------------ */
/* Open pull requests of a repo                                        */
/* ------------------------------------------------------------------ */

export type OpenPull = {
  repo: string;
  number: number;
  url: string;
  title: string;
  author: string;
  headRef: string;
  isDraft: boolean;
  updatedAt: string;
};

/** `owner/repo` that is safe to hand to gh, else null. */
export function parseRepoSlug(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const [owner, repo, extra] = raw.trim().split("/");
  if (extra !== undefined || !owner || !repo) return null;
  if (!OWNER.test(owner) || !REPO.test(repo) || repo === "." || repo === "..") return null;
  return `${owner}/${repo}`;
}

/** The repo's open PRs, newest activity first (at most `limit`). */
export async function listOpenPulls(repo: string, exec: Exec = defaultExec, limit = 30): Promise<OpenPull[]> {
  const slug = parseRepoSlug(repo);
  if (!slug) throw new PrError("pr_unreadable", `Not a GitHub repository: ${repo}`);
  let rows: Record<string, unknown>[];
  try {
    const { stdout } = await exec("gh", [
      "pr", "list", "--repo", slug, "--state", "open", "--limit", String(Math.min(Math.max(limit, 1), 100)),
      "--json", "number,title,url,author,headRefName,isDraft,updatedAt",
    ]);
    rows = JSON.parse(stdout || "[]");
  } catch (err) {
    if (err instanceof SyntaxError) throw new PrError("command_failed", "gh pr list returned text that is not JSON.");
    throw ghError(err, `Listing the open PRs of ${slug}`);
  }
  return rows
    .flatMap((r) => {
      const number = Number(r.number);
      if (!Number.isInteger(number) || number <= 0) return [];
      const author = (r.author ?? {}) as Record<string, unknown>;
      return [
        {
          repo: slug,
          number,
          url: typeof r.url === "string" ? r.url : `https://github.com/${slug}/pull/${number}`,
          title: typeof r.title === "string" ? r.title : "",
          author: typeof author.login === "string" ? author.login : "",
          headRef: typeof r.headRefName === "string" ? r.headRefName : "",
          isDraft: r.isDraft === true,
          updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : "",
        },
      ];
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/* ------------------------------------------------------------------ */
/* Fix with agent: start from the PR's head                            */
/* ------------------------------------------------------------------ */

/** A branch name safe to pass to git as one argument. */
export function isSafeBranch(name: string | null | undefined): name is string {
  return (
    !!name &&
    name.length <= 200 &&
    /^(?!-)(?!.*\.\.)(?!.*\/\/)(?!.*\.lock$)[A-Za-z0-9._/-]+(?<![./])$/.test(name)
  );
}

/**
 * Fetch the PR's head branch into `checkout` so a mission can start from
 * it. Returns the ref to start from (`origin/<head>`). The head must be a
 * branch of `origin`: a PR from a fork is refused.
 */
export async function fetchPrHead(checkout: string, headRef: string, exec: Exec = defaultExec): Promise<string> {
  if (!isSafeBranch(headRef)) throw new PrError("command_failed", `Unusual branch name "${headRef}"; refusing to fetch it.`);
  try {
    await exec("git", ["-C", checkout, "fetch", "--quiet", "origin", headRef], { timeoutMs: 120_000 });
  } catch (err) {
    const stderr = err instanceof ExecError ? err.stderr : "";
    if (/couldn't find remote ref|not our ref/i.test(stderr)) {
      throw new PrError("pr_unreadable", `Branch "${headRef}" is not on origin. Pull requests from forks are not supported yet.`);
    }
    if (/not a git repository/i.test(stderr)) throw new PrError("not_worktree", `${checkout} is not a git repository.`);
    throw new PrError("command_failed", `Fetching ${headRef}: ${firstLine(stderr) || String(err)}`);
  }
  return `origin/${headRef}`;
}
