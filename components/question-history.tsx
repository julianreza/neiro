"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AgentBot, agentLook } from "@/components/agent-bot";
import {
  STORY_ROLE,
  StoryDay,
  StoryEmpty,
  StoryPill,
  StoryToolbar,
  groupByDay,
} from "@/components/history-story";
import type { StoryTone } from "@/components/history-story";
import { formatTokens, timeAgo } from "@/lib/client-api";
import { splitAnswerFiles } from "@/lib/ask-history";
import type { AskQuestionDTO, AskStatus } from "@/lib/ask-history";

const PAGE = 25;
/** How often the list re-reads while a question is still being answered. */
const RUNNING_POLL_MS = 10_000;

/** Answers longer than this start folded, with a button to read the rest. */
const FOLD_AT = 420;

const STATUS_PILL: Record<AskStatus, { tone: StoryTone; label: string }> = {
  completed: { tone: "done", label: "Answered" },
  running: { tone: "live", label: "Answering" },
  failed: { tone: "bad", label: "Failed" },
  stopped: { tone: "off", label: "Stopped" },
};

type Page = { questions: AskQuestionDTO[]; nextBefore: string | null };

function questionsUrl(q: string, before: string | null) {
  const params = new URLSearchParams({ limit: String(PAGE) });
  if (q.trim()) params.set("q", q.trim());
  if (before) params.set("before", before);
  return `/api/questions?${params}`;
}

async function fetchPage(url: string): Promise<Page> {
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : `Couldn't load (${res.status})`);
  return { questions: Array.isArray(data.questions) ? data.questions : [], nextBefore: data.nextBefore ?? null };
}

export function QuestionHistory() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [rows, setRows] = useState<AskQuestionDTO[] | null>(null);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    fetchPage(questionsUrl(debounced, null))
      .then((page) => {
        if (cancelled) return;
        setError(null);
        setRows(page.questions);
        setNextBefore(page.nextBefore);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  const anyRunning = rows?.some((row) => row.status === "running") ?? false;

  // Fold fresh copies of the newest page into the list, so an answer lands without a reload.
  const refresh = useCallback(async () => {
    try {
      const page = await fetchPage(questionsUrl(debounced, null));
      const fresh = new Map(page.questions.map((row) => [row.id, row]));
      setRows((list) => {
        if (!list) return page.questions;
        const known = new Set(list.map((row) => row.id));
        const added = page.questions.filter((row) => !known.has(row.id));
        return [...added, ...list.map((row) => fresh.get(row.id) ?? row)];
      });
    } catch (err: unknown) {
      console.warn("[questions] refresh failed", err);
    }
  }, [debounced]);

  useEffect(() => {
    if (!anyRunning) return;
    const timer = setInterval(() => void refresh(), RUNNING_POLL_MS);
    return () => clearInterval(timer);
  }, [anyRunning, refresh]);

  async function loadMore() {
    if (!nextBefore) return;
    setLoadingMore(true);
    try {
      const page = await fetchPage(questionsUrl(debounced, nextBefore));
      setRows((list) => [...(list ?? []), ...page.questions]);
      setNextBefore(page.nextBefore);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Couldn't load more");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div>
      <StoryToolbar>
        <div className="story-search-wrap">
          <Search aria-hidden="true" className="story-search-icon" />
          <label htmlFor="question-search" className="sr-only">
            Search questions
          </label>
          <Input
            id="question-search"
            type="search"
            placeholder="Search questions"
            className="story-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </StoryToolbar>

      {error && (
        <p role="alert" className="mt-4 rounded-xl border border-destructive/40 p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {rows === null && !error && (
        <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </p>
      )}
      {rows && rows.length === 0 && (
        <StoryEmpty
          title={debounced ? "No questions match" : "No questions yet"}
          body={
            debounced ? (
              "Try other words."
            ) : (
              <>
                Pick Ask a question on{" "}
                <Link href="/" className="text-primary hover:underline">
                  Mission control
                </Link>
                . The answer is saved here.
              </>
            )
          }
        />
      )}

      {rows && rows.length > 0 && (
        <div className="story-feed">
          {groupByDay(rows, (row) => row.createdAt).map((group) => (
            <section key={group.day} className="story-group" aria-label={group.day}>
              <StoryDay day={group.day} count={group.rows.length} noun={["question", "questions"]} />
              <ol className="story-list">
                {group.rows.map((row) => (
                  <QuestionStory key={row.id} row={row} />
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
          <span>Showing {rows.length}</span>
          {nextBefore && (
            <Button variant="outline" size="sm" disabled={loadingMore} onClick={() => void loadMore()}>
              {loadingMore ? "Loading…" : "Load older"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function QuestionStory({ row }: { row: AskQuestionDTO }) {
  const [open, setOpen] = useState(false);
  const answer = splitAnswerFiles(row.answer);
  const long = answer.body.length > FOLD_AT;
  const panelId = `answer-${row.id}`;
  const asleep = row.status === "failed" || row.status === "stopped";
  const meta = [row.tokens ? `${formatTokens(row.tokens)} tokens` : null, row.workspacePath.split("/").filter(Boolean).pop() ?? row.workspacePath]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="story-pair" data-status={row.status}>
      <div className="story-ask">
        <p className="story-ask-text">{row.question}</p>
        <span className="story-meta" title={row.createdAt}>
          You · {timeAgo(row.createdAt)}
          {row.followUpOf ? " · follow-up" : null}
        </span>
      </div>

      <div className="story" style={agentLook(STORY_ROLE)}>
        <span className="story-bot">
          <AgentBot name={row.agentName || "PM"} role={STORY_ROLE} asleep={asleep} working={row.status === "running"} />
        </span>
        <div className="story-bubble" data-folded={long && !open ? true : undefined}>
          <span className="story-top">
            <span className="story-meta">{row.agentName || "PM"}</span>
            <StoryPill tone={STATUS_PILL[row.status].tone}>{STATUS_PILL[row.status].label}</StoryPill>
          </span>
          {row.status === "running" && !answer.body && (
            <p className="story-text">
              Reading the project
              <span className="story-thinking" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            </p>
          )}
          {answer.body && (
            <div id={panelId} className="story-md story-answer">
              <Markdown remarkPlugins={[remarkGfm]}>{answer.body}</Markdown>
            </div>
          )}
          {!answer.body && row.status === "completed" && <p className="story-text">I had nothing to say for this one.</p>}
          {row.status === "failed" && (
            <p className="story-text text-destructive">I couldn&apos;t answer this. {row.error}</p>
          )}
          {row.status === "stopped" && <p className="story-text">You stopped this question.</p>}

          {long && (
            <button
              type="button"
              className="story-more"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => setOpen((v) => !v)}
            >
              {open ? "Show less" : "Read the full answer"}
            </button>
          )}
          {(open || !long) && answer.files.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Files read">
              {answer.files.map((file) => (
                <li key={file}>
                  <code className="code-chip">{file}</code>
                </li>
              ))}
            </ul>
          )}
          <span className="story-meta" title={row.workspacePath}>
            {meta}
          </span>
        </div>
      </div>
    </li>
  );
}
