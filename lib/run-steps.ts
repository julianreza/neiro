/**
 * Read a run's SSE event stream into steps, and shrink them for storage.
 * Pure: shared by the events proxy (which saves them) and tests.
 */
import { appendStep, isTerminalRunEventType, parseRunEvent, type LogStep } from "@/lib/run-events";
import type { SubagentRun } from "@/lib/types";

export const RUN_ID = /^[A-Za-z0-9_.:-]{1,120}$/;

const MAX_STEPS = 300;
const MAX_TEXT = 4000;
const MAX_DETAIL = 2000;

function terminalRunEvent(data: string, eventName?: string): boolean {
  if (data.trim() === "[DONE]") return true;
  try {
    const value = JSON.parse(data) as { type?: unknown; event?: unknown } | null;
    const type = typeof value?.type === "string" ? value.type : typeof value?.event === "string" ? value.event : eventName;
    return typeof type === "string" && isTerminalRunEventType(type);
  } catch {
    return typeof eventName === "string" && isTerminalRunEventType(eventName);
  }
}

/** Feed it raw SSE text as it arrives; `steps()` is everything parsed so far. */
export function createStepCollector(onEvent?: (event: { at: string; terminal: boolean }) => void) {
  let buffer = "";
  let steps: LogStep[] = [];
  const frame = (raw: string) => {
    let name: string | undefined;
    const data: string[] = [];
    for (const line of raw.split(/\r?\n/)) {
      if (line.startsWith("event:")) name = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    const step = data.length > 0 ? parseRunEvent(data.join("\n"), name) : null;
    if (data.length > 0) {
      const now = Date.now();
      const parsed = step?.at ? Date.parse(step.at) : NaN;
      const time = new Date(Number.isFinite(parsed) ? Math.min(parsed, now) : now).toISOString();
      onEvent?.({ at: time, terminal: terminalRunEvent(data.join("\n"), name) });
    }
    if (step) steps = appendStep(steps, { ...step, at: step.at ?? new Date().toISOString() }, MAX_STEPS);
  };
  return {
    feed(text: string) {
      buffer += text;
      // SSE frames end with a blank line; keep any partial frame.
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? "";
      for (const f of frames) frame(f);
    },
    /** Parse a last frame the stream ended without a blank line after. */
    end() {
      if (buffer.trim()) frame(buffer);
      buffer = "";
    },
    steps: () => steps,
  };
}

/**
 * What is worth keeping: tool calls, approvals, reasoning and errors, with
 * long text cut. The answer itself is already saved, so message steps go.
 */
export function compactSteps(steps: LogStep[]): LogStep[] {
  return steps
    .filter((s) => s.kind !== "message" && s.kind !== "info")
    .slice(-MAX_STEPS)
    .map((s) => ({
      kind: s.kind,
      text: s.text.length > MAX_TEXT ? `${s.text.slice(0, MAX_TEXT)}…` : s.text,
      ...(s.detail ? { detail: s.detail.length > MAX_DETAIL ? `${s.detail.slice(0, MAX_DETAIL)}…` : s.detail } : {}),
      ...(s.exit !== undefined ? { exit: s.exit } : {}),
      ...(s.ms !== undefined ? { ms: s.ms } : {}),
      ...(s.subagent ? { subagent: s.subagent } : {}),
      at: s.at,
    }));
}

/** Saved rows back to steps; anything malformed is dropped. */
export function readSavedSteps(value: unknown): LogStep[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((v): LogStep[] => {
    if (!v || typeof v !== "object") return [];
    const r = v as Record<string, unknown>;
    if (typeof r.kind !== "string" || typeof r.text !== "string") return [];
    const subagent = readSubagent(r.subagent);
    return [
      {
        kind: r.kind as LogStep["kind"],
        text: r.text,
        ...(typeof r.detail === "string" ? { detail: r.detail } : {}),
        ...(typeof r.exit === "number" ? { exit: r.exit } : {}),
        ...(typeof r.ms === "number" ? { ms: r.ms } : {}),
        ...(subagent ? { subagent } : {}),
        at: typeof r.at === "string" ? r.at : null,
      },
    ];
  });
}

function readSubagent(value: unknown): SubagentRun | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.delegationId !== "string" || !row.delegationId || !["running", "completed", "failed"].includes(String(row.status))) return null;
  return {
    delegationId: row.delegationId,
    status: row.status as SubagentRun["status"],
    startedAt: typeof row.startedAt === "string" ? row.startedAt : null,
    ...(typeof row.childSessionId === "string" ? { childSessionId: row.childSessionId } : {}),
    ...(typeof row.sourceAgentId === "string" ? { sourceAgentId: row.sourceAgentId } : {}),
    ...(typeof row.summary === "string" ? { summary: row.summary } : {}),
    ...(typeof row.durationSec === "number" && Number.isFinite(row.durationSec) ? { durationSec: row.durationSec } : {}),
    ...(typeof row.tokens === "number" && Number.isFinite(row.tokens) ? { tokens: row.tokens } : {}),
  };
}
