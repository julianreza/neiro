/**
 * Turns one Hermes run event (an SSE `data:` payload, usually JSON) into a
 * log step for the live view. Hermes event names vary by version, so this
 * reads the common fields and falls back to the raw text.
 */

import type { SubagentRun } from "@/lib/types";

export type LogStepKind =
  | "tool"
  | "message"
  | "reasoning"
  | "commentary"
  | "subagent"
  | "approval"
  | "done"
  | "error"
  | "info";

export type LogStep = {
  kind: LogStepKind;
  text: string;
  detail?: string;
  at: string | null;
  /** A streamed fragment, joined to the previous message without a space. */
  delta?: boolean;
  /** Set on `subagent` steps. */
  subagent?: SubagentRun;
  /** A finished tool call: its exit code (commands) and how long it took. */
  exit?: number;
  ms?: number;
  /** The tool call ended (its result event arrived). */
  ended?: boolean;
};

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** A subagent.start / subagent.complete payload as one SubagentRun. */
export function subagentOf(data: Record<string, unknown>, complete: boolean, at: string | null): SubagentRun {
  const id = s(data.delegation_id) ?? s(data.subagent_id) ?? s(data.child_session_id) ?? "subagent";
  const rawStatus = (s(data.status) ?? "").toLowerCase();
  const status: SubagentRun["status"] = !complete
    ? "running"
    : /fail|error|cancel|timeout/.test(rawStatus)
      ? "failed"
      : "completed";
  const tokens =
    num(data.tokens) ??
    (num(data.input_tokens) !== undefined || num(data.output_tokens) !== undefined
      ? (num(data.input_tokens) ?? 0) + (num(data.output_tokens) ?? 0)
      : undefined);
  const run: SubagentRun = { delegationId: id, status, startedAt: complete ? null : at };
  const child = s(data.child_session_id);
  if (child) run.childSessionId = child;
  const summary = s(data.summary) ?? s(data.goal);
  if (summary) run.summary = summary.slice(0, 400);
  const duration = num(data.duration_seconds) ?? num(data.duration);
  if (duration !== undefined) run.durationSec = Math.round(duration * 10) / 10;
  if (tokens !== undefined) run.tokens = tokens;
  return run;
}

const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function short(text: string, max = 240): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/** Exit code and duration a tool event may carry, under any common name. */
function toolResult(data: Record<string, unknown>): { exit?: number; ms?: number } {
  const result = data.result && typeof data.result === "object" ? (data.result as Record<string, unknown>) : {};
  const pick = (...vals: unknown[]) => vals.find((v): v is number => typeof v === "number" && Number.isFinite(v));
  const exit = pick(data.exit_code, data.exitCode, result.exit_code, result.exitCode, result.returncode);
  const secs = pick(data.duration, result.duration);
  const ms = pick(data.duration_ms, data.durationMs, data.elapsed_ms, result.duration_ms) ?? (secs !== undefined ? secs * 1000 : undefined);
  return { ...(exit !== undefined ? { exit } : {}), ...(ms !== undefined ? { ms: Math.round(ms) } : {}) };
}

const TERMINAL_RUN_EVENTS = new Set(["run.completed", "run.succeeded", "run.failed", "run.error", "run.cancelled", "run.canceled", "run.stopped", "run.interrupted", "run.finished"]);
export function isTerminalRunEventType(type: string): boolean {
  return TERMINAL_RUN_EVENTS.has(type.toLowerCase());
}

/** Answer fragments are separate from the bounded, summarized step trail. */
export function answerDelta(raw: string, eventName?: string): string | null {
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    const type = (s(data.type) ?? s(data.event) ?? s(eventName) ?? "").toLowerCase();
    if (data.phase === "commentary") return null;
    if (!["message.delta", "assistant.delta", "response.output_text.delta"].includes(type)) return null;
    return typeof data.delta === "string" ? data.delta : null;
  } catch {
    return null;
  }
}

/** Hermes can identify streamed commentary only after it emitted the deltas. */
export function removeInterim(answer: string, raw: string, eventName?: string): string {
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    const type = (s(data.type) ?? s(data.event) ?? s(eventName) ?? "").toLowerCase();
    if (type !== "message.interim" || data.already_streamed !== true) return answer;
    const text = typeof data.text === "string" ? data.text : "";
    return text && answer.endsWith(text) ? answer.slice(0, -text.length) : "";
  } catch { return answer; }
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

  // A CLI run's Allow / Deny answer: its own row, not merged into the reply.
  if (type === "decision" && text) {
    return { kind: "info", text: short(text), at };
  }
  // Before the generic "complete" check: subagent.complete is not the run ending.
  if (type === "subagent.start" || type === "subagent.complete") {
    const run = subagentOf(data, type === "subagent.complete", at);
    const label = run.status === "running" ? "Started a sub-agent" : run.status === "failed" ? "Sub-agent failed" : "Sub-agent finished";
    return { kind: "subagent", text: label, detail: run.summary, at, subagent: run };
  }
  const item = data.item && typeof data.item === "object" ? (data.item as Record<string, unknown>) : null;
  if (
    type === "response.reasoning_summary_text.delta" ||
    type.startsWith("reasoning") ||
    item?.type === "reasoning" ||
    typeof data.reasoning_content === "string"
  ) {
    const raw =
      (typeof data.delta === "string" ? data.delta : null) ??
      (typeof data.reasoning_content === "string" ? data.reasoning_content : null) ??
      s(data.text) ??
      s(item?.text) ??
      "";
    if (!raw) return null;
    const delta = type.endsWith(".delta") || typeof data.delta === "string";
    return { kind: "reasoning", text: delta ? raw : short(raw, 600), at, delta };
  }
  if (type === "message.interim" || type === "assistant.commentary" || data.phase === "commentary") {
    if (data.already_streamed === true) return null;
    return text ? { kind: "commentary", text: short(text), at } : null;
  }
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
  // A tool's own end ("tool.completed", "tool_result"): exit code and time,
  // merged into its start row by appendStep. Before the run-level check.
  if ((tool || type.includes("tool")) && /complete|end|result|finish|done/.test(type)) {
    return { kind: "tool", text: `Ran ${tool ?? "a tool"}`, at, ended: true, ...toolResult(data) };
  }
  if (isTerminalRunEventType(type)) {
    return { kind: "done", text: "Run finished", at };
  }
  if (tool || type.includes("tool")) {
    const args = data.arguments ?? data.args ?? data.input;
    const argText = typeof args === "string" ? args : args && typeof args === "object" ? JSON.stringify(args) : "";
    return { kind: "tool", text: `Ran ${tool ?? "a tool"}`, detail: argText ? short(argText, 160) : undefined, at, ...toolResult(data) };
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
  // A finished sub-agent replaces its own start card.
  if (step.kind === "subagent" && step.subagent && step.subagent.status !== "running") {
    const id = step.subagent.delegationId;
    const at = steps.findIndex((s) => s.kind === "subagent" && s.subagent?.delegationId === id);
    if (at >= 0) {
      const merged = { ...step, subagent: { ...steps[at].subagent, ...step.subagent, startedAt: steps[at].subagent?.startedAt ?? null } };
      return [...steps.slice(0, at), merged, ...steps.slice(at + 1)];
    }
  }
  // A tool's end event fills in the latest open row of the same tool.
  if (step.kind === "tool" && step.ended) {
    for (let i = steps.length - 1; i >= 0; i--) {
      const s = steps[i];
      if (s.kind !== "tool" || s.ended || s.text !== step.text) continue;
      const ms = step.ms ?? (s.at && step.at ? Date.parse(step.at) - Date.parse(s.at) : undefined);
      const merged: LogStep = {
        ...s,
        ended: true,
        ...(step.exit !== undefined ? { exit: step.exit } : {}),
        ...(ms !== undefined && Number.isFinite(ms) && ms >= 0 ? { ms } : {}),
      };
      return [...steps.slice(0, i), merged, ...steps.slice(i + 1)];
    }
  }
  const last = steps[steps.length - 1];
  if (last && last.kind === step.kind && (step.kind === "message" || step.kind === "reasoning")) {
    // Streamed deltas join as-is; whole messages are separated by a space.
    const joined = step.delta ? `${last.text}${step.text}` : `${last.text} ${step.text}`;
    const merged = { ...last, text: joined.length > 600 ? `…${joined.slice(-599)}` : joined };
    return [...steps.slice(0, -1), merged];
  }
  const next = [...steps, step];
  return next.length > max ? next.slice(next.length - max) : next;
}
