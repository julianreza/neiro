"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatTokens, timeAgo } from "@/lib/client-api";
import type { MissionStatus, MissionSummaryDTO } from "@/lib/types";

const PAGE = 25;

const FILTERS: { id: string; label: string; status: MissionStatus[] | null }[] = [
  { id: "all", label: "All", status: null },
  { id: "completed", label: "Completed", status: ["completed"] },
  { id: "cancelled", label: "Cancelled", status: ["cancelled"] },
  { id: "active", label: "Running", status: ["running", "awaiting_plan_approval"] },
];

const STATUS_TEXT: Record<MissionStatus, { label: string; className: string }> = {
  completed: { label: "Completed", className: "text-emerald-600 dark:text-emerald-400" },
  cancelled: { label: "Cancelled", className: "text-muted-foreground" },
  running: { label: "Running", className: "text-primary" },
  awaiting_plan_approval: { label: "Waiting for plan approval", className: "text-amber-600 dark:text-amber-400" },
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
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8">
      <h1 className="text-2xl font-semibold">History</h1>
      <p className="text-sm text-muted-foreground">Every mission, newest first.</p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <label htmlFor="history-search" className="sr-only">
            Search missions by title
          </label>
          <Input
            id="history-search"
            type="search"
            placeholder="Search missions"
            className="pl-8"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className="h-8 rounded-full border px-3 text-sm aria-pressed:border-primary aria-pressed:text-primary"
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

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
        <div className="mt-6 rounded-2xl border bg-card p-8 text-center text-card-foreground">
          <p className="font-medium">No missions match</p>
          <p className="text-sm text-muted-foreground">Try another filter, or start a mission on Mission control.</p>
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-2xl border bg-card text-card-foreground">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Mission</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 text-right font-medium">Tasks</th>
                <th className="px-4 py-2.5 text-right font-medium">Tokens</th>
                <th className="px-4 py-2.5 font-medium">Started</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const status = STATUS_TEXT[m.status] ?? STATUS_TEXT.running;
                const over = m.tokenBudget ? m.totalTokens >= m.tokenBudget : false;
                return (
                  <tr key={m.id} className="border-b last:border-0 hover:bg-secondary/40">
                    <td className="max-w-[320px] px-4 py-2.5">
                      <Link href={`/?mission=${encodeURIComponent(m.id)}`} className="block truncate font-medium hover:underline">
                        {m.title}
                      </Link>
                    </td>
                    <td className={`px-4 py-2.5 ${status.className}`}>{status.label}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {m.completedTasks}/{m.totalTasks}
                    </td>
                    <td className={`px-4 py-2.5 text-right tabular-nums ${over ? "text-orange-600 dark:text-orange-400" : ""}`}>
                      {formatTokens(m.totalTokens)}
                      {m.tokenBudget ? <span className="text-muted-foreground"> / {formatTokens(m.tokenBudget)}</span> : null}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground" title={m.createdAt}>
                      {timeAgo(m.createdAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
