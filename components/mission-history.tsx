"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import { History as HistoryIcon, Loader2, MessageCircleQuestionMark, Rocket, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AgentBot, agentLook } from "@/components/agent-bot";
import { QuestionHistory } from "@/components/question-history";
import {
  STORY_ROLE,
  StoryDay,
  StoryEmpty,
  StoryPill,
  StoryToolbar,
  compactTokens,
  groupByDay,
} from "@/components/history-story";
import type { StoryTone } from "@/components/history-story";
import { timeAgo } from "@/lib/client-api";
import { STATIONS, railStops } from "@/lib/mission-rail";
import type { MissionStatus, MissionSummaryDTO } from "@/lib/types";

const PAGE = 25;

const FILTERS: { id: string; label: string; tone: StoryTone | null; status: MissionStatus[] | null }[] = [
  { id: "all", label: "All", tone: null, status: null },
  { id: "active", label: "Running", tone: "live", status: ["running", "awaiting_plan_approval"] },
  { id: "completed", label: "Completed", tone: "done", status: ["completed"] },
  { id: "cancelled", label: "Cancelled", tone: "off", status: ["cancelled"] },
];

const STATUS_PILL: Record<MissionStatus, { tone: StoryTone; label: string }> = {
  completed: { tone: "done", label: "Completed" },
  running: { tone: "live", label: "Running" },
  awaiting_plan_approval: { tone: "wait", label: "Needs you" },
  cancelled: { tone: "off", label: "Cancelled" },
};

type Page = { missions: MissionSummaryDTO[]; nextBefore: string | null };

function historyUrl(filter: string, q: string, before: string | null) {
  const params = new URLSearchParams({ limit: String(PAGE) });
  const status = FILTERS.find((f) => f.id === filter)?.status;
  if (status) params.set("status", status.join(","));
  if (q.trim()) params.set("q", q.trim());
  if (before) params.set("before", before);
  return `/api/missions?${params}`;
}

async function fetchPage(url: string): Promise<Page> {
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : `Couldn't load (${res.status})`);
  return { missions: Array.isArray(data.missions) ? data.missions : [], nextBefore: data.nextBefore ?? null };
}

export function MissionHistory() {
  const [tab, setTab] = useState("missions");

  return (
    <div className="w-full p-4 md:p-8">
      <Tabs value={tab} onValueChange={setTab}>
        <div className="history-head">
          <span className="history-mark" aria-hidden="true">
            <HistoryIcon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight">History</h1>
            <p className="text-sm text-muted-foreground">
              {tab === "missions" ? "What the team did, newest first." : "Every question you asked, newest first."}
            </p>
          </div>
          <TabsList aria-label="What to show" className="history-seg">
            <TabsTrigger value="missions">
              <Rocket aria-hidden="true" />
              Missions
            </TabsTrigger>
            <TabsTrigger value="questions">
              <MessageCircleQuestionMark aria-hidden="true" />
              Questions
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="missions">
          <MissionsPanel />
        </TabsContent>
        <TabsContent value="questions">
          <QuestionHistory />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function MissionsPanel() {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [rows, setRows] = useState<MissionSummaryDTO[] | null>(null);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    fetchPage(historyUrl(filter, debounced, null))
      .then((page) => {
        if (cancelled) return;
        setError(null);
        setRows(page.missions);
        setNextBefore(page.nextBefore);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [filter, debounced]);

  async function loadMore() {
    if (!nextBefore) return;
    setLoadingMore(true);
    try {
      const page = await fetchPage(historyUrl(filter, debounced, nextBefore));
      setRows((list) => [...(list ?? []), ...page.missions]);
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
          <label htmlFor="history-search" className="sr-only">
            Search missions by title
          </label>
          <Input
            id="history-search"
            type="search"
            placeholder="Search missions"
            className="story-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div role="group" aria-label="Filter by status" className="story-chips">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className="story-chip"
              data-tone={f.tone ?? undefined}
            >
              {f.tone && <i aria-hidden="true" />}
              {f.label}
            </button>
          ))}
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
          title="No missions match"
          body={<>Try another filter, or start a mission on <Link href="/" className="text-primary hover:underline">Mission control</Link>.</>}
        />
      )}

      {rows && rows.length > 0 && (
        <div className="story-feed">
          {groupByDay(rows, (m) => m.createdAt ?? "").map((group) => (
            <section key={group.day} className="story-group" aria-label={group.day}>
              <StoryDay day={group.day} count={group.rows.length} noun={["mission", "missions"]} />
              <RailLegend />
              <ol className="rail-list">
                {group.rows.map((m) => (
                  <MissionRail key={m.id} mission={m} />
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
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

/** Station names, lined up above the rails on wide screens. */
function RailLegend() {
  return (
    <div className="rail-legend" aria-hidden="true">
      <span />
      <span className="rail-legend-stops">
        {STATIONS.map((s) => (
          <span key={s.phase}>{s.label}</span>
        ))}
      </span>
      <span />
    </div>
  );
}

function MissionRail({ mission: m }: { mission: MissionSummaryDTO }) {
  const { at, states, note } = railStops(m);
  const pill = STATUS_PILL[m.status] ?? { tone: "live" as StoryTone, label: m.status };
  const over = m.tokenBudget ? m.totalTokens >= m.tokenBudget : false;
  const meta = [
    `${m.completedTasks}/${m.totalTasks} tasks`,
    m.totalTokens ? `${compactTokens(m.totalTokens)} tokens` : null,
    timeAgo(m.createdAt),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="rail-card" data-status={m.status} style={agentLook(STORY_ROLE)}>
      <div className="rail-title">
        <Link href={`/?mission=${encodeURIComponent(m.id)}`} className="rail-link">
          {m.title}
        </Link>
        <span className="story-meta" title={m.createdAt}>
          {meta}
        </span>
        {over && <span className="story-warn">Used its whole token budget.</span>}
      </div>

      <div className="rail-track" style={{ "--at": at / (STATIONS.length - 1) } as CSSProperties}>
        <span className="rail-line" />
        <span className="rail-fill" />
        {STATIONS.map((s, i) => (
          <span key={s.phase} className="rail-stop" data-state={states[i]}>
            <i />
            <small>{s.label}</small>
          </span>
        ))}
        <span className="rail-bot">
          <AgentBot name="PM" role={STORY_ROLE} asleep={m.status === "cancelled"} working={m.status === "running"} />
        </span>
        <span className="sr-only">{note}.</span>
      </div>

      <StoryPill tone={pill.tone}>{pill.label}</StoryPill>
    </li>
  );
}
