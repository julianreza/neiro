/**
 * @mentions in chat and Group rooms (Hermes Bot Mode). Pure: no I/O.
 *
 * A handle is the agent's name in lower case, letters/digits/dashes only
 * ("Neiro PM" -> "neiro-pm"). @all / @everyone address the whole room,
 * @user asks the human. "stop @forge" / "@forge pause" / "stop room" are
 * directives, not questions.
 */

export const ALL_HANDLES = ["all", "everyone"] as const;
export const USER_HANDLE = "user";
const RESERVED = new Set<string>([...ALL_HANDLES, USER_HANDLE, "room"]);
const HANDLE_MAX = 24;

/** The bare handle of one name. */
export function baseHandle(name: string): string {
  const h = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, HANDLE_MAX)
    .replace(/-+$/g, "");
  return h && !RESERVED.has(h) ? h : `bot-${h || "x"}`;
}

/**
 * Handles for a list of agents, in order: a clash gets -2, -3, ... in the
 * order given, so the agent created first keeps the plain handle.
 */
export function assignHandles<T extends { id: string; name: string }>(agents: T[]): Map<string, string> {
  const taken = new Set<string>();
  const out = new Map<string, string>();
  for (const a of agents) {
    const base = baseHandle(a.name);
    let handle = base;
    for (let n = 2; taken.has(handle); n++) handle = `${base.slice(0, HANDLE_MAX - String(n).length - 1)}-${n}`;
    taken.add(handle);
    out.set(a.id, handle);
  }
  return out;
}

export type Directive = { handle: string | "room"; kind: "stop" | "pause" };

export type ParsedMentions = {
  /** Known bot handles, in the order they first appear. */
  handles: string[];
  all: boolean;
  user: boolean;
  stops: Directive[];
};

// "@" must start a word: "mail@forge.dev" is not a mention.
const MENTION = /(?:^|[^\w@])@([a-z0-9][a-z0-9-]{0,40})/gi;

export function parseMentions(text: string, known: readonly string[]): ParsedMentions {
  const knownSet = new Set(known.map((k) => k.toLowerCase()));
  const handles: string[] = [];
  let all = false;
  let user = false;
  for (const m of text.matchAll(MENTION)) {
    const h = m[1].toLowerCase().replace(/-+$/, "");
    if ((ALL_HANDLES as readonly string[]).includes(h)) all = true;
    else if (h === USER_HANDLE) user = true;
    else if (knownSet.has(h) && !handles.includes(h)) handles.push(h);
  }
  const stops: Directive[] = [];
  const lower = text.toLowerCase();
  if (/(?:^|\s)stop\s+(?:the\s+)?room\b/.test(lower)) stops.push({ handle: "room", kind: "stop" });
  for (const m of lower.matchAll(/(?:^|\s)stop\s+@([a-z0-9-]+)/g)) {
    if (knownSet.has(m[1])) stops.push({ handle: m[1], kind: "stop" });
  }
  for (const m of lower.matchAll(/(?:^|\s)@([a-z0-9-]+)\s+pause\b/g)) {
    if (knownSet.has(m[1])) stops.push({ handle: m[1], kind: "pause" });
  }
  return { handles, all, user, stops };
}

/** The line a bot puts before words it relays from another bot. */
export function attribution(senderName: string, handle: string): string {
  return `Message from 🤖 ${senderName} (@${handle}):`;
}

/** Instructions that let a bot hand off to its teammates by @handle. */
export function rosterBlock(team: Array<{ handle: string; name: string; role: string }>): string {
  if (team.length === 0) return "";
  return [
    "Your teammates (mention one with @handle to hand off):",
    ...team.map((t) => `- @${t.handle} — ${t.name}${t.role ? ` (${t.role})` : ""}`),
    `When you relay another bot's words, prefix them with: ${attribution("<Sender>", "<handle>")}`,
  ].join("\n");
}
