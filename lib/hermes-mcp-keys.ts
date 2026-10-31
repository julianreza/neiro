import "server-only";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { HermesSkillError, checkName, run, withProfile } from "@/lib/hermes-skills";

/**
 * API keys for a profile's MCP servers. A server's config names its secrets as
 * `${VAR}`; Hermes fills them from the profile's `.env` when it loads. neiro
 * writes only the VARs that server names, never echoes a value back, and keeps
 * the file at 0600. Values go to the file directly, not through argv, so they
 * never show in the process list.
 */

export type McpKeyVar = { name: string; set: boolean };

const VAR_RE = /\$\{([A-Z][A-Z0-9_]{0,63})\}/g;
const KEY_RE = /^[A-Z][A-Z0-9_]{0,63}$/;

/** The `${VAR}` names inside one server's config block. */
export function varsInConfig(cfg: unknown): string[] {
  return [...new Set([...JSON.stringify(cfg ?? {}).matchAll(VAR_RE)].map((m) => m[1]))];
}

export async function envPath(profile: string): Promise<string> {
  const out = (await run(withProfile(profile, ["config", "env-path"]))).trim().split("\n").pop()?.trim() ?? "";
  if (!out.startsWith("/") || !out.endsWith(".env")) throw new HermesSkillError("Could not find the profile .env file.");
  return out;
}

async function readEnv(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw err;
  }
}

/** Same line shapes Hermes' load_env() accepts: `KEY=…`, `KEY = …`, `export KEY=…`. */
const definesKey = (line: string, key: string) => new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`).test(line);

function hasValue(text: string, key: string): boolean {
  return text.split("\n").some((line) => definesKey(line, key) && line.split("=").slice(1).join("=").trim() !== "");
}

/** Mirrors Hermes' _quote_env_value. */
function quote(value: string): string {
  if (!/[#"'\s]/.test(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export async function mcpServerConfig(profile: string, name: string): Promise<Record<string, unknown>> {
  const server = checkName(name);
  if (server.includes(".")) throw new HermesSkillError("Invalid MCP server name.", 400);
  let out = "";
  try {
    out = await run(withProfile(profile, ["config", "get", `mcp_servers.${server}`, "--json"]));
  } catch (err) {
    if (err instanceof HermesSkillError && /not set/i.test(err.message)) {
      throw new HermesSkillError("MCP server not found.", 404);
    }
    throw err;
  }
  const start = out.indexOf("{");
  const cfg = start < 0 ? null : (JSON.parse(out.slice(start)) as unknown);
  if (!cfg || typeof cfg !== "object") throw new HermesSkillError("MCP server not found.", 404);
  return cfg as Record<string, unknown>;
}

/** Which of the server's VARs already have a value (names only, never values). */
export async function mcpKeyStatus(profile: string, cfg: unknown, path?: string): Promise<McpKeyVar[]> {
  const vars = varsInConfig(cfg);
  if (!vars.length) return [];
  const text = await readEnv(path ?? (await envPath(profile)));
  return vars.map((name) => ({ name, set: hasValue(text, name) }));
}

/** Upsert the given VARs into the profile .env. Only VARs the server's config names are allowed. */
export async function saveMcpKeys(profile: string, name: string, values: unknown): Promise<McpKeyVar[]> {
  const cfg = await mcpServerConfig(profile, name);
  const allowed = new Set(varsInConfig(cfg));
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    throw new HermesSkillError("Send the keys as an object.", 400);
  }
  const updates: [string, string][] = [];
  for (const [key, raw] of Object.entries(values as Record<string, unknown>)) {
    if (!KEY_RE.test(key) || !allowed.has(key)) throw new HermesSkillError(`${key} is not used by ${name}.`, 400);
    if (typeof raw !== "string") throw new HermesSkillError(`${key} must be text.`, 400);
    const value = raw.trim();
    if (!value) continue; // blank = keep the current value
    if (value.length > 4000 || /[\r\n\0]/.test(value)) throw new HermesSkillError(`${key} has an invalid value.`, 400);
    updates.push([key, value]);
  }
  const path = await envPath(profile);
  if (updates.length) {
    let lines = (await readEnv(path)).split("\n");
    if (lines.at(-1) === "") lines.pop();
    for (const [key, value] of updates) {
      const line = `${key}=${quote(value)}`;
      const at = lines.findIndex((l) => definesKey(l, key));
      if (at >= 0) {
        lines[at] = line;
        lines = lines.filter((l, i) => i <= at || !definesKey(l, key)); // drop duplicates
      } else {
        lines.push(line);
      }
    }
    await writeFile(path, `${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(path, 0o600);
  }
  return mcpKeyStatus(profile, cfg, path);
}
