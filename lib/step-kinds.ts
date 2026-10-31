/**
 * What kind of work a tool step was, for "2 read · 1 changed · 3 commands".
 * Pure: shared by the reply summary and tests.
 */
import type { LogStep } from "@/lib/run-events";

export type StepKind = "read" | "edit" | "command" | "search" | "other";

const COMMAND_FIELD = /"(?:command|cmd|script)"\s*:/;

export function stepKind(step: LogStep): StepKind {
  const tool = step.text.replace(/^Ran\s+/, "").toLowerCase();
  if (COMMAND_FIELD.test(step.detail ?? "") && /term|shell|bash|exec|command|run/.test(tool)) return "command";
  if (/write|create|new_file|edit|patch|replace|str_replace|update/.test(tool)) return "edit";
  if (/read|view|open|cat/.test(tool)) return "read";
  if (/search|grep|glob|find/.test(tool)) return "search";
  if (/term|shell|bash|exec|command/.test(tool)) return "command";
  return "other";
}

export type StepBreakdown = { read: number; edit: number; command: number; search: number; failed: number; total: number };

export function stepBreakdown(steps: LogStep[]): StepBreakdown {
  const out: StepBreakdown = { read: 0, edit: 0, command: 0, search: 0, failed: 0, total: 0 };
  for (const s of steps) {
    if (s.kind !== "tool" && s.kind !== "approval") continue;
    out.total++;
    const k = stepKind(s);
    if (k !== "other") out[k]++;
    if (s.exit !== undefined && s.exit !== 0) out.failed++;
  }
  return out;
}

/** "3 read · 1 changed · 2 commands (1 failed)"; empty parts are left out. */
export function breakdownText(b: StepBreakdown): string {
  const n = (count: number, one: string, many: string) => (count ? `${count} ${count === 1 ? one : many}` : "");
  const commands = n(b.command, "command", "commands");
  return [
    n(b.read, "read", "read"),
    n(b.edit, "changed", "changed"),
    n(b.search, "search", "searches"),
    commands && b.failed ? `${commands} (${b.failed} failed)` : commands,
  ]
    .filter(Boolean)
    .join(" · ");
}
