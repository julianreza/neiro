import "server-only";
import { HermesSkillError, checkName, run, withProfile } from "@/lib/hermes-skills";
import { envPath, mcpKeyStatus, varsInConfig, type McpKeyVar } from "@/lib/hermes-mcp-keys";

/**
 * MCP servers, plugins and toolsets for one Hermes profile, through the local
 * `hermes` CLI. Like skills, they belong to the PROFILE, so every agent on it
 * shares them. MCP servers and plugins run as their own processes and cost RAM.
 */

export type AddonKind = "mcp" | "plugin" | "toolset";

export type AddonItem = {
  name: string;
  detail: string;
  enabled: boolean;
  removable: boolean;
  /** MCP only: the API-key VARs its config needs, and whether each is set. */
  keys?: McpKeyVar[];
  /** MCP only: signs in through a browser instead of (or as well as) keys. */
  oauth?: boolean;
};

export type AddonHit = { id: string; name: string; detail: string; description: string };

/** neiro talks to Hermes through its API server, so that is the platform toolsets apply to. */
const PLATFORM = "api_server";

export function asAddonKind(value: unknown): AddonKind {
  if (value === "mcp" || value === "plugin" || value === "toolset") return value;
  throw new HermesSkillError("Unknown add-on kind.", 400);
}

function parseJson(out: string, open: "[" | "{"): unknown {
  const start = out.indexOf(open);
  if (start < 0) return null;
  try {
    return JSON.parse(out.slice(start));
  } catch {
    return null;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/* ---------- MCP ---------- */

async function listMcp(profile: string): Promise<AddonItem[]> {
  let servers: unknown = {};
  try {
    servers = parseJson(await run(withProfile(profile, ["config", "get", "mcp_servers", "--json"])), "{");
  } catch (err) {
    if (err instanceof HermesSkillError && /not set/i.test(err.message)) return [];
    throw err;
  }
  if (!isRecord(servers)) return [];
  const entries = Object.entries(servers);
  const path = entries.some(([, cfg]) => varsInConfig(cfg).length) ? await envPath(profile) : "";
  return Promise.all(entries.map(async ([name, cfg]) => {
    const c = isRecord(cfg) ? cfg : {};
    const raw = c.enabled;
    const enabled = !(raw === false || (typeof raw === "string" && /^(false|no|off|0)$/i.test(raw)));
    return {
      name,
      detail: "url" in c ? "remote" : "command" in c ? "local process" : "",
      enabled,
      removable: true,
      keys: await mcpKeyStatus(profile, c, path || undefined),
      oauth: c.auth === "oauth",
    };
  }));
}

/** The curated MCP catalog (`hermes mcp catalog` text table), filtered by the query. */
async function searchMcp(query: string): Promise<AddonHit[]> {
  const out = await run(["mcp", "catalog"], 45_000);
  const q = query.toLowerCase();
  const hits: AddonHit[] = [];
  let inTable = false;
  for (const line of out.split("\n")) {
    if (/^\s*-{6,}/.test(line)) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    if (!line.trim()) break; // the table ends at its first blank line; a footer follows
    const m = /^\s{2}(\S+)\s+(\S(?:.*?\S)?)\s{2,}(.*)$/.exec(line);
    if (!m) continue;
    const [, name, status, description] = m;
    if (q && !`${name} ${description}`.toLowerCase().includes(q)) continue;
    hits.push({ id: name, name, detail: status, description });
  }
  return hits.slice(0, 20);
}

/* ---------- Plugins ---------- */

async function listPlugins(profile: string): Promise<AddonItem[]> {
  const data = parseJson(await run(withProfile(profile, ["plugins", "list", "--json"])), "[");
  if (!Array.isArray(data)) return [];
  return data.filter(isRecord).map((p) => ({
    name: String(p.name ?? ""),
    detail: `${String(p.source ?? "")}${p.version ? ` · v${String(p.version)}` : ""}`,
    enabled: String(p.status ?? "") === "enabled",
    removable: String(p.source ?? "") !== "bundled",
  })).filter((p) => p.name);
}

async function searchPlugins(query: string): Promise<AddonHit[]> {
  const args = ["plugins", "search", "--json"];
  if (query) args.push(query);
  const data = parseJson(await run(args, 45_000), "{");
  const results = isRecord(data) && Array.isArray(data.results) ? data.results : [];
  return results.filter(isRecord).map((r) => {
    const repo = String(r.repo ?? "");
    return {
      id: String(r.name ?? ""),
      name: String(r.name ?? ""),
      detail: repo.replace(/^https:\/\/github\.com\//, ""),
      description: String(r.description ?? ""),
    };
  }).filter((r) => r.id).slice(0, 20);
}

/* ---------- Toolsets ---------- */

/** `hermes tools list` lines like "  ✓ enabled  terminal  💻 Terminal & Processes". */
async function listToolsets(profile: string): Promise<AddonItem[]> {
  const out = await run(withProfile(profile, ["tools", "list", "--platform", PLATFORM]));
  const items: AddonItem[] = [];
  let group = "";
  for (const line of out.split("\n")) {
    const head = /^(\S.*?) toolsets/.exec(line);
    if (head) {
      group = head[1].toLowerCase();
      continue;
    }
    const m = /^\s+[✓✗]\s+(enabled|disabled)\s+(\S+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const label = m[3].replace(/^[^\p{L}\p{N}]+/u, "").trim();
    items.push({ name: m[2], detail: [label, group].filter(Boolean).join(" · "), enabled: m[1] === "enabled", removable: false });
  }
  return items;
}

/* ---------- Public API ---------- */

export function listAddons(kind: AddonKind, profile: string): Promise<AddonItem[]> {
  if (kind === "mcp") return listMcp(profile);
  if (kind === "plugin") return listPlugins(profile);
  return listToolsets(profile);
}

export async function searchAddons(kind: AddonKind, query: string): Promise<AddonHit[]> {
  const q = query.trim().slice(0, 80);
  if (kind === "mcp") return searchMcp(q);
  if (kind === "plugin") return searchPlugins(q);
  return [];
}

/** Install, returning the CLI's last lines (they say when a key or login is still needed). */
export async function installAddon(kind: AddonKind, profile: string, id: unknown): Promise<string> {
  const name = checkName(id);
  const out =
    kind === "mcp"
      ? await run(withProfile(profile, ["mcp", "install", name]), 240_000)
      : kind === "plugin"
        ? await run(withProfile(profile, ["plugins", "install", name, "--yes-deps", "--no-enable"]), 300_000)
        : null;
  if (out === null) throw new HermesSkillError("Toolsets are built in; turn them on instead.", 400);
  return out.trim().split("\n").filter((l) => l.trim()).slice(-4).join("\n");
}

export async function removeAddon(kind: AddonKind, profile: string, id: unknown): Promise<void> {
  const name = checkName(id);
  if (kind === "mcp") await run(withProfile(profile, ["mcp", "remove", name]), 60_000, "y\n");
  else if (kind === "plugin") await run(withProfile(profile, ["plugins", "remove", name]), 60_000, "y\n");
  else throw new HermesSkillError("Built-in toolsets cannot be removed.", 400);
}

export async function setAddonEnabled(kind: AddonKind, profile: string, id: unknown, enabled: boolean): Promise<void> {
  const name = checkName(id);
  if (kind === "mcp") {
    if (name.includes(".")) throw new HermesSkillError("Invalid MCP server name.", 400);
    await run(withProfile(profile, ["config", "set", `mcp_servers.${name}.enabled`, enabled ? "true" : "false"]));
  } else if (kind === "plugin") {
    await run(
      withProfile(profile, enabled ? ["plugins", "enable", name, "--no-allow-tool-override"] : ["plugins", "disable", name]),
      60_000,
      "",
    );
  } else {
    await run(withProfile(profile, ["tools", enabled ? "enable" : "disable", "--platform", PLATFORM, name]));
  }
}
