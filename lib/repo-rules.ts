import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * A repository's own rules for agents (AGENTS.md and friends), so the
 * reviewer judges a change against the project's conventions.
 */

export const REPO_RULE_FILES = ["AGENTS.md", "CLAUDE.md", ".github/copilot-instructions.md"] as const;

/** The rules are cut here so they cannot crowd out the diff. */
export const MAX_RULES_CHARS = 6000;

export type RepoRules = { file: string; text: string; truncated: boolean };

type ReadText = (file: string) => Promise<string>;

const readText: ReadText = (file) => readFile(file, "utf8");

/** The first rule file found in `folder`, or null (no folder, none there). */
export async function readRepoRules(folder: string | null | undefined, read: ReadText = readText): Promise<RepoRules | null> {
  if (!folder || !path.isAbsolute(folder)) return null;
  for (const name of REPO_RULE_FILES) {
    try {
      const raw = (await read(path.join(folder, name))).trim();
      if (!raw) continue;
      const truncated = raw.length > MAX_RULES_CHARS;
      return { file: name, text: truncated ? `${raw.slice(0, MAX_RULES_CHARS)}\n…` : raw, truncated };
    } catch {
      // not there; try the next name
    }
  }
  return null;
}
