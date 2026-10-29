"use client";

import Link from "next/link";
import { Children, isValidElement, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import Markdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, Check, Copy, Download, GitCompare, Loader2, MessageSquarePlus, Quote, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Picker } from "@/components/ui/picker";
import { StoryEmpty, StoryPill } from "@/components/history-story";
import type { StoryTone } from "@/components/history-story";
import { useLiveData } from "@/hooks/use-live-data";
import { projectHref, sendJson } from "@/lib/client-api";
import {
  MAX_NOTE_CHARS,
  MAX_PRD_NOTES,
  diffLines,
  headingId,
  prdOutline,
  prdRevisions,
} from "@/lib/prd";
import type { PrdNote, PrdRevision } from "@/lib/prd";
import type { MissionDetailDTO } from "@/lib/types";

type Draft = PrdNote & { key: number };

const STATUS: Record<MissionDetailDTO["status"], { tone: StoryTone; label: string }> = {
  running: { tone: "live", label: "Running" },
  awaiting_plan_approval: { tone: "wait", label: "Needs you" },
  completed: { tone: "done", label: "Done" },
  cancelled: { tone: "off", label: "Cancelled" },
};

function parseDetail(json: unknown): MissionDetailDTO | null {
  const m = (json as { mission?: Record<string, unknown> & { tasks?: unknown[]; artifacts?: unknown[] } })?.mission;
  if (!m) return null;
  return {
    ...(m as unknown as MissionDetailDTO),
    tasks: Array.isArray(m.tasks) ? (m.tasks as MissionDetailDTO["tasks"]) : [],
    artifacts: Array.isArray(m.artifacts) ? (m.artifacts as MissionDetailDTO["artifacts"]) : [],
  };
}

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return Children.toArray(node).map(textOf).join("");
}

function Heading({ as: Tag, children }: { as: "h1" | "h2" | "h3"; children?: ReactNode }) {
  return (
    <Tag id={headingId(textOf(children))} className="scroll-mt-24">
      {children}
    </Tag>
  );
}
const MD_COMPONENTS: Components = {
  h1: ({ children }) => <Heading as="h1">{children}</Heading>,
  h2: ({ children }) => <Heading as="h2">{children}</Heading>,
  h3: ({ children }) => <Heading as="h3">{children}</Heading>,
};

const supportsHighlights = () =>
  typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";

/** /projects/<id>/missions/<missionId>/prd: read, annotate and compare PRD versions. */
export function PrdReview({ projectId, missionId }: { projectId: string; missionId: string }) {
  const detail = useLiveData<MissionDetailDTO | null>(
    `/api/missions/${encodeURIComponent(missionId)}`,
    null,
    parseDetail,
  );
  const mission = detail.source === "live" ? detail.data : null;
  const revisions = useMemo(
    () => (mission ? prdRevisions(mission.artifacts, mission.id) : []),
    [mission],
  );
  const latest = revisions.at(-1) ?? null;
  const writing = mission?.status === "running" && mission.phase === "spec";
  const reviewing = mission?.status === "awaiting_plan_approval";

  // Poll while Scribe writes the next version.
  const { reload } = detail;
  useEffect(() => {
    if (!writing) return;
    const timer = setInterval(reload, 4000);
    return () => clearInterval(timer);
  }, [writing, reload]);

  const [view, setView] = useState<"read" | "compare">("read");
  const [picked, setPicked] = useState<number | null>(null);
  const shown = revisions.find((r) => r.version === picked) ?? latest;
  const canAnnotate = Boolean(reviewing && shown && latest && shown.version === latest.version);

  if (detail.source === "loading") {
    return (
      <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground md:p-8" role="status">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading PRD…
      </p>
    );
  }
  if (!mission) {
    return (
      <div className="p-4 md:p-8">
        <StoryEmpty
          title="Mission not found"
          body={detail.source === "demo" ? detail.reason : "It may have been removed."}
        />
      </div>
    );
  }

  const back = projectHref(projectId, { mission: mission.id });

  return (
    <div className="space-y-6 p-4 md:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <nav aria-label="Breadcrumb" className="mb-1 text-sm text-muted-foreground">
            <Link href={back} className="inline-flex items-center gap-1 hover:text-foreground hover:underline">
              <ArrowLeft className="size-3.5" aria-hidden="true" />
              Mission control
            </Link>
          </nav>
          <h1 className="flex flex-wrap items-center gap-3 text-3xl font-semibold tracking-tight">
            <span className="min-w-0 break-words">{mission.title}</span>
            <StoryPill tone={STATUS[mission.status].tone}>{STATUS[mission.status].label}</StoryPill>
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">Product requirements, written by Scribe PRD.</p>
        </div>
        {shown && <FileActions revision={shown} />}
      </header>

      {writing && (
        <p role="status" className="prd-banner" data-tone="live">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Scribe is writing v{(latest?.version ?? 0) + 1} from your notes. This page updates by itself.
        </p>
      )}

      {!latest ? (
        <StoryEmpty title="No PRD yet" body="Scribe PRD writes it right after the plan. Check back in a minute." />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="prd-seg" role="tablist" aria-label="View">
              <button role="tab" aria-selected={view === "read"} onClick={() => setView("read")}>
                Read
              </button>
              <button
                role="tab"
                aria-selected={view === "compare"}
                disabled={revisions.length < 2}
                title={revisions.length < 2 ? "Appears once there is a second version" : undefined}
                onClick={() => setView("compare")}
              >
                <GitCompare className="size-3.5" aria-hidden="true" />
                Compare versions
              </button>
            </div>
            {view === "read" && revisions.length > 1 && (
              <div className="prd-seg" role="group" aria-label="Version">
                {revisions.map((r) => (
                  <button
                    key={r.version}
                    aria-pressed={shown?.version === r.version}
                    onClick={() => setPicked(r.version)}
                  >
                    v{r.version}
                    {r.version === latest.version && <span className="sr-only"> (latest)</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {view === "read" && shown ? (
            <ReadView
              key={shown.version}
              mission={mission}
              revision={shown}
              isLatest={shown.version === latest.version}
              canAnnotate={canAnnotate}
              onChanged={reload}
            />
          ) : (
            <CompareView revisions={revisions} />
          )}
        </>
      )}
    </div>
  );
}

function FileActions({ revision }: { revision: PrdRevision }) {
  const name = `PRD-v${revision.version}.md`;
  return (
    <div className="flex gap-2">
      <Button
        variant="ghost"
        size="sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(revision.artifact.content);
            toast.success("PRD copied");
          } catch {
            toast.error("Clipboard unavailable. Download the file instead.");
          }
        }}
      >
        <Copy className="size-3" />
        Copy
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          const url = URL.createObjectURL(new Blob([revision.artifact.content], { type: "text/markdown" }));
          const link = document.createElement("a");
          link.href = url;
          link.download = name;
          link.click();
          URL.revokeObjectURL(url);
        }}
      >
        <Download className="size-3" />
        Download
      </Button>
    </div>
  );
}

function ReadView({
  mission,
  revision,
  isLatest,
  canAnnotate,
  onChanged,
}: {
  mission: MissionDetailDTO;
  revision: PrdRevision;
  isLatest: boolean;
  canAnnotate: boolean;
  onChanged: () => void;
}) {
  const content = revision.artifact.content;
  const outline = useMemo(() => prdOutline(content), [content]);
  const article = useRef<HTMLElement>(null);
  const ranges = useRef(new Map<number, Range>());
  const [selection, setSelection] = useState<{ quote: string; range: Range } | null>(null);
  const [notes, setNotes] = useState<Draft[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"revise" | "approve" | null>(null);
  const nextKey = useRef(1);

  // Markdown is memoized so text nodes (and the ranges on them) stay put.
  const doc = useMemo(
    () => (
      <Markdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
        {content}
      </Markdown>
    ),
    [content],
  );

  // Paint quoted passages with the CSS Custom Highlight API where supported.
  useEffect(() => {
    if (!supportsHighlights()) return;
    const live = notes.map((n) => ranges.current.get(n.key)).filter((r): r is Range => Boolean(r));
    if (selection) live.push(selection.range);
    CSS.highlights.set("prd-note", new Highlight(...live));
    return () => {
      CSS.highlights.delete("prd-note");
    };
  }, [notes, selection]);

  function readSelection() {
    if (!canAnnotate) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !article.current) return;
    const range = sel.getRangeAt(0);
    if (!article.current.contains(range.commonAncestorContainer)) return;
    const quote = sel.toString().replace(/\s+/g, " ").trim();
    if (quote) setSelection({ quote, range: range.cloneRange() });
  }

  function addNote() {
    const note = text.trim();
    if (!note || notes.length >= MAX_PRD_NOTES) return;
    const key = nextKey.current++;
    if (selection) ranges.current.set(key, selection.range);
    setNotes((list) => [...list, { key, quote: selection?.quote ?? null, note }]);
    setText("");
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  }

  function removeNote(key: number) {
    ranges.current.delete(key);
    setNotes((list) => list.filter((n) => n.key !== key));
  }

  async function control(action: "revise_prd" | "approve_plan") {
    setBusy(action === "revise_prd" ? "revise" : "approve");
    const res = await sendJson(
      `/api/missions/${encodeURIComponent(mission.id)}/control`,
      "POST",
      action === "revise_prd"
        ? { action, version: revision.version, notes: notes.map(({ quote, note }) => ({ quote, note })) }
        : { action },
    );
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    if (action === "revise_prd") {
      toast.success(`Sent to Scribe. v${revision.version + 1} is on its way.`);
      setNotes([]);
      ranges.current.clear();
    } else {
      toast.success("Plan approved. Tasks start now.");
    }
    onChanged();
  }

  return (
    <div className="prd-grid">
      <nav aria-label="Sections" className="prd-toc">
        {outline.length === 0 ? (
          <span className="text-muted-foreground">No sections</span>
        ) : (
          outline.map((item) => (
            <a key={item.id} href={`#${item.id}`} data-level={item.level}>
              {item.text}
            </a>
          ))
        )}
      </nav>

      <article
        ref={article}
        onMouseUp={readSelection}
        onKeyUp={readSelection}
        className="prd-doc prose prose-sm dark:prose-invert max-w-none"
        aria-label={`PRD version ${revision.version}`}
      >
        {doc}
      </article>

      <aside className="prd-side" aria-label="Review">
        {canAnnotate ? (
          <>
            <h2 className="text-sm font-semibold">What is missing?</h2>
            {notes.length > 0 && (
              <ol className="space-y-2">
                {notes.map((n, i) => (
                  <li key={n.key} className="prd-note">
                    <span className="prd-pin" aria-hidden="true">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      {n.quote && <q className="prd-quote">{n.quote}</q>}
                      <p className="whitespace-pre-wrap break-words">{n.note}</p>
                    </div>
                    <button
                      className="prd-icon-btn"
                      onClick={() => removeNote(n.key)}
                      aria-label={`Remove note ${i + 1}`}
                    >
                      <X className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ol>
            )}
            <div className="prd-draft">
              {selection ? (
                <p className="prd-quote flex items-start gap-1">
                  <Quote className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                  <span className="line-clamp-2 flex-1">{selection.quote}</span>
                  <button className="prd-icon-btn" onClick={() => setSelection(null)} aria-label="Clear selected text">
                    <X className="size-3" />
                  </button>
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">Select text in the PRD to note on it, or write a general note.</p>
              )}
              <label htmlFor="prd-note-text" className="sr-only">
                Note
              </label>
              <textarea
                id="prd-note-text"
                value={text}
                maxLength={MAX_NOTE_CHARS}
                rows={3}
                placeholder='e.g. "Say which error text shows on a wrong password"'
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    addNote();
                  }
                }}
              />
              <Button
                size="sm"
                variant="secondary"
                onClick={addNote}
                disabled={!text.trim() || notes.length >= MAX_PRD_NOTES}
              >
                <MessageSquarePlus className="size-3.5" />
                Add note
              </Button>
            </div>
            <div className="grid gap-2">
              <Button
                variant="secondary"
                onClick={() => void control("revise_prd")}
                disabled={notes.length === 0 || busy !== null}
              >
                {busy === "revise" ? <Loader2 className="size-4 animate-spin" /> : <GitCompare className="size-4" />}
                Request changes{notes.length > 0 ? ` (${notes.length})` : ""}
              </Button>
              <Button onClick={() => void control("approve_plan")} disabled={busy !== null}>
                {busy === "approve" ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                Approve plan
              </Button>
              {notes.length > 0 && (
                <p className="text-xs text-muted-foreground">Approving drops your unsent notes.</p>
              )}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {!isLatest
              ? `This is an older version. Notes go on the latest one.`
              : mission.status === "awaiting_plan_approval"
                ? "Loading…"
                : mission.status === "running" && mission.phase === "spec"
                  ? "Scribe is writing the next version."
                  : "This PRD is no longer waiting for review, so notes are closed."}
          </p>
        )}
        {revision.notes && (
          <details className="prd-past">
            <summary>Notes that revised v{revision.version}</summary>
            <pre className="whitespace-pre-wrap text-xs">{revision.notes.content}</pre>
          </details>
        )}
      </aside>
    </div>
  );
}

function CompareView({ revisions }: { revisions: PrdRevision[] }) {
  const latest = revisions.at(-1)!;
  const [to, setTo] = useState(latest.version);
  const [from, setFrom] = useState(Math.max(1, latest.version - 1));
  const a = revisions.find((r) => r.version === from) ?? revisions[0];
  const b = revisions.find((r) => r.version === to) ?? latest;
  const lines = useMemo(() => diffLines(a.artifact.content, b.artifact.content), [a, b]);
  const versionOptions = revisions.map((r) => ({ value: String(r.version), label: `v${r.version}` }));
  const added = lines.filter((l) => l.type === "add").length;
  const removed = lines.filter((l) => l.type === "del").length;

  return (
    <div className="prd-compare">
      <ol className="prd-timeline" aria-label="Versions">
        {[...revisions].reverse().map((r) => (
          <li key={r.version} data-current={r.version === to || r.version === from}>
            <span className="font-semibold">v{r.version}</span>
            <span className="text-xs text-muted-foreground">
              {r.artifact.createdAt ? new Date(r.artifact.createdAt).toLocaleString() : ""}
            </span>
            {r.notes && (
              <details>
                <summary className="text-xs">Your notes on v{r.version}</summary>
                <pre className="whitespace-pre-wrap text-xs">{r.notes.content}</pre>
              </details>
            )}
          </li>
        ))}
      </ol>
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="flex items-center gap-1.5">
            From
            <Picker
              size="sm"
              aria-label="Compare from version"
              value={String(a.version)}
              onChange={(v) => setFrom(Number(v))}
              options={versionOptions}
            />
          </span>
          <span className="flex items-center gap-1.5">
            to
            <Picker
              size="sm"
              aria-label="Compare to version"
              value={String(b.version)}
              onChange={(v) => setTo(Number(v))}
              options={versionOptions}
            />
          </span>
          <span className="text-muted-foreground">
            <span className="text-status-success">+{added}</span> <span className="text-status-danger">−{removed}</span>{" "}
            lines
          </span>
        </div>
        <pre className="prd-diff" aria-label={`Changes from v${a.version} to v${b.version}`}>
          {a.version === b.version ? (
            <span className="text-muted-foreground">Pick two different versions.</span>
          ) : (
            lines.map((l, i) => (
              <span key={i} data-type={l.type}>
                <span className="sr-only">{l.type === "add" ? "Added: " : l.type === "del" ? "Removed: " : ""}</span>
                <span aria-hidden="true">{l.type === "add" ? "+ " : l.type === "del" ? "− " : "  "}</span>
                {l.text || " "}
                {"\n"}
              </span>
            ))
          )}
        </pre>
      </div>
    </div>
  );
}
