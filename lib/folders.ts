import { execFile } from "node:child_process";
import { readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";

/**
 * Folder browsing and git clone for the mission composer. Everything stays
 * inside the home folder of the user running Neiro; dot-folders are hidden.
 */

const MAX_ENTRIES = 300;
const CLONE_TIMEOUT_MS = 10 * 60 * 1000;
const SKIP = new Set(["node_modules", "Library", "Applications"]);

export class FolderError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export type FolderEntry = { name: string; path: string; git: boolean };
export type FolderListing = {
  path: string;
  home: string;
  parent: string | null;
  git: boolean;
  entries: FolderEntry[];
};

function inside(root: string, path: string) {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Resolve a user-given path to a real folder inside the home folder. */
export async function resolveFolder(input: string | undefined | null): Promise<string> {
  const home = await realpath(homedir());
  const raw = (input ?? "").trim();
  if (raw.length > 500) throw new FolderError("Path is too long.");
  const wanted = !raw || raw === "~" ? home : raw.startsWith("~/") ? join(home, raw.slice(2)) : raw;
  if (!isAbsolute(wanted)) throw new FolderError("Use a full path, like /Users/you/project.");
  const real = await realpath(wanted).catch(() => null);
  if (!real) throw new FolderError(`Folder not found: ${wanted}`, 404);
  if (!inside(home, real)) throw new FolderError("Only folders inside your home folder can be used.", 403);
  const info = await stat(real);
  if (!info.isDirectory()) throw new FolderError(`Not a folder: ${real}`);
  if (relative(home, real).split(sep).some((part) => part.startsWith("."))) {
    throw new FolderError("Hidden folders cannot be used.", 403);
  }
  return real;
}

async function isGitRepo(path: string) {
  return stat(join(path, ".git")).then(() => true, () => false);
}

export async function listFolder(input?: string | null): Promise<FolderListing> {
  const path = await resolveFolder(input);
  const home = await realpath(homedir());
  const dirents = await readdir(path, { withFileTypes: true }).catch(() => {
    throw new FolderError(`Cannot open ${path}`, 403);
  });
  const names = dirents
    .filter((d) => d.isDirectory() && !d.name.startsWith(".") && !SKIP.has(d.name))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .slice(0, MAX_ENTRIES);
  const entries = await Promise.all(
    names.map(async (name) => {
      const full = join(path, name);
      return { name, path: full, git: await isGitRepo(full) };
    }),
  );
  return {
    path,
    home,
    parent: path === home ? null : dirname(path),
    git: await isGitRepo(path),
    entries,
  };
}

/** https://host/owner/repo(.git), ssh://git@host/owner/repo, or git@host:owner/repo. */
const HTTPS = /^https:\/\/[A-Za-z0-9.-]+(:\d+)?\/[A-Za-z0-9._~\/-]+?(\.git)?\/?$/;
const SSH_URL = /^ssh:\/\/[A-Za-z0-9._-]+@[A-Za-z0-9.-]+(:\d+)?\/[A-Za-z0-9._~\/-]+?(\.git)?$/;
const SCP = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[A-Za-z0-9._~\/-]+?(\.git)?$/;

export function repoNameFromUrl(url: string): string {
  return basename(url.replace(/\/+$/, "")).replace(/\.git$/, "");
}

export async function cloneRepo(input: { url: string; parent: string; name?: string }) {
  const url = input.url.trim();
  if (!(HTTPS.test(url) || SSH_URL.test(url) || SCP.test(url))) {
    throw new FolderError("Use a git URL like https://github.com/owner/repo.git or git@github.com:owner/repo.git");
  }
  if (url.startsWith("https://") && new URL(url).username) {
    throw new FolderError("Do not put a username or token in the URL. Use git's own login on this machine.");
  }
  const name = (input.name?.trim() || repoNameFromUrl(url)).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(name)) {
    throw new FolderError("The folder name can use letters, numbers, dot, dash and underscore.");
  }
  const parent = await resolveFolder(input.parent);
  const target = join(parent, name);
  if (await stat(target).then(() => true, () => false)) {
    throw new FolderError(`${target} already exists. Pick another name or folder.`, 409);
  }

  await new Promise<void>((resolve, reject) => {
    execFile(
      "git",
      ["-c", "protocol.file.allow=never", "-c", "protocol.ext.allow=never", "clone", "--", url, target],
      {
        timeout: CLONE_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
        // Never wait for a password prompt: fail and say so instead.
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_SSH_COMMAND: "ssh -o BatchMode=yes" },
      },
      (err, _stdout, stderr) => {
        if (!err) return resolve();
        const tail = String(stderr || err.message).trim().split("\n").slice(-3).join(" ");
        reject(new FolderError(`git clone failed: ${tail}`, 502));
      },
    );
  });
  return { path: target, name };
}
