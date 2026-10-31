"use client";

import { Children, cloneElement, isValidElement, useEffect, useId, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import {
  Brain,
  ChevronRight,
  CircleCheck,
  CircleX,
  FileDiff,
  Info,
  Lightbulb,
  ListChecks,
  MessageSquareWarning,
  OctagonAlert,
  Sparkles,
  SquareTerminal,
  TriangleAlert,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { calloutKind, stripCallout, wordCallout, type CalloutKind, type DiffFile, type ShellRun } from "@/lib/reply-text";
import type { LogStep } from "@/lib/run-events";
import { breakdownText, stepBreakdown } from "@/lib/step-kinds";

/* 1. Work summary ---------------------------------------------------- */

/**
 * After a reply: "Worked 2m 14s · 14 steps · 3 read · 1 changed · 2 commands",
 * folded, with every step inside. `children` is the step list (StepTrail).
 */
export function WorkSummary({
  steps,
  spent,
  files,
  children,
}: {
  steps: LogStep[];
  spent?: string;
  files?: number;
  children: ReactNode;
}) {
  const b = stepBreakdown(steps);
  if (b.total === 0) return null;
  const detail = breakdownText(b) || (files ? `${files} ${files === 1 ? "file" : "files"} read` : "");
  const facts = [`${b.total} ${b.total === 1 ? "step" : "steps"}`, detail].filter(Boolean);
  return (
    <details className="work-sum" data-failed={b.failed > 0 || undefined}>
      <summary>
        <ChevronRight aria-hidden="true" className="work-sum-chev" />
        <Sparkles aria-hidden="true" />
        <b>{spent ? `Worked ${spent}` : "Worked"}</b>
        <span>· {facts.join(" · ")}</span>
      </summary>
      <div className="work-sum-body">{children}</div>
    </details>
  );
}

/* 2. Files changed --------------------------------------------------- */

/** "3 files changed +34 −8", each file a link to its diff card below. */
export function ChangedFiles({ files }: { files: DiffFile[] }) {
  if (files.length === 0) return null;
  const adds = files.reduce((n, f) => n + f.adds, 0);
  const dels = files.reduce((n, f) => n + f.dels, 0);
  return (
    <div className="changed">
      <p className="changed-head">
        <FileDiff aria-hidden="true" />
        <b>
          {files.length} {files.length === 1 ? "file" : "files"} changed
        </b>
        <span data-tone="add">+{adds}</span>
        {dels > 0 && <span data-tone="del">−{dels}</span>}
      </p>
      <ul>
        {files.map((f) => (
          <li key={f.file}>
            <a href={`#${diffAnchor(f.file)}`}>
              <code>{f.file}</code>
            </a>
            <span data-tone="add">+{f.adds}</span>
            {f.dels > 0 && <span data-tone="del">−{f.dels}</span>}
            <DiffBar adds={f.adds} dels={f.dels} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Five small squares, green for added share, red for removed, like GitHub. */
function DiffBar({ adds, dels }: { adds: number; dels: number }) {
  const total = adds + dels || 1;
  const green = Math.round((adds / total) * 5);
  return (
    <span className="diff-bar" aria-hidden="true">
      {Array.from({ length: 5 }, (_, i) => (
        <i key={i} data-tone={i < green ? "add" : "del"} />
      ))}
    </span>
  );
}

export function diffAnchor(file: string): string {
  return `chg-${file.replace(/[^\w-]+/g, "-")}`;
}

/* 3. Plan / checklist ------------------------------------------------ */

type HastNode = { type?: string; tagName?: string; properties?: Record<string, unknown>; children?: HastNode[] };

function countTasks(node: HastNode | undefined): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const li of node?.children ?? []) {
    if (li.tagName !== "li") continue;
    const box = (li.children ?? []).flatMap((c) => (c.tagName === "p" ? (c.children ?? []) : [c])).find((c) => c.tagName === "input");
    if (!box) continue;
    total++;
    if (box.properties?.checked) done++;
  }
  return { done, total };
}

/** A GFM task list ("- [x] step") as a plan card with a "2 of 4" count. */
export function TaskList({ node, children }: { node?: unknown; children: ReactNode }) {
  const { done, total } = countTasks(node as HastNode | undefined);
  return (
    <div className="plan" data-done={total > 0 && done === total ? "" : undefined}>
      <p className="plan-head">
        <ListChecks aria-hidden="true" />
        <b>Plan</b>
        <span>
          {done} of {total} done
        </span>
        <span className="plan-bar" aria-hidden="true">
          <i style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
        </span>
      </p>
      <ul className="plan-list">{children}</ul>
    </div>
  );
}

/* 4. Thinking -------------------------------------------------------- */

/** The agent's reasoning, folded under "Thought for 12s". */
export function ThinkingBlock({ text, spent }: { text: string; spent?: string }) {
  if (!text.trim()) return null;
  return (
    <details className="think">
      <summary>
        <ChevronRight aria-hidden="true" className="work-sum-chev" />
        <Brain aria-hidden="true" />
        {spent ? `Thought for ${spent}` : "Thinking"}
      </summary>
      <div className="think-body">{text}</div>
    </details>
  );
}

/** The reasoning text a run streamed, joined. */
export function reasoningOf(steps: LogStep[]): string {
  return steps
    .filter((s) => s.kind === "reasoning")
    .map((s) => s.text)
    .join("\n\n")
    .trim();
}

/* 5. Command card ---------------------------------------------------- */

export function CommandCard({ run, seconds }: { run: ShellRun; seconds?: string }) {
  const failed = run.exit !== null && run.exit !== 0;
  const [open, setOpen] = useState(failed || run.output.split("\n").length <= 6);
  return (
    <div className="cmd" data-failed={failed || undefined}>
      <button type="button" className="cmd-head" aria-expanded={open} onClick={() => setOpen((v) => !v)} disabled={!run.output}>
        <SquareTerminal aria-hidden="true" />
        <code>
          <span className="cmd-dollar">$</span> {run.command}
        </code>
        {run.exit !== null && (
          <span className="cmd-exit" data-tone={failed ? "del" : "add"}>
            {failed ? <CircleX aria-hidden="true" /> : <CircleCheck aria-hidden="true" />}
            exit {run.exit}
            {seconds ? ` · ${seconds}` : ""}
          </span>
        )}
      </button>
      {open && run.output && <pre className="cmd-out">{run.output}</pre>}
    </div>
  );
}

/* 6. Test results ---------------------------------------------------- */

export function TestStrip({ pass, fail }: { pass: number; fail: number }) {
  const total = pass + fail || 1;
  return (
    <div className="tests" data-failed={fail > 0 || undefined}>
      <span className="tests-pill" data-tone="add">
        <CircleCheck aria-hidden="true" /> {pass} passed
      </span>
      <span className="tests-pill" data-tone={fail > 0 ? "del" : "mute"}>
        <CircleX aria-hidden="true" /> {fail} failed
      </span>
      <span className="tests-bar" aria-hidden="true">
        <i style={{ width: `${(pass / total) * 100}%` }} />
      </span>
    </div>
  );
}

/* 7. Callouts -------------------------------------------------------- */

const CALLOUT_LOOK: Record<CalloutKind, { label: string; Icon: LucideIcon }> = {
  note: { label: "Note", Icon: Info },
  tip: { label: "Tip", Icon: Lightbulb },
  important: { label: "Important", Icon: MessageSquareWarning },
  warning: { label: "Warning", Icon: TriangleAlert },
  caution: { label: "Caution", Icon: OctagonAlert },
};

function firstText(children: ReactNode): string {
  for (const child of Children.toArray(children)) {
    if (typeof child === "string") {
      if (child.trim()) return child;
      continue;
    }
    if (isValidElement<{ children?: ReactNode }>(child)) return firstText(child.props.children);
  }
  return "";
}

/** Remove the "[!NOTE]" marker from the first text inside the quote. */
function dropMarker(children: ReactNode, strip: (text: string) => string = stripCallout): ReactNode {
  let done = false;
  const walk = (node: ReactNode): ReactNode =>
    Children.map(node, (child) => {
      if (done) return child;
      if (typeof child === "string") {
        if (!child.trim()) return child;
        done = true;
        return strip(child);
      }
      if (isValidElement<{ children?: ReactNode }>(child)) {
        return cloneElement(child as ReactElement<{ children?: ReactNode }>, undefined, walk(child.props.children));
      }
      return child;
    });
  return walk(children);
}

function CalloutBox({ kind, children }: { kind: CalloutKind; children: ReactNode }) {
  const { label, Icon } = CALLOUT_LOOK[kind];
  return (
    <div className="callout" data-kind={kind} role={kind === "warning" || kind === "caution" ? "alert" : "note"}>
      <p className="callout-head">
        <Icon aria-hidden="true" />
        {label}
      </p>
      <div className="callout-body">{children}</div>
    </div>
  );
}

/** "> [!WARNING] text" as a coloured box; a plain quote stays a quote. */
export function Quote({ children }: { children: ReactNode }) {
  const kind = calloutKind(firstText(children));
  if (!kind) return <blockquote>{children}</blockquote>;
  return <CalloutBox kind={kind}>{dropMarker(children)}</CalloutBox>;
}

/** A paragraph starting "Peringatan:" / "Warning:" / "Note:" as a box; null otherwise. */
export function plainCallout(children: ReactNode): ReactNode | null {
  const first = Children.toArray(children)[0];
  if (typeof first !== "string") return null;
  const found = wordCallout(first);
  if (!found) return null;
  const strip = (text: string) => text.slice(found.marker.length);
  return (
    <CalloutBox kind={found.kind}>
      <p>{dropMarker(children, strip)}</p>
    </CalloutBox>
  );
}

/* 10. Mermaid -------------------------------------------------------- */

let mermaidReady: Promise<typeof import("mermaid").default> | null = null;

function loadMermaid(dark: boolean) {
  mermaidReady ??= import("mermaid").then((m) => m.default);
  return mermaidReady.then((mermaid) => {
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "default" });
    return mermaid;
  });
}

/** A ```mermaid block drawn as a diagram; the code shows if it can't be drawn. */
export function MermaidBlock({ code, fallback }: { code: string; fallback: ReactNode }) {
  const id = `mmd-${useId().replace(/[^\w-]/g, "")}`;
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [showCode, setShowCode] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const dark = document.documentElement.classList.contains("dark");
    loadMermaid(dark)
      .then((mermaid) => mermaid.render(id, code))
      .then(({ svg: out }) => {
        if (!cancelled) setSvg(out);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [id, code]);

  if (failed) return <>{fallback}</>;
  return (
    <div className="mmd">
      {svg ? (
        // securityLevel "strict" makes mermaid sanitise its own SVG output.
        <div className="mmd-svg" role="img" aria-label="Diagram" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <p className="mmd-wait">Drawing diagram…</p>
      )}
      <button type="button" className="mmd-toggle" aria-expanded={showCode} onClick={() => setShowCode((v) => !v)}>
        {showCode ? "Hide code" : "Show code"}
      </button>
      {showCode && fallback}
    </div>
  );
}

/* 11. Follow-up buttons ---------------------------------------------- */

/** Clickable next steps; a click sends that text as the next message. */
export function FollowUps({ options, onPick, disabled }: { options: string[]; onPick: (text: string) => void; disabled?: boolean }) {
  if (options.length === 0) return null;
  return (
    <div className="follow" role="group" aria-label="Suggested next steps">
      {options.map((o) => (
        <button key={o} type="button" className="follow-chip" disabled={disabled} onClick={() => onPick(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}

