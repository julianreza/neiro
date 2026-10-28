/**
 * Turns one Hermes run event (an SSE `data:` payload, usually JSON) into a
 * log step for the live view. Hermes event names vary by version, so this
 * reads the common fields and falls back to the raw text.
 */

export type LogStepKind = "tool" | "message" | "approval" | "done" | "error" | "info";

export type LogStep = {
  kind: LogStepKind;
  text: string;
  detail?: string;
  at: string | null;
  /** A streamed fragment, joined to the previous message without a space. */
  delta?: boolean;
};

const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function short(text: string, max = 240): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

export function parseRunEvent(raw: string, eventName?: string): LogStep | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "[DONE]") return trimmed === "[DONE]" ? { kind: "done", text: "Run finished", at: null } : null;

  let data: Record<string, unknown>;
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object") return { kind: "info", text: short(String(parsed)), at: null };
    data = parsed as Record<string, unknown>;
  } catch {
    return { kind: "info", text: short(trimmed), at: null };
  }

  const type = (s(data.type) ?? s(data.event) ?? s(eventName) ?? "").toLowerCase();
  const at = s(data.timestamp) ?? s(data.created_at) ?? s(data.time) ?? null;
  const tool =
    s(data.tool) ?? s(data.tool_name) ?? s((data.tool_call as Record<string, unknown> | undefined)?.name) ?? s(data.name);
  const text = s(data.text) ?? s(data.delta) ?? s(data.content) ?? s(data.message) ?? s(data.output);

  if (type.includes("approval") || data.requires_approval === true) {
    return {
      kind: "approval",
      text: `Wants to run ${tool ?? s(data.command) ?? "a tool"}`,
      detail: s(data.command) ?? (text ? short(text) : undefined),
      at,
    };
  }
  if (type.includes("error") || type.includes("fail")) {
    return { kind: "error", text: short(s(data.error) ?? text ?? "Run failed"), at };
  }
  if (type.includes("complete") || type.includes("done") || type === "run.finished") {
    return { kind: "done", text: "Run finished", at };
  }
  if (tool || type.includes("tool")) {
    const args = data.arguments ?? data.args ?? data.input;
    const argText = typeof args === "string" ? args : args && typeof args === "object" ? JSON.stringify(args) : "";
    return { kind: "tool", text: `Ran ${tool ?? "a tool"}`, detail: argText ? short(argText, 160) : undefined, at };
  }
  if (text) return { kind: "message", text: s(data.delta) && !s(data.text) ? String(data.delta) : short(text), at, delta: Boolean(s(data.delta) && !s(data.text)) };
  if (type) return { kind: "info", text: type.replace(/[._]/g, " "), at };
  return null;
}

/**
 * Appends a step, merging consecutive message deltas into one line so a
 * token-by-token stream doesn't become hundreds of rows.
 */
export function appendStep(steps: LogStep[], step: LogStep, max = 300): LogStep[] {
  const last = steps[steps.length - 1];
  if (last && last.kind === "message" && step.kind === "message") {
    // Streamed deltas join as-is; whole messages are separated by a space.
    const joined = step.delta ? `${last.text}${step.text}` : `${last.text} ${step.text}`;
    const merged = { ...last, text: joined.length > 600 ? `…${joined.slice(-599)}` : joined };
    return [...steps.slice(0, -1), merged];
  }
  const next = [...steps, step];
  return next.length > max ? next.slice(next.length - max) : next;
}
