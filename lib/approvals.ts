import { APPROVAL_CHOICES, type ApprovalChoice, type PendingControl } from "@/lib/types";

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
  /** Hermes: the run's execution generation, sent back with the answer. */
  executionGeneration?: number;
  /** Hermes: the answers this approval accepts (once / session / always / deny). */
  choices?: ApprovalChoice[];
};

const s = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** "Path: a.txt" / "Command: ls" lines in a prompt, value only. */
function detailOf(text: string): string {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const named = lines.find((l) => /^(path|file|command|cmd|url)\s*:/i.test(l));
  if (named) return named.replace(/^[^:]+:\s*/, "");
  return lines.length > 1 ? lines[1] : (lines[0] ?? "");
}

/**
 * Ids made up for a control that came without one ("default" for the first,
 * else its index). Never sent to Hermes: without a request_id it answers the
 * oldest waiting approval, which is the one meant.
 */
export function isSyntheticRequestId(id: string | null | undefined): boolean {
  return !id || id === "default" || /^\d+$/.test(id);
}

function choicesOf(v: unknown): ApprovalChoice[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const list = v.filter((x): x is ApprovalChoice => APPROVAL_CHOICES.includes(x as ApprovalChoice));
  return list.length ? list : undefined;
}

function generationOf(c: Record<string, unknown>): number | undefined {
  const g = c.execution_generation ?? c.executionGeneration;
  return typeof g === "number" && Number.isFinite(g) ? g : undefined;
}

function idOf(c: Record<string, unknown>, index: number): string {
  return s(c.request_id) || s(c.requestId) || s(c.prompt_id) || s(c.id) || (index === 0 ? "default" : String(index));
}

/**
 * Every control a run waits on (approvals and clarify questions), with what
 * the server needs back: the request id, the execution generation and the
 * allowed answers. Missing choices mean the two every runtime takes.
 */
export function normalizePendingControls(controls: unknown): PendingControl[] {
  if (!Array.isArray(controls)) return [];
  return controls.flatMap((raw, index) => {
    if (!raw || typeof raw !== "object") return [];
    const c = raw as Record<string, unknown>;
    const kindText = s(c.kind) || s(c.type);
    const kind: PendingControl["kind"] = kindText && !/approv/i.test(kindText) ? "clarify" : "approval";
    const title = s(c.title) || s(c.command) || s(c.description) || s(c.message);
    const tool = s(c.tool) || s(c.tool_name) || s(c.name) || /^Allow tool: *(\S+)/.exec(title)?.[1] || undefined;
    const command = (s(c.path) || s(c.command) || detailOf(title)).slice(0, 240) || undefined;
    return [{
      requestId: idOf(c, index),
      executionGeneration: generationOf(c) ?? null,
      kind,
      tool,
      command,
      choices: choicesOf(c.choices) ?? ["once", "deny"],
    }];
  });
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
    const detail = (s(c.path) || s(c.command) || s(c.detail) || detailOf(title)).slice(0, 240);
    const item: PendingApproval = { requestId: idOf(c, index), tool, detail };
    const generation = generationOf(c);
    if (generation !== undefined) item.executionGeneration = generation;
    const choices = choicesOf(c.choices);
    if (choices) item.choices = choices;
    return [item];
  });
}

/** What the agent asks, in plain words. */
export function approvalQuestion(tool: string): string {
  const t = tool.toLowerCase();
  if (/(write|edit|patch|create|delete|move|rename|apply)/.test(t)) return "May I change this file?";
  if (/(bash|shell|exec|run|command|terminal)/.test(t)) return "May I run this command?";
  return `May I use ${tool}?`;
}
