import type { MissionPhase, MissionStatus, TaskStage } from "@/lib/types";

/** The six columns of the Dashboard pipe, left to right. */
export const PIPE_STAGES = ["plan", "spec", "code", "qa", "review", "done"] as const;
export type PipeStage = (typeof PIPE_STAGES)[number];

export const PIPE_LABELS: Record<PipeStage, string> = {
  plan: "Plan",
  spec: "Spec",
  code: "Coding",
  qa: "QA",
  review: "Review",
  done: "Done",
};

/** One moving dot: a mission (plan/spec/summary) or one of its tasks. */
export type PipeItem = {
  id: string;
  missionId: string;
  title: string;
  stage: PipeStage;
  /** Stopped until a person acts (plan approval, failed task, pick an agent). */
  waiting: boolean;
};

export type PipeSnapshot = {
  counts: Record<PipeStage, number>;
  items: PipeItem[];
};

export type PipeMission = {
  id: string;
  title: string;
  status: MissionStatus;
  phase: MissionPhase;
};

export type PipeTask = {
  id: string;
  missionId: string;
  title: string;
  stage: TaskStage;
  updatedAt?: string | null;
  tokens?: number;
};

/** One row of "Active missions": how many of its tasks are done. */
export type MissionRow = {
  id: string;
  title: string;
  stage: PipeStage;
  waiting: boolean;
  done: number;
  total: number;
};

export type ActivityTone = "done" | "waiting" | "running";

/** One line of the activity feed: a task's latest move. */
export type ActivityItem = {
  id: string;
  missionId: string;
  title: string;
  label: string;
  tone: ActivityTone;
  at: string;
};

export type DashboardSnapshot = PipeSnapshot & {
  missions: MissionRow[];
  activity: ActivityItem[];
  /** Tokens of tasks last updated on each of the last TOKEN_DAYS local days, oldest first; the last one is today. */
  tokens: number[];
  /** Tokens per agent over the same TOKEN_DAYS days, biggest first. */
  agentTokens: AgentTokens[];
  /** Tokens per model over the same days and runs as `agentTokens`. */
  modelTokens: AgentTokens[];
  /** Tokens per runtime (Hermes, OMP) over the same days and runs. */
  runtimeTokens: AgentTokens[];
  /** Tokens in `tokens` that no agent row covers (runs from before agent_token_usage). */
  unsplitTokens: number;
  /** Set when the per-agent usage could not be read (e.g. its table is missing). */
  agentTokensError?: string;
};

export type AgentTokens = { id: string; name: string; tokens: number };
export type TokenTask = Pick<PipeTask, "updatedAt" | "tokens"> & {
  agentId?: string | null;
  agentName?: string;
  model?: string | null;
  runtime?: string | null;
};

const RUNTIME_LABELS: Record<string, string> = {
  hermes: "Hermes",
  ohmypi: "OMP",
  antigravity: "Antigravity",
};

/** Tokens summed per runtime (Hermes, OMP, ...), biggest first. */
export function tokensByRuntime(tasks: TokenTask[]): AgentTokens[] {
  return tokensByAgent(
    tasks.map((t) => {
      const runtime = t.runtime?.trim() || "hermes";
      return { ...t, agentId: runtime, agentName: RUNTIME_LABELS[runtime] ?? runtime };
    }),
    Object.keys(RUNTIME_LABELS).length + 1,
  );
}

/** The donut shows this many agents; the rest are summed into "Others". */
export const MAX_AGENT_SLICES = 5;

/** Tokens summed per model, biggest first, the tail folded into "Others". */
export function tokensByModel(tasks: TokenTask[], max = MAX_AGENT_SLICES): AgentTokens[] {
  return tokensByAgent(
    tasks.map((t) => {
      const model = t.model?.trim() || "Not recorded";
      return { ...t, agentId: `model:${model}`, agentName: model };
    }),
    max,
  );
}

/** Tokens summed per agent, biggest first, the tail folded into "Others". */
export function tokensByAgent(tasks: TokenTask[], max = MAX_AGENT_SLICES): AgentTokens[] {
  const sums = new Map<string, AgentTokens>();
  for (const t of tasks) {
    const n = Number(t.tokens) || 0;
    if (n <= 0) continue;
    const name = t.agentName?.trim() || "Unassigned";
    const id = t.agentId || `name:${name}`;
    const row = sums.get(id) ?? { id, name, tokens: 0 };
    row.tokens += n;
    sums.set(id, row);
  }
  const rows = [...sums.values()].sort((a, b) => b.tokens - a.tokens);
  if (rows.length <= max) return rows;
  const rest = rows.slice(max - 1).reduce((s, r) => s + r.tokens, 0);
  return [...rows.slice(0, max - 1), { id: "others", name: "Others", tokens: rest }];
}

export const MAX_MISSION_ROWS = 5;
export const MAX_ACTIVITY = 8;
export const TOKEN_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Local midnight of the day `at` falls on. */
function dayStart(at: number): number {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Days back from today's local day; NaN when the time is missing or in the future. */
function daysBack(iso: string | null | undefined, now: number): number {
  const at = time(iso);
  if (!Number.isFinite(at) || at > now) return NaN;
  // Round, because a day across a DST change is 23 or 25 hours long.
  return Math.round((dayStart(now) - dayStart(at)) / DAY_MS);
}

/** Tasks last updated inside the chart's `days` local days. */
function windowed<T extends Pick<PipeTask, "updatedAt">>(tasks: T[], now: number, days = TOKEN_DAYS): T[] {
  return tasks.filter((t) => {
    const back = daysBack(t.updatedAt, now);
    return back >= 0 && back < days;
  });
}

/**
 * Tokens per local calendar day for the last `days` days, oldest first.
 * A task's tokens count on the day it was last updated.
 */
export function tokensByDay(
  tasks: Pick<PipeTask, "updatedAt" | "tokens">[],
  now = Date.now(),
  days = TOKEN_DAYS,
): number[] {
  const out = Array.from({ length: days }, () => 0);
  for (const t of tasks) {
    const back = daysBack(t.updatedAt, now);
    if (!(back >= 0 && back < days)) continue;
    out[days - 1 - back] += Number(t.tokens) || 0;
  }
  return out;
}

const ACTIVITY: Record<TaskStage, { label: string; tone: ActivityTone }> = {
  Queued: { label: "Queued", tone: "running" },
  "Awaiting routing": { label: "Waiting for an agent", tone: "waiting" },
  Routed: { label: "Agent picked", tone: "running" },
  Coding: { label: "Coding", tone: "running" },
  "QA check": { label: "In QA", tone: "running" },
  "Final review": { label: "In review", tone: "running" },
  "Needs you": { label: "Needs you", tone: "waiting" },
  Done: { label: "Done", tone: "done" },
};

function time(iso: string | null | undefined): number {
  const at = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(at) ? at : NaN;
}

/**
 * Everything the Dashboard shows, from open missions and their tasks plus
 * tasks updated recently. Pass each task once. `tokenTasks` feeds the
 * per-day token chart and may reach further back than `tasks`. `usage` is
 * one row per finished run (agent_token_usage) and feeds the per-agent donut.
 */
export function buildDashboard(
  missions: PipeMission[],
  tasks: PipeTask[],
  now = Date.now(),
  tokenTasks: Pick<PipeTask, "updatedAt" | "tokens">[] = tasks,
  usage: TokenTask[] = [],
): DashboardSnapshot {
  const pipe = buildPipe(missions, tasks, now);

  const totals = new Map<string, { done: number; total: number }>();
  for (const t of tasks) {
    const row = totals.get(t.missionId) ?? { done: 0, total: 0 };
    row.total += 1;
    if (t.stage === "Done") row.done += 1;
    totals.set(t.missionId, row);
  }
  const placed = new Map(pipe.items.filter((i) => i.id === i.missionId).map((i) => [i.missionId, i]));
  const rows: MissionRow[] = [];
  for (const m of missions) {
    if (m.status !== "running" && m.status !== "awaiting_plan_approval") continue;
    if (rows.length >= MAX_MISSION_ROWS) break;
    const own = placed.get(m.id);
    const taskItems = pipe.items.filter((i) => i.missionId === m.id && i.id !== m.id);
    const stage: PipeStage = own?.stage ?? (taskItems[0]?.stage ?? "code");
    const waiting = Boolean(own?.waiting || taskItems.some((i) => i.waiting));
    rows.push({ id: m.id, title: m.title, stage, waiting, ...(totals.get(m.id) ?? { done: 0, total: 0 }) });
  }

  const activity = tasks
    .filter((t) => Number.isFinite(time(t.updatedAt)))
    .sort((a, b) => time(b.updatedAt) - time(a.updatedAt))
    .slice(0, MAX_ACTIVITY)
    .map((t) => ({ id: t.id, missionId: t.missionId, title: t.title, at: t.updatedAt as string, ...ACTIVITY[t.stage] }));

  const tokens = tokensByDay(tokenTasks, now);
  const credited = windowed(usage, now);
  const agentTokens = tokensByAgent(credited);
  const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);
  return {
    ...pipe,
    missions: rows,
    activity,
    tokens,
    agentTokens,
    modelTokens: tokensByModel(credited),
    runtimeTokens: tokensByRuntime(credited),
    unsplitTokens: Math.max(0, sum(tokens) - sum(agentTokens.map((a) => a.tokens))),
  };
}

/** Dots are capped so a busy day stays readable; counts are never capped. */
export const MAX_PIPE_ITEMS = 40;
const DONE_WINDOW_MS = 24 * 60 * 60 * 1000;

function taskStage(stage: TaskStage): { stage: PipeStage; waiting: boolean } | null {
  switch (stage) {
    case "Queued":
    case "Routed":
    case "Coding":
      return { stage: "code", waiting: false };
    case "Awaiting routing":
    case "Needs you":
      return { stage: "code", waiting: true };
    case "QA check":
      return { stage: "qa", waiting: false };
    case "Final review":
      return { stage: "review", waiting: false };
    case "Done":
      return null;
  }
}

/**
 * Where every open mission and task sits in the pipe. Planning and spec are
 * mission steps; coding, QA and review are task steps; a summarizing mission
 * shows under Review. Done counts tasks finished in the last 24 hours.
 */
export function buildPipe(missions: PipeMission[], tasks: PipeTask[], now = Date.now()): PipeSnapshot {
  const counts = Object.fromEntries(PIPE_STAGES.map((s) => [s, 0])) as Record<PipeStage, number>;
  const items: PipeItem[] = [];
  const open = new Map<string, PipeMission>();
  const add = (item: PipeItem) => {
    counts[item.stage] += 1;
    if (items.length < MAX_PIPE_ITEMS) items.push(item);
  };

  for (const m of missions) {
    if (m.status !== "running" && m.status !== "awaiting_plan_approval") continue;
    open.set(m.id, m);
    const base = { id: m.id, missionId: m.id, title: m.title };
    if (m.status === "awaiting_plan_approval") add({ ...base, stage: "spec", waiting: true });
    else if (m.phase === "planning") add({ ...base, stage: "plan", waiting: false });
    else if (m.phase === "spec") add({ ...base, stage: "spec", waiting: false });
    else if (m.phase === "summarizing") add({ ...base, stage: "review", waiting: false });
  }

  for (const t of tasks) {
    if (t.stage === "Done") {
      const at = t.updatedAt ? Date.parse(t.updatedAt) : NaN;
      if (Number.isFinite(at) && now - at <= DONE_WINDOW_MS) counts.done += 1;
      continue;
    }
    const mission = open.get(t.missionId);
    if (!mission || mission.status !== "running" || mission.phase !== "executing") continue;
    const place = taskStage(t.stage);
    if (place) add({ id: t.id, missionId: t.missionId, title: t.title || mission.title, ...place });
  }

  return { counts, items };
}
