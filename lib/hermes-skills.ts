import "server-only";
import { execFile } from "node:child_process";

/**
 * Hermes skills for one profile, through the local `hermes` CLI.
 * Skills belong to a Hermes PROFILE, so every agent on that profile shares them.
 * Commands run with argv (execFile, never a shell). Only works when Hermes runs
 * on this computer; the route refuses a remote Hermes.
 */

export type HermesSkill = {
  name: string;
  category: string;
  source: string;
  trust: string;
  enabled: boolean;
  /** Only hub-installed skills can be removed; builtin/local ones can only be turned off. */
  removable: boolean;
};

export type HermesSkillHit = {
  name: string;
  identifier: string;
  source: string;
  trust: string;
  description: string;
};

export class HermesSkillError extends Error {
  constructor(message: string, readonly status = 500) {
    super(message);
    this.name = "HermesSkillError";
  }
}

const PROFILE_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const IDENT_RE = /^[A-Za-z0-9][A-Za-z0-9._@:/-]{0,199}$/;

export function checkProfile(profile: string): string {
  const p = profile.trim() || "default";
  if (!PROFILE_RE.test(p)) throw new HermesSkillError("Invalid profile name.", 400);
  return p;
}

export function checkName(name: unknown): string {
  if (typeof name !== "string" || !NAME_RE.test(name)) throw new HermesSkillError("Invalid skill name.", 400);
  return name;
}

function checkIdentifier(id: unknown): string {
  if (typeof id !== "string" || !IDENT_RE.test(id) || id.includes("..")) {
    throw new HermesSkillError("Invalid skill identifier.", 400);
  }
  return id;
}

export function run(args: string[], timeoutMs = 60_000, input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "hermes",
      args,
      {
        timeout: timeoutMs,
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, COLUMNS: "400", NO_COLOR: "1", TERM: "dumb" },
      },
      (err, stdout, stderr) => {
        if (err) {
          const code = (err as NodeJS.ErrnoException).code;
          const text = code === "ENOENT"
            ? "The hermes CLI is not installed on this computer."
            : String(stderr || stdout || err.message).trim().split("\n").slice(-4).join(" ");
          reject(new HermesSkillError(text || "hermes failed"));
          return;
        }
        resolve(String(stdout));
      },
    );
    // Answer any confirm prompt (or close stdin so prompts read EOF instead of hanging).
    child.stdin?.end(input ?? "");
  });
}

export const withProfile = (profile: string, args: string[]) =>
  profile === "default" ? args : ["-p", profile, ...args];

/** Rows of `hermes skills list` (a box table; one row per skill). */
export async function listSkills(profile: string): Promise<HermesSkill[]> {
  const out = await run(withProfile(profile, ["skills", "list"]));
  const skills: HermesSkill[] = [];
  for (const line of out.split("\n")) {
    if (!line.trimStart().startsWith("│")) continue;
    const cells = line.split("│").map((c) => c.trim()).filter((_, i, a) => i > 0 && i < a.length - 1);
    if (cells.length < 5 || !cells[0] || cells[0] === "Name") continue;
    const [name, category, source, trust, status] = cells;
    skills.push({
      name,
      category,
      source,
      trust,
      enabled: status.toLowerCase().startsWith("enabled"),
      removable: source === "hub",
    });
  }
  return skills;
}

export async function searchSkills(query: string): Promise<HermesSkillHit[]> {
  const q = query.trim().slice(0, 80);
  if (!q) return [];
  const out = await run(["skills", "search", q, "--limit", "12", "--json"], 45_000);
  const start = out.indexOf("[");
  if (start < 0) return [];
  let data: unknown;
  try {
    data = JSON.parse(out.slice(start));
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  return data
    .filter((d): d is Record<string, unknown> => !!d && typeof d === "object")
    .map((d) => ({
      name: String(d.name ?? ""),
      identifier: String(d.identifier ?? ""),
      source: String(d.source ?? ""),
      trust: String(d.trust_level ?? ""),
      description: String(d.description ?? ""),
    }))
    .filter((d) => d.name && IDENT_RE.test(d.identifier));
}

/** Install from a registry. A skill Hermes' scan blocks stays blocked (no --force). */
export async function installSkill(profile: string, identifier: unknown): Promise<void> {
  await run(withProfile(profile, ["skills", "install", checkIdentifier(identifier), "--yes"]), 180_000);
}

export async function uninstallSkill(profile: string, name: unknown): Promise<void> {
  await run(withProfile(profile, ["skills", "uninstall", checkName(name), "--yes"]));
}

/** Turn a skill on/off via the profile's `skills.disabled` list. */
export async function setSkillEnabled(profile: string, name: unknown, enabled: boolean): Promise<void> {
  const skill = checkName(name);
  let disabled: string[] = [];
  try {
    const raw = JSON.parse(await run(withProfile(profile, ["config", "get", "skills.disabled", "--json"])));
    if (Array.isArray(raw)) disabled = raw.filter((x): x is string => typeof x === "string");
  } catch (err) {
    // "Config key not set" means an empty list; anything else is a real failure.
    if (!(err instanceof HermesSkillError) || !/not set/i.test(err.message)) throw err;
  }
  const next = enabled ? disabled.filter((n) => n !== skill) : [...new Set([...disabled, skill])];
  await run(withProfile(profile, ["config", "set", "skills.disabled", JSON.stringify(next)]));
}
