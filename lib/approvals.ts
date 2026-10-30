/**
 * A tool call waiting for the user's Allow / Deny, in one shape for every
 * runtime. Hermes and Oh My Pi both report these as a run's
 * `pending_controls`; this reads the common fields of either.
 */
export type PendingApproval = {
  requestId: string;
  /** Tool name, e.g. "write" or "bash". */
  tool: string;
  /** The one line that says what it touches: a path or a command. */
  detail: string;
};

const s = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** "Path: a.txt" / "Command: ls" lines in a prompt, value only. */
function detailOf(text: string): string {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const named = lines.find((l) => /^(path|file|command|cmd|url)\s*:/i.test(l));
  if (named) return named.replace(/^[^:]+:\s*/, "");
  return lines.length > 1 ? lines[1] : (lines[0] ?? "");
}

export function normalizeApprovals(controls: unknown): PendingApproval[] {
  if (!Array.isArray(controls)) return [];
  return controls.flatMap((raw, index) => {
    if (!raw || typeof raw !== "object") return [];
    const c = raw as Record<string, unknown>;
    const kind = s(c.kind) || s(c.type);
    if (kind && !/approv/i.test(kind)) return []; // e.g. a clarify question
    const title = s(c.title) || s(c.command) || s(c.description) || s(c.message);
    const tool = s(c.tool) || s(c.tool_name) || s(c.name) || /^Allow tool: *(\S+)/.exec(title)?.[1] || "a tool";
    const detail = (s(c.path) || s(c.command) || detailOf(title)).slice(0, 240);
    return [{ requestId: s(c.request_id) || s(c.id) || (index === 0 ? "default" : String(index)), tool, detail }];
  });
}

/** What the agent asks, in plain words. */
export function approvalQuestion(tool: string): string {
  const t = tool.toLowerCase();
  if (/(write|edit|patch|create|delete|move|rename|apply)/.test(t)) return "May I change this file?";
  if (/(bash|shell|exec|run|command|terminal)/.test(t)) return "May I run this command?";
  return `May I use ${tool}?`;
}
