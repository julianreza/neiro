"use client";

import Link from "next/link";
import { useEffect } from "react";
import type { CSSProperties, ReactNode } from "react";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { AgentBot, agentLook, botRoles, followPointer, resetPointer, roleForAgent } from "@/components/agent-bot";
import { DataSourceBadge } from "@/components/data-source-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLiveData } from "@/hooks/use-live-data";
import { missionHref, timeAgo } from "@/lib/client-api";
import { PIPE_LABELS, PIPE_STAGES, TOKEN_HOURS } from "@/lib/dashboard";
import type { DashboardSnapshot, PipeItem, PipeStage } from "@/lib/dashboard";
import type { NeedsYouItem, NeedsYouKind } from "@/lib/needs-you";

const POLL_MS = 15_000;
const MAX_BOTS = 12;
const MAX_ASKS = 3;

type TeamAgent = { id: string; name: string; role: string; enabled: boolean; activeRun: boolean };

const ASK_LABEL: Record<NeedsYouKind, string> = {
  plan_approval: "Approve plan",
  pick_agent: "Pick an agent",
  budget: "Budget reached",
  task_failed: "Task failed",
  mission_error: "Mission stuck",
};

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

const demoSnapshot: DashboardSnapshot = {
  counts: { plan: 1, spec: 1, code: 2, qa: 1, review: 0, done: 7 },
  items: [
    { id: "d1", missionId: "d1", title: "Add a schedules page", stage: "plan", waiting: false },
    { id: "d2", missionId: "d2", title: "Restyle login", stage: "spec", waiting: true },
    { id: "d3", missionId: "d3", title: "Build the API", stage: "code", waiting: false },
    { id: "d4", missionId: "d3", title: "Fix the form", stage: "code", waiting: true },
    { id: "d5", missionId: "d3", title: "Write tests", stage: "qa", waiting: false },
  ],
  missions: [
    { id: "d3", title: "Build the API", stage: "code", waiting: true, done: 3, total: 5 },
    { id: "d2", title: "Restyle login", stage: "spec", waiting: true, done: 0, total: 0 },
    { id: "d1", title: "Add a schedules page", stage: "plan", waiting: false, done: 0, total: 0 },
  ],
  activity: [
    { id: "a1", missionId: "d3", title: "Write tests", label: "In QA", tone: "running", at: minutesAgo(2) },
    { id: "a2", missionId: "d3", title: "Fix the form", label: "Needs you", tone: "waiting", at: minutesAgo(9) },
    { id: "a3", missionId: "d3", title: "Login route", label: "Done", tone: "done", at: minutesAgo(25) },
    { id: "a4", missionId: "d3", title: "Build the API", label: "Coding", tone: "running", at: minutesAgo(40) },
  ],
  tokens: [0, 1200, 800, 0, 3400, 5200, 2100, 0, 6100, 4800, 9200, 7300],
};

const demoTeam: TeamAgent[] = [
  { id: "pm", name: "PM", role: "PM", enabled: true, activeRun: true },
  { id: "spec", name: "Spec", role: "Spec writer", enabled: true, activeRun: false },
  { id: "dev", name: "Dev", role: "Developer", enabled: true, activeRun: true },
  { id: "qa", name: "QA", role: "QA", enabled: true, activeRun: true },
  { id: "rev", name: "Reviewer", role: "Reviewer", enabled: true, activeRun: false },
  { id: "ops", name: "Ops", role: "Scheduler", enabled: false, activeRun: false },
];

const demoAsks: NeedsYouItem[] = [
  { kind: "plan_approval", missionId: "d2", missionTitle: "Restyle login", taskId: null, taskTitle: null, detail: "", since: null },
  { kind: "task_failed", missionId: "d3", missionTitle: "Build the API", taskId: "d4", taskTitle: "Fix the form", detail: "", since: null },
];

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
  return body as DashboardSnapshot;
}

function parseTeam(json: unknown): TeamAgent[] {
  const rows = (json as { agents?: Record<string, unknown>[] } | null)?.agents;
  if (!Array.isArray(rows)) throw new Error("Malformed /api/agents response");
  return rows.map((row) => ({
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    role: String(row.role ?? ""),
    enabled: Boolean(row.enabled ?? true),
    activeRun: Boolean(row.activeRun ?? row.active_run ?? false),
  }));
}

function parseAsks(json: unknown): NeedsYouItem[] {
  const items = (json as { items?: NeedsYouItem[] } | null)?.items;
  if (!Array.isArray(items)) throw new Error("Malformed /api/needs-you response");
  return items;
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

/** Demo rows must not link to missions that do not exist. */
function MaybeLink({ demo, href, className, children, ...rest }: {
  demo: boolean;
  href: string;
  className: string;
  children?: ReactNode;
  style?: CSSProperties;
  "aria-label"?: string;
  "data-waiting"?: true;
}) {
  return demo ? (
    <span className={className} {...rest}>{children}</span>
  ) : (
    <Link href={href} className={className} {...rest}>{children}</Link>
  );
}

function PipeDot({ item, index, demo }: { item: PipeItem; index: number; demo: boolean }) {
  const style = { "--dot-delay": `${-(index * 1.7) % 6}s`, "--dot-row": index % 3 } as CSSProperties;
  const label = `${item.title} · ${PIPE_LABELS[item.stage]}${item.waiting ? " · waiting for you" : ""}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <MaybeLink
          demo={demo}
          href={missionHref(item.missionId)}
          className="dash-dot"
          data-waiting={item.waiting || undefined}
          style={style}
          aria-label={label}
        />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function CardHead({ id, title, href, link, children }: {
  id: string;
  title: string;
  href?: string;
  link?: string;
  children?: ReactNode;
}) {
  return (
    <div className="dash-head">
      <div className="grid min-w-0 content-start gap-1">
        <h2 id={id} className="eyebrow">{title}</h2>
        {children}
        {href && (
          <Link href={href} className="dash-more">
            {link} <ArrowRight aria-hidden="true" className="size-3.5" />
          </Link>
        )}
      </div>
    </div>
  );
}

/** Dashboard card; the team card tilts its robots toward the pointer. */
function Card({ tone, label, className = "", children }: {
  tone: string;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={label}
      className={`dash-card ${className}`}
      data-tone={tone}
      onPointerMove={followPointer}
      onPointerLeave={resetPointer}
    >
      {children}
    </section>
  );
}

const Loading = () => <p className="text-sm text-muted-foreground">Loading…</p>;

const MIN_DESKS = 4;

/** The bot role whose colours this agent wears. */
const lookRole = (a: TeamAgent) => (botRoles.includes(a.role) ? a.role : roleForAgent(a.name || a.role));

/** Mini office: working agents sit at a desk with a lit monitor,
 *  everyone else rests on the lounge sofa. */
function TeamOffice({ agents, extra }: { agents: TeamAgent[]; extra: number }) {
  const atDesk = agents.filter((a) => a.enabled && a.activeRun);
  const resting = agents.filter((a) => !(a.enabled && a.activeRun));
  const empty = Math.max(0, MIN_DESKS - atDesk.length);

  return (
    <>
      <div className="dash-floor" aria-label="Desks">
        {atDesk.map((a) => (
          <div key={a.id} className="dash-desk">
            <div className="dash-bot" style={agentLook(lookRole(a))}>
              <AgentBot name={a.name} role={lookRole(a)} asleep={false} working />
            </div>
            <div className="dash-table"><span className="dash-monitor" data-on /></div>
            <span className="dash-desk-name">{a.name}</span>
          </div>
        ))}
        {Array.from({ length: empty }, (_, i) => (
          <div key={`empty-${i}`} className="dash-desk" data-empty>
            <div className="dash-seat" />
            <div className="dash-table"><span className="dash-monitor" /></div>
            <span className="dash-desk-name">Free</span>
          </div>
        ))}
      </div>
      <div className="dash-lounge" aria-label="Lounge">
        <span className="dash-lounge-label">Lounge</span>
        <div className="dash-lounge-bots">
          {resting.map((a) => (
            <div key={a.id} className="dash-bot" style={agentLook(lookRole(a))}>
              <AgentBot name={a.name} role={lookRole(a)} asleep={!a.enabled} working={false} />
              <span className="w-full truncate text-center">{a.name}</span>
            </div>
          ))}
          {extra > 0 && <span className="self-center text-sm text-muted-foreground">+{extra} more</span>}
          {resting.length === 0 && extra === 0 && (
            <span className="text-sm text-muted-foreground">Everyone is working</span>
          )}
        </div>
      </div>
    </>
  );
}

export function DashboardHome() {
  const board = usePolled("/api/dashboard", demoSnapshot, parseSnapshot);
  const team = usePolled("/api/agents", demoTeam, parseTeam);
  const asks = usePolled("/api/needs-you", demoAsks, parseAsks);

  const snap = board.source === "loading" ? null : board.data;
  const agents = team.source === "loading" ? null : team.data;
  const askList = asks.source === "loading" ? null : asks.data;
  const demo = board.source === "demo";
  const byStage = (stage: PipeStage) => snap?.items.filter((i) => i.stage === stage) ?? [];

  const working = agents?.filter((a) => a.enabled && a.activeRun).length ?? 0;
  const resting = (agents?.length ?? 0) - working;
  const open = snap ? PIPE_STAGES.filter((s) => s !== "done").reduce((n, s) => n + snap.counts[s], 0) : 0;
  const waiting = snap?.items.filter((i) => i.waiting).length ?? 0;
  const demoSource = [board, team, asks].find((s) => s.source === "demo");
  const tokenTotal = snap?.tokens.reduce((a, b) => a + b, 0) ?? 0;
  const tokenMax = Math.max(1, ...(snap?.tokens ?? []));

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
        {demoSource?.source === "demo" && <DataSourceBadge source="demo" reason={demoSource.reason} />}
      </div>

      <section aria-label="Mission pipeline" className="dash-pipe mt-6">
        <ol className="dash-stages">
          {PIPE_STAGES.map((stage) => (
            <li key={stage} className="dash-stage" data-stage={stage}>
              <span className="eyebrow">{PIPE_LABELS[stage]}</span>
              <b className="dash-count">{snap ? snap.counts[stage] : "–"}</b>
              {stage === "done" && <span className="dash-note">last 24h</span>}
            </li>
          ))}
        </ol>
        <div className="dash-lane">
          {PIPE_STAGES.map((stage) => (
            <div key={stage} className="dash-cell" data-stage={stage}>
              {stage === "done"
                ? snap && snap.counts.done > 0 && <CheckCircle2 aria-hidden="true" className="dash-done" />
                : byStage(stage).map((item, i) => <PipeDot key={item.id} item={item} index={i} demo={demo} />)}
            </div>
          ))}
        </div>
      </section>

      <div className="dash-grid mt-6">
        <Card tone="missions" label="dash-missions">
          <CardHead
            id="dash-missions"
            title="Active missions"
            href="/projects"
            link="Projects"
          />
          {snap === null ? (
            <Loading />
          ) : snap.missions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No mission is running. Start one from Projects.</p>
          ) : (
            <ul className="grid gap-3">
              {snap.missions.map((m) => {
                const pct = m.total > 0 ? Math.round((m.done / m.total) * 100) : 0;
                return (
                  <li key={m.id}>
                    <MaybeLink demo={demo} href={missionHref(m.id)} className="dash-mission" data-waiting={m.waiting || undefined}>
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="truncate font-medium">{m.title}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {PIPE_LABELS[m.stage]}
                          {m.total > 0 && ` · ${m.done}/${m.total}`}
                        </span>
                      </span>
                      <span
                        className="dash-bar"
                        role="progressbar"
                        aria-label={`${m.title} progress`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={pct}
                      >
                        <i style={{ width: `${Math.max(pct, 4)}%` }} />
                      </span>
                    </MaybeLink>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card tone="activity" label="dash-activity">
          <CardHead id="dash-activity" title="Activity" href="/live" link="Live log" />
          {snap === null ? (
            <Loading />
          ) : snap.activity.length === 0 ? (
            <p className="text-sm text-muted-foreground">No task moved in the last day.</p>
          ) : (
            <ol className="dash-feed" aria-live="polite">
              {snap.activity.map((a) => (
                <li key={`${a.id}:${a.at}`} data-tone={a.tone}>
                  <i aria-hidden="true" />
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{a.label}</span>
                    <span className="text-muted-foreground"> · {a.title}</span>
                  </span>
                  <time dateTime={a.at} className="shrink-0 text-xs text-muted-foreground">{timeAgo(a.at)}</time>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <div className="grid content-start gap-6">
          <Card tone="asks" label="dash-asks">
            <CardHead
              id="dash-asks"
              title="Needs you"
              href="/needs-you"
              link={askList && askList.length > 0 ? `All (${askList.length})` : "All"}
            />
            {askList === null ? (
              <Loading />
            ) : askList.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle2 aria-hidden="true" className="size-4" /> Nothing is waiting on you.
              </p>
            ) : (
              <ul className="grid gap-2">
                {askList.slice(0, MAX_ASKS).map((item) => (
                  <li key={`${item.kind}:${item.missionId}:${item.taskId ?? ""}`}>
                    <Link href="/needs-you" className="dash-ask">
                      <span className="font-medium">{ASK_LABEL[item.kind]}</span>
                      <span className="truncate text-muted-foreground">{item.taskTitle || item.missionTitle}</span>
                      {item.since && <span className="text-xs text-muted-foreground">{timeAgo(item.since)}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card tone="tokens" label="dash-tokens">
            <CardHead id="dash-tokens" title="Tokens">
              <b className="dash-count">{snap ? compact(tokenTotal) : "–"}</b>
              <span className="text-xs text-muted-foreground">last {TOKEN_HOURS}h</span>
            </CardHead>
            {snap === null ? (
              <Loading />
            ) : (
              <>
                <div className="dash-spark" role="img" aria-label={`${tokenTotal} tokens in the last ${TOKEN_HOURS} hours`}>
                  {snap.tokens.map((n, i) => (
                    <i key={i} data-empty={n === 0 || undefined} style={{ height: `${Math.max(6, (n / tokenMax) * 100)}%` }} />
                  ))}
                </div>
              </>
            )}
          </Card>
        </div>
      </div>

      <Card tone="team" label="dash-team" className="dash-team mt-6">
        <div className="grid gap-1">
          <h2 id="dash-team" className="eyebrow">AI team</h2>
          {agents && agents.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {working} working · {resting} resting
            </p>
          )}
          <Link href="/agents" className="dash-more">
            Open <ArrowRight aria-hidden="true" className="size-3.5" />
          </Link>
        </div>
        {agents === null ? (
          <Loading />
        ) : agents.length === 0 ? (
          <p className="text-sm text-muted-foreground">No agents yet. Add one in AI team.</p>
        ) : (
          <TeamOffice agents={agents.slice(0, MAX_BOTS)} extra={Math.max(0, agents.length - MAX_BOTS)} />
        )}
      </Card>
    </div>
  );
}
