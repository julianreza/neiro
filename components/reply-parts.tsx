"use client";

import { ChevronRight, CircleCheck, CircleX, Clock3, FileCode, FolderOpen } from "lucide-react";
import { CopyButton, FileChip } from "@/components/agent-markdown";
import { timeAgo } from "@/lib/client-api";
import { shortPath } from "@/lib/reply-text";
import type { LogStep } from "@/lib/run-events";
import { formatCompactTokens } from "@/lib/utils";

function clock(iso: string): string {
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? "" : t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function stamp(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "";
  const day = t.toLocaleDateString([], { month: "short", day: "numeric" });
  return `${day}, ${clock(iso)}`;
}

export function took(from: string, to: string): string {
  const s = Math.round((Date.parse(to) - Date.parse(from)) / 1000);
  if (!Number.isFinite(s) || s < 0) return "";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Under a reply bubble: the time, how long ago, and how long the answer took. */
export function ReplyTime({ at, finishedAt }: { at: string | null | undefined; finishedAt?: string | null }) {
  const time = at ? clock(at) : "";
  if (!at || !time) return null;
  const spent = finishedAt ? took(at, finishedAt) : "";
  return (
    <p className="chat-when">
      <Clock3 aria-hidden="true" />
      <time dateTime={at}>{time}</time>
      <span>· {timeAgo(at)}</span>
      {spent && <span>· took {spent}</span>}
    </p>
  );
}

/**
 * Kiro Crew style footer under a finished reply: "model · tokens · time it
 * took", then the date and a copy button. Every part is optional.
 */
export function ReplyMeta({
  at,
  finishedAt,
  model,
  tokens,
  inputTokens,
  outputTokens,
  cacheReadTokens,
  copyText,
}: {
  at: string | null | undefined;
  finishedAt?: string | null;
  model?: string | null;
  tokens?: number;
  /** In / out / cache-read split, shown after the total when known. */
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadTokens?: number | null;
  copyText?: string;
}) {
  const spent = at && finishedAt ? took(at, finishedAt) : "";
  const when = at ? stamp(at) : "";
  const split = [
    inputTokens ? `${formatCompactTokens(inputTokens)} in` : "",
    outputTokens ? `${formatCompactTokens(outputTokens)} out` : "",
    cacheReadTokens ? `${formatCompactTokens(cacheReadTokens)} cached` : "",
  ].filter(Boolean);
  const facts = [model, tokens ? `${formatCompactTokens(tokens)} tokens` : "", ...split].filter(Boolean);
  if (!when && facts.length === 0 && !spent && !copyText) return null;
  return (
    <div className="reply-meta">
      {(facts.length > 0 || spent) && (
        <p className="reply-meta-facts">
          {facts.join(" · ")}
          {spent && (
            <span>
              {facts.length > 0 && " · "}
              <Clock3 aria-hidden="true" /> {spent}
            </span>
          )}
        </p>
      )}
      <p className="reply-meta-row">
        {when && at && (
          <time dateTime={at} title={timeAgo(at)}>
            {when}
          </time>
        )}
        {copyText && <CopyButton text={copyText} label="Copy answer" />}
      </p>
    </div>
  );
}

/** "N files read", folded; opens to a row of file chips. */
export function FilesRead({ files }: { files: string[] }) {
  if (files.length === 0) return null;
  return (
    <details className="chat-reads">
      <summary>
        <FolderOpen aria-hidden="true" />
        {files.length} {files.length === 1 ? "file" : "files"} read
        <ChevronRight className="chat-reads-chevron" aria-hidden="true" />
      </summary>
      <div>
        {files.map((file) => (
          <FileChip key={file} text={file} label={shortPath(file)} />
        ))}
      </div>
    </details>
  );
}

type TrailRow = { verb: string; file?: string; text?: string; command?: string; exit?: number; ms?: number };

const FIELD = (names: string) => new RegExp(`"(?:${names})"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)`);
const PATH = FIELD("path|file_path|filePath|file|filename|target_file");
const COMMAND = FIELD("command|cmd|script");

/** The program names in a shell command: "bun x | grep y && head" -> "bun, grep, head". */
function programs(command: string): string {
  const names = command
    .replace(/\\n/g, " ")
    .split(/\|\||&&|[|;]/)
    .map((part) => part.trim().split(/\s+/)[0]?.replace(/^.*\//, ""))
    .filter((name): name is string => Boolean(name) && !/^\w+=/.test(name));
  return [...new Set(names)].slice(0, 4).join(", ") || command.slice(0, 60);
}

/** One tool step in Kiro Crew's words: "Create file.ts", "bun, grep, head". */
function trailRow(step: LogStep): TrailRow {
  return { ...trailBase(step), exit: step.exit, ms: step.ms };
}

function trailBase(step: LogStep): TrailRow {
  const tool = step.text.replace(/^Ran\s+/, "");
  const detail = step.detail ?? "";
  const path = PATH.exec(detail)?.[1];
  const command = COMMAND.exec(detail)?.[1];
  const file = path ? path.replace(/^.*\//, "") : undefined;
  const t = tool.toLowerCase();
  if (command && /term|shell|bash|exec|command|run/.test(t)) return { verb: programs(command), command: command.replace(/\\n/g, " ") };
  if (/write|create|new_file/.test(t)) return { verb: "Create", file };
  if (/edit|patch|replace|str_replace|update/.test(t)) return { verb: "Edit", file };
  if (/read|view|open|cat/.test(t)) return { verb: "Read", file };
  if (/search|grep|glob|find/.test(t)) return { verb: "Search", text: file };
  if (step.kind === "approval") return { verb: step.text };
  return { verb: tool, file };
}

/** How many tool steps a run took (what the work summary counts). */
export function toolSteps(steps: LogStep[]): number {
  return steps.filter((s) => s.kind === "tool" || s.kind === "approval").length;
}

/** "1.2s" / "3m 4s" for a step that took ms milliseconds. */
function stepTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(s < 10 ? 1 : 0)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

/** Exit code and time at the end of a row: "✓ 0 · 1.2s" or "✗ 2 · 8s". */
function RowResult({ row }: { row: TrailRow }) {
  if (row.exit === undefined && row.ms === undefined) return null;
  const failed = row.exit !== undefined && row.exit !== 0;
  return (
    <span className="trail-result" data-failed={failed || undefined}>
      {row.exit !== undefined && (failed ? `✗ exit ${row.exit}` : "✓ exit 0")}
      {row.exit !== undefined && row.ms !== undefined && " · "}
      {row.ms !== undefined && stepTime(row.ms)}
    </span>
  );
}

function Row({ row, full }: { row: TrailRow; full?: boolean }) {
  const failed = row.exit !== undefined && row.exit !== 0;
  const Mark = failed ? CircleX : CircleCheck;
  if (full && row.command) {
    return (
      <li data-failed={failed || undefined}>
        <Mark aria-hidden="true" className="trail-mark" />
        <code className="trail-cmd" title={row.command}>
          <span aria-hidden="true">$ </span>
          {row.command.length > 140 ? `${row.command.slice(0, 140)}…` : row.command}
        </code>
        <RowResult row={row} />
      </li>
    );
  }
  return (
    <li data-failed={failed || undefined}>
      <Mark aria-hidden="true" className="trail-mark" />
      <span className="trail-verb">{row.verb}</span>
      {row.file && (
        <code className="trail-file">
          <FileCode aria-hidden="true" />
          {row.file}
        </code>
      )}
      {row.text && <span className="trail-text">{row.text}</span>}
      {full && <RowResult row={row} />}
    </li>
  );
}

const SHOW_LAST = 4;

/**
 * The agent's steps as Kiro Crew shows them: older steps folded behind
 * "N earlier steps", the latest few as rows, and a "Thinking…" line while
 * it still works.
 */
export function StepTrail({
  steps,
  live,
  label = "Thinking…",
  all = false,
}: {
  steps: LogStep[];
  live: boolean;
  label?: string;
  /** Every step as a row, full commands shown (inside the work summary). */
  all?: boolean;
}) {
  const rows = steps.filter((s) => s.kind === "tool" || s.kind === "approval").map(trailRow);
  const writing = live && steps.length > 0 && steps[steps.length - 1].kind === "message";
  const earlier = all ? [] : rows.slice(0, Math.max(0, rows.length - SHOW_LAST));
  const latest = all ? rows : rows.slice(-SHOW_LAST);
  return (
    <div className="trail" role={live ? "status" : undefined} aria-live={live ? "polite" : undefined}>
      {earlier.length > 0 && (
        <details className="trail-earlier">
          <summary>
            <ChevronRight aria-hidden="true" />
            {live ? `${earlier.length} earlier ${earlier.length === 1 ? "step" : "steps"}` : `Worked through ${rows.length} steps`}
          </summary>
          <ol>
            {earlier.map((row, i) => (
              <Row key={i} row={row} />
            ))}
          </ol>
        </details>
      )}
      {latest.length > 0 && (
        <ol>
          {latest.map((row, i) => (
            <Row key={`${earlier.length + i}`} row={row} full={all} />
          ))}
        </ol>
      )}
      {live && (
        <p className="trail-thinking">
          <span className="trail-dots" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          {writing ? "Writing…" : label}
        </p>
      )}
    </div>
  );
}
