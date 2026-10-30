"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { DataSourceBadge } from "@/components/data-source-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLiveData } from "@/hooks/use-live-data";
import { PIPE_STAGES, TOKEN_DAYS } from "@/lib/dashboard";
import type { AgentTokens, DashboardSnapshot } from "@/lib/dashboard";

const POLL_MS = 15_000;

const demoSnapshot: DashboardSnapshot = {
  counts: { plan: 1, spec: 1, code: 2, qa: 1, review: 0, done: 7 },
  items: [],
  missions: [],
  activity: [],
  tokens: [12400, 18200, 6100, 0, 24800, 15300, 31200, 9800, 0, 22100, 27400, 14900, 36800, 41200],
  agentTokens: [
    { id: "dev", name: "Dev", tokens: 112000 },
    { id: "qa", name: "QA", tokens: 64000 },
    { id: "spec", name: "Spec", tokens: 41000 },
    { id: "rev", name: "Reviewer", tokens: 23000 },
    { id: "others", name: "Others", tokens: 20200 },
  ],
  modelTokens: [
    { id: "m1", name: "claude-sonnet-4.5", tokens: 150000 },
    { id: "m2", name: "gpt-5", tokens: 80000 },
    { id: "m3", name: "deepseek-3.2", tokens: 30200 },
  ],
  runtimeTokens: [
    { id: "hermes", name: "Hermes", tokens: 182000 },
    { id: "ohmypi", name: "OMP", tokens: 78200 },
  ],
  unsplitTokens: 0,
};

/** One colour per agent row, in order. */
const SLICE_COLORS = ["#d946ef", "#06b6d4", "#f59e0b", "#22c55e", "#6366f1"];
/** Tokens no agent or model is credited with. Dark enough for white text on it. */
const UNSPLIT_COLOR = "#64748b";
/** Model bars use their own colours so they are not read as agents. */
const MODEL_COLORS = ["#6366f1", "#22c55e", "#f97316", "#0ea5e9", "#ec4899"];
/** Keyed by runtime id, as tokensByRuntime returns it. */
const RUNTIME_COLORS: Record<string, string> = { hermes: "#8b5cf6", ohmypi: "#0ea5e9", antigravity: "#f97316" };

function parseSnapshot(json: unknown): DashboardSnapshot {
  const body = json as Partial<DashboardSnapshot> | null;
  if (
    !body?.counts ||
    !Array.isArray(body.items) ||
    !Array.isArray(body.missions) ||
    !Array.isArray(body.activity) ||
    !Array.isArray(body.tokens)
  ) {
    throw new Error("Malformed /api/dashboard response");
  }
  return {
    ...body,
    agentTokens: Array.isArray(body.agentTokens) ? body.agentTokens : [],
    modelTokens: Array.isArray(body.modelTokens) ? body.modelTokens : [],
    runtimeTokens: Array.isArray(body.runtimeTokens) ? body.runtimeTokens : [],
    unsplitTokens: Number(body.unsplitTokens) || 0,
  } as DashboardSnapshot;
}

function usePolled<T>(url: string, demo: T, parse: (json: unknown) => T) {
  const live = useLiveData(url, demo, parse);
  const { reload } = live;
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") reload();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [reload]);
  return live;
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

/** Local dates of the chart's bars, oldest first; the last one is today. */
function chartDays(count: number): Date[] {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (count - 1 - i));
    return d;
  });
}

const Loading = () => <p className="text-sm text-muted-foreground">Loading…</p>;

function TokenChart({ tokens }: { tokens: number[] }) {
  const days = chartDays(tokens.length);
  const max = Math.max(1, ...tokens);
  const total = tokens.reduce((a, b) => a + b, 0);
  const today = tokens.at(-1) ?? 0;
  const last = tokens.length - 1;

  return (
    <>
      <div className="dash-head">
        <div className="grid gap-1">
          <h2 id="dash-tokens" className="eyebrow">Tokens per day</h2>
          <b className="dash-count">{compact(total)}</b>
          <span className="text-xs text-muted-foreground">last {tokens.length} days</span>
        </div>
        <div className="dash-today">
          <span className="eyebrow">Today</span>
          <b className="dash-count">{compact(today)}</b>
        </div>
      </div>
      <ol className="dash-days" aria-label="Tokens per day">
        {tokens.map((n, i) => {
          const day = days[i];
          const isToday = i === last;
          const date = day.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
          const pct = n === 0 ? 3 : Math.max(6, (n / max) * 100);
          return (
            <li
              key={day.toISOString()}
              data-today={isToday || undefined}
              data-empty={n === 0 || undefined}
              style={{ "--h": `${pct}%`, "--i": i } as CSSProperties}
            >
              <div className="dash-day-col">
                {isToday && n > 0 && <span className="dash-day-value">{compact(n)}</span>}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="dash-day-bar" tabIndex={0} aria-label={`${date}: ${n.toLocaleString()} tokens`} />
                  </TooltipTrigger>
                  <TooltipContent>{`${date} · ${n.toLocaleString()} tokens`}</TooltipContent>
                </Tooltip>
              </div>
              <span className="dash-day-label" aria-hidden="true">
                {isToday ? "Today" : day.toLocaleDateString(undefined, { day: "numeric" })}
              </span>
            </li>
          );
        })}
      </ol>
    </>
  );
}

type TokenView = "runtime" | "agent" | "model";

const TOKEN_VIEWS: { id: TokenView; label: string }[] = [
  { id: "runtime", label: "Runtime" },
  { id: "agent", label: "Agent" },
  { id: "model", label: "Model" },
];

function AgentTokensCard({ agents, models, runtimes, unsplit, days, error }: {
  agents: AgentTokens[];
  models: AgentTokens[];
  runtimes: AgentTokens[];
  unsplit: number;
  days: number;
  error?: string;
}) {
  const [view, setView] = useState<TokenView>("runtime");
  const total = agents.reduce((s, r) => s + r.tokens, 0) + unsplit;
  // Chats from before the model was saved land in "Not recorded"; that is the
  // same "older runs" bucket as the unsplit mission tokens, so show one gray row.
  const NOT_RECORDED = "model:Not recorded";
  const listed = view === "runtime" ? runtimes : view === "agent" ? agents : models;
  const rows = listed.filter((r) => r.id !== NOT_RECORDED);
  const older = unsplit + (listed.find((r) => r.id === NOT_RECORDED)?.tokens ?? 0);
  const olderLabel = view === "model" ? "Not recorded (older runs)" : "Not split (older runs)";
  const palette = view === "agent" ? SLICE_COLORS : MODEL_COLORS;
  const colorOf = (id: string, i: number) =>
    view === "runtime" ? RUNTIME_COLORS[id] ?? "#94a3b8" : palette[i % palette.length];

  return (
    <>
      <div className="dash-head">
        <div className="grid gap-1">
          <h2 id="dash-agent-tokens" className="eyebrow">Tokens per agent &amp; model</h2>
          <span className="text-xs text-muted-foreground">last {days} days</span>
        </div>
        {!error && total > 0 && <b className="dash-count">{compact(total)}</b>}
      </div>
      {error ? (
        <p className="text-sm text-muted-foreground">
          Per-agent tokens are not available yet. Run the <code className="code-chip">agent_token_usage</code> migration in Supabase.
        </p>
      ) : total === 0 ? (
        <p className="text-sm text-muted-foreground">
          No agent used tokens in the last {days} days. Counting starts with the next run.
        </p>
      ) : (
        <>
          <div className="dash-tabs" role="tablist" aria-label="Split tokens by">
            {TOKEN_VIEWS.map((v) => (
              <button
                key={v.id}
                type="button"
                role="tab"
                id={`dash-tab-${v.id}`}
                aria-selected={view === v.id}
                aria-controls="dash-token-panel"
                className="dash-tab"
                onClick={() => setView(v.id)}
              >
                {v.label}
              </button>
            ))}
          </div>
          <ul
            key={view}
            id="dash-token-panel"
            role="tabpanel"
            aria-labelledby={`dash-tab-${view}`}
            className="dash-fill-list"
          >
            {rows.map((r, i) => (
              <FillRow key={r.id} name={r.name} tokens={r.tokens} total={total} color={colorOf(r.id, i)} index={i} mono={view === "model"} />
            ))}
            {older > 0 && (
              <FillRow name={olderLabel} tokens={older} total={total} color={UNSPLIT_COLOR} index={rows.length} />
            )}
          </ul>
        </>
      )}
    </>
  );
}

/**
 * A row whose background fills to its share of the total. The label is drawn
 * twice: dark on the empty part, white on the filled part, so it reads on both.
 */
function FillRow({ name, tokens, total, color, index, mono = false }: {
  name: string;
  tokens: number;
  total: number;
  color: string;
  index: number;
  mono?: boolean;
}) {
  const pct = total > 0 ? (tokens / total) * 100 : 0;
  const text = (
    <>
      <span className={`min-w-0 truncate ${mono ? "font-mono text-xs" : ""}`}>{name}</span>
      <span className="shrink-0 tabular-nums">
        {compact(tokens)} · <b>{Math.round(pct)}%</b>
      </span>
    </>
  );
  return (
    <li
      className="dash-fill-row"
      style={{ "--p": `${Math.max(pct, 1.5)}%`, "--c": color, "--i": index } as CSSProperties}
      aria-label={`${name}: ${tokens.toLocaleString()} tokens, ${Math.round(pct)}%`}
    >
      <span className="dash-fill-bar" aria-hidden="true" />
      <span className="dash-fill-text" aria-hidden="true">{text}</span>
      <span className="dash-fill-text dash-fill-on" aria-hidden="true">{text}</span>
    </li>
  );
}

export function DashboardHome() {
  const board = usePolled("/api/dashboard", demoSnapshot, parseSnapshot);
  const snap = board.source === "loading" ? null : board.data;

  const open = snap ? PIPE_STAGES.filter((s) => s !== "done").reduce((n, s) => n + snap.counts[s], 0) : 0;
  const waiting = snap?.items.filter((i) => i.waiting).length ?? 0;

  return (
    <div className="w-full px-4 py-6 md:px-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {snap === null
              ? "Loading…"
              : open === 0
                ? "Nothing is running right now."
                : `${open} in progress${waiting > 0 ? `, ${waiting} waiting for you` : ""}.`}
          </p>
        </div>
        {board.source === "demo" && <DataSourceBadge source="demo" reason={board.reason} />}
      </div>

      <div className="dash-token-grid mt-6">
        <section aria-labelledby="dash-tokens" className="dash-card dash-tokens" data-tone="tokens">
          {snap === null ? <Loading /> : <TokenChart tokens={snap.tokens.slice(-TOKEN_DAYS)} />}
        </section>
        <section aria-labelledby="dash-agent-tokens" className="dash-card dash-tokens" data-tone="tokens">
          {snap === null ? <Loading /> : <AgentTokensCard
              agents={snap.agentTokens}
              models={snap.modelTokens}
              runtimes={snap.runtimeTokens}
              unsplit={snap.unsplitTokens}
              days={TOKEN_DAYS}
              error={snap.agentTokensError}
            />}
        </section>
      </div>
    </div>
  );
}
