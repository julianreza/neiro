"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  Check,
  ChevronDown,
  Clock3,
  FileText,
  GitBranch,
  Layers3,
  Play,
  Plus,
  Square,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import {
  demoRouteAgents,
  initialMissions,
  routeDemoTask,
  stages,
  updateDemoTask,
} from "@/lib/demo-missions";
import type { DemoMission, DemoTask, RouteAgentOption, TaskStage } from "@/lib/demo-missions";
import { RoutingGateCard, TaskRouteFlow } from "@/components/task-routing";
import type { MissionDetailDTO, MissionPhase, MissionSummaryDTO } from "@/lib/types";
import { formatCompactTokens } from "@/lib/utils";
import { useLiveData } from "@/hooks/use-live-data";
import { DataSourceBadge } from "@/components/data-source-badge";
import {
  AgentBot,
  agentLook,
  followPointer,
  resetPointer,
  roleForAgent,
} from "@/components/agent-bot";
import { MiniRocket, StatObject, statLook, type StatKind } from "@/components/stat-object";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { RunInspectorSheet } from "@/components/run-inspector-sheet";
import { WorktreeBar } from "@/components/worktree-bar";
import {
  MarkdownArtifactViewer,
  type ArtifactFile,
} from "@/components/markdown-artifact-viewer";

const PHASES = ["Plan DAG", "Write PRD", "Execute & verify", "Summary"] as const;

/** Lane pill gradients, one per stage. */
const stageLook = Object.fromEntries(
  (
    [
      ["Queued", "#64748b", "#334155"],
      ["Awaiting routing", "#f59e0b", "#78350f"],
      ["Routed", "#14b8a6", "#134e4a"],
      ["Coding", "#3b82f6", "#1e3a8a"],
      ["QA check", "#8b5cf6", "#3b0764"],
      ["Final review", "#ec4899", "#831843"],
      ["Needs you", "#f43f5e", "#881337"],
      ["Done", "#10b981", "#064e3b"],
    ] as const
  ).map(([stage, from, to]) => [
    stage,
    { "--stage-from": from, "--stage-to": to } as React.CSSProperties,
  ]),
) as Record<TaskStage, React.CSSProperties>;

/** A task as the board renders it; `rowId` is the database id (live mode only). */
type TaskView = DemoTask & { rowId?: string };

type MissionView = Omit<DemoMission, "tasks"> & {
  tasks: TaskView[];
  phase?: MissionPhase;
  lastError?: string | null;
  artifacts?: ArtifactFile[];
  /** Mission branch when it runs in a git worktree (live missions only). */
  workBranch?: string | null;
  baseBranch?: string | null;
};

const PHASE_STEP: Record<MissionPhase, number> = {
  planning: 0,
  spec: 1,
  executing: 2,
  summarizing: 3,
  done: 4,
};

function parseMissionList(json: unknown): MissionView[] {
  const list = (json as { missions?: MissionSummaryDTO[] } | null)?.missions;
  if (!Array.isArray(list)) throw new Error("Malformed /api/missions response");
  return list.map((m) => ({
    id: m.id,
    title: m.title,
    prompt: m.prompt,
    status: m.status,
    phase: m.phase,
    lastError: m.lastError,
    tasks: [],
  }));
}

function parseMissionDetail(json: unknown): MissionView | null {
  const m = (json as { mission?: MissionDetailDTO } | null)?.mission;
  if (!m) throw new Error("Malformed /api/missions/:id response");
  return {
    id: m.id,
    title: m.title,
    prompt: m.prompt,
    status: m.status,
    phase: m.phase,
    lastError: m.lastError,
    workBranch: m.workBranch,
    baseBranch: m.baseBranch,
    tasks: m.tasks.map((t) => ({
      id: t.taskKey ?? t.id.slice(0, 8),
      rowId: t.id,
      title: t.title,
      stage: t.stage,
      agent: t.agentName || "Unassigned",
      model: t.model,
      tokens: t.tokens,
      depends: t.depends,
      approval: t.approval,
      retries: t.retries,
      routingStatus: t.routingStatus ?? null,
      layaAgentId: t.layaAgentId ?? null,
      humanAgentId: t.humanAgentId ?? null,
      routeUrgency: t.routeUrgency ?? null,
      routeNeedsHuman: t.routeNeedsHuman ?? null,
      routeConfidence: t.routeConfidence ?? null,
      routeReason: t.routeReason ?? null,
    })),
    artifacts: m.artifacts.map((a) => ({
      name: `${a.kind.toUpperCase()}.md`,
      label: a.title,
      content: a.content,
    })),
  };
}

function parseIntOr(value: string, fallback: number): number {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Enabled agents from GET /api/agents, for the routing gate's "Ganti agen". */
function parseRouteAgents(json: unknown): RouteAgentOption[] {
  const rows = (json as { agents?: unknown })?.agents;
  if (!Array.isArray(rows)) throw new Error("Malformed agents response");
  return rows
    .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
    .filter((r) => r.enabled !== false)
    .map((r) => ({
      id: String(r.id ?? ""),
      name: String(r.name ?? r.id ?? ""),
      stage: String(r.stage ?? "workers"),
      model: String(r.model ?? ""),
    }))
    .filter((a) => a.id !== "");
}

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok && typeof data.error !== "string") data.error = `Request failed (${res.status})`;
    return { ok: res.ok, data };
  } catch {
    return { ok: false, data: { error: "Network error" } };
  }
}

export function MissionWorkspace() {
  const list = useLiveData<MissionView[]>("/api/missions", initialMissions, parseMissionList);
  const isLive = list.source === "live";
  const isDemo = list.source === "demo";
  const [demoMissions, setDemoMissions] = useState<MissionView[]>(initialMissions);
  const missions: MissionView[] = isLive ? list.data : isDemo ? demoMissions : [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const effectiveId = missions.some((m) => m.id === selectedId)
    ? selectedId
    : (missions[0]?.id ?? null);
  const detail = useLiveData<MissionView | null>(
    isLive && effectiveId ? `/api/missions/${encodeURIComponent(effectiveId)}` : null,
    null,
    parseMissionDetail,
  );
  const [prompt, setPrompt] = useState("");
  const [pause, setPause] = useState(false);
  const [workspace, setWorkspace] = useState("");
  const [baseBranch, setBaseBranch] = useState("");
  const [isolate, setIsolate] = useState(true);
  const [workers, setWorkers] = useState("3");
  const [retries, setRetries] = useState("2");
  const [launching, setLaunching] = useState(false);
  const [inspected, setInspected] = useState<string | null>(null);
  const agentList = useLiveData<RouteAgentOption[]>("/api/agents", demoRouteAgents, parseRouteAgents);
  // Live missions only offer live agents: demo agents could not be assigned for real.
  const routeAgents: RouteAgentOption[] = isLive
    ? agentList.source === "live"
      ? agentList.data
      : []
    : demoRouteAgents;
  const [routingBusy, setRoutingBusy] = useState<Set<string>>(() => new Set());
  const input = useRef<HTMLTextAreaElement>(null);
  const mission: MissionView | null | undefined = isLive
    ? detail.source === "live"
      ? detail.data
      : null
    : missions.find((item) => item.id === effectiveId);
  const loading =
    list.source === "loading" || (isLive && effectiveId !== null && detail.source === "loading");
  const tasks = mission?.tasks ?? [];
  const done = tasks.filter((task) => task.stage === "Done").length;
  const tokens = tasks.reduce((sum, task) => sum + task.tokens, 0);
  const activeStep = isLive && mission?.phase ? PHASE_STEP[mission.phase] : 2;
  const maxRetriesShown = parseIntOr(retries, 2);
  // Shown next to the locked Launch button, so the lock icon is explained
  // where it appears (not only in a hover tooltip).
  const launchBlockedReason = !isLive
    ? "Connect Supabase on the Gateway page to launch"
    : !prompt.trim()
      ? "Write an objective to launch"
      : null;
  const assignedAgents = new Set(tasks.map((t) => t.agent).filter((a) => a && a !== "Unassigned")).size;

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("compose"))
      input.current?.focus();
  }, []);

  function refresh() {
    list.reload();
    detail.reload();
  }

  async function launch() {
    if (!prompt.trim()) {
      input.current?.focus();
      toast.error("Describe the mission objective first");
      return;
    }
    if (!isLive) {
      toast.error("Demo mode: connect Supabase to launch missions.");
      return;
    }
    setLaunching(true);
    const { ok, data } = await postJson("/api/missions", {
      title: prompt.trim().split("\n")[0].slice(0, 80),
      prompt: prompt.trim(),
      pause_after_planning: pause,
      workspace_path: workspace.trim() || undefined,
      base_branch: baseBranch.trim() || undefined,
      isolate_workspace: isolate,
      max_parallel_workers: parseIntOr(workers, 3),
      max_retries: parseIntOr(retries, 2),
    });
    setLaunching(false);
    if (!ok) {
      toast.error(String(data.error));
      return;
    }
    const created = data.mission as { id?: string } | undefined;
    if (created?.id) setSelectedId(created.id);
    setPrompt("");
    toast.success(
      pause ? "Mission launched. It will pause for plan approval." : "Mission launched.",
    );
    refresh();
  }

  async function missionControl(action: "approve_plan" | "cancel") {
    if (!mission) return;
    if (!isLive) {
      setDemoMissions((items) =>
        items.map((item) =>
          item.id === mission.id
            ? { ...item, status: action === "approve_plan" ? "running" : "cancelled" }
            : item,
        ),
      );
      return;
    }
    const { ok, data } = await postJson(
      `/api/missions/${encodeURIComponent(mission.id)}/control`,
      { action },
    );
    if (!ok) toast.error(String(data.error));
    else toast.success(action === "approve_plan" ? "Plan approved" : "Mission cancelled");
    refresh();
  }

  async function taskControl(id: string, action: string, label: string) {
    const task = tasks.find((t) => t.id === id);
    if (!mission || !task?.rowId) return;
    const { ok, data } = await postJson(
      `/api/missions/${encodeURIComponent(mission.id)}/tasks/${encodeURIComponent(task.rowId)}/control`,
      { action },
    );
    if (!ok) toast.error(String(data.error));
    else toast.success(`${id}: ${label}`);
    refresh();
  }

  /** Routing gate: "Setujui" (agent = null) or "Ganti agen" (agent chosen). */
  async function routeGate(id: string, agent: RouteAgentOption | null) {
    const task = tasks.find((t) => t.id === id);
    if (!mission || !task) return;

    if (!isLive) {
      const pick = agent ?? demoRouteAgents.find((a) => a.id === task.layaAgentId);
      if (!pick) {
        toast.error("Agen usulan Laya tidak ditemukan");
        return;
      }
      setDemoMissions((items) =>
        items.map((item) =>
          item.id === effectiveId
            ? (routeDemoTask(item as DemoMission, id, pick, agent ? "overridden" : "approved") as MissionView)
            : item,
        ),
      );
      toast.success(`Demo ${id}: dirouting ke ${pick.name}`);
      return;
    }

    if (!task.rowId) return;
    setRoutingBusy((s) => new Set(s).add(id));
    const { ok, data } = await postJson(
      `/api/missions/${encodeURIComponent(mission.id)}/tasks/${encodeURIComponent(task.rowId)}/control`,
      agent ? { action: "override_route", agentId: agent.id } : { action: "approve_route" },
    );
    setRoutingBusy((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });
    if (!ok) toast.error(String(data.error));
    else toast.success(agent ? `${id}: agen diganti ke ${agent.name}` : `${id}: rute disetujui`);
    refresh();
  }

  const gateTasks = tasks.filter((t) => t.stage === "Awaiting routing");

  function updateTask(id: string, stage: TaskStage) {
    if (isLive) {
      const action =
        stage === "Done"
          ? ["mark_done", "marked done"]
          : stage === "Queued"
            ? ["retry", "queued for retry"]
            : stage === "Needs you"
              ? ["stop", "stopped"]
              : stage === "Coding"
                ? ["approve_tool", "tool approved"]
                : null;
      if (action) void taskControl(id, action[0], action[1]);
      return;
    }
    setDemoMissions((items) =>
      items.map((item) =>
        item.id === effectiveId
          ? (updateDemoTask(item as DemoMission, id, stage) as MissionView)
          : item,
      ),
    );
    toast.success(`Demo ${id}: ${stage.toLowerCase()}`);
  }

  function denyTool(id: string) {
    if (isLive) void taskControl(id, "deny_tool", "tool denied");
    else updateTask(id, "Queued");
  }

  return (
    <div className="space-y-8 p-4 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Mission control
          </h1>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            One objective. A team built to move it forward.
            <DataSourceBadge
              source={list.source}
              reason={list.source === "demo" ? list.reason : undefined}
            />
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            input.current?.focus();
            input.current?.scrollIntoView({
              behavior: "smooth",
              block: "center",
            });
          }}
        >
          <Plus className="size-4" />
          New mission
        </Button>
      </div>
      <section
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
        aria-label="Mission overview"
      >
        {[
          {
            label: "Mission status",
            value:
              mission?.status === "running"
                ? "In progress"
                : mission?.status === "completed"
                  ? "Completed"
                  : mission?.status === "cancelled"
                    ? "Cancelled"
                    : "Awaiting plan",
            detail: isLive ? `Phase: ${mission?.phase ?? "—"}` : "Sample data",
            icon: ActivityIcon,
            kind: "mission",
          },
          {
            label: "Tasks completed",
            value: `${done} / ${tasks.length}`,
            detail: "Across execution pipeline",
            icon: Check,
            kind: "tasks",
          },
          {
            label: "Team capacity",
            value: isLive ? `${assignedAgents} assigned` : "6 agents",
            detail: isLive ? "Agents on this mission" : "Sample team",
            icon: Layers3,
            kind: "team",
          },
          {
            label: "Token usage",
            value: formatCompactTokens(tokens),
            detail: isLive ? "Reported by Hermes" : "Sample usage",
            icon: Zap,
            kind: "tokens",
          },
        ].map(({ label, value, detail, kind }, index) => (
          <div
            className="stat-card"
            key={label}
            style={
              {
                "--i": index,
                ...statLook(kind as StatKind),
              } as React.CSSProperties
            }
            onPointerMove={followPointer}
            onPointerLeave={resetPointer}
          >
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm text-white/85">{label}</span>
              <p className="stat-value tabular-nums">{value}</p>
              <p className="mt-auto pt-2 text-xs text-white/75">{detail}</p>
            </div>
            <StatObject
              kind={kind as StatKind}
              label={label}
              active={mission?.status === "running"}
              progress={tasks.length ? done / tasks.length : 0}
            />
          </div>
        ))}
      </section>
      <section
        className="mission-chat"
        aria-labelledby="composer-title"
        style={agentLook("PM")}
        onPointerMove={followPointer}
        onPointerLeave={resetPointer}
      >
        <div className="chat-thread" aria-live="polite">
          <div className="chat-row">
            <AgentBot
              name="Orchestrator"
              role="PM"
              asleep={false}
              working={mission?.status === "running"}
            />
            <div className="chat-bubble chat-bubble-bot">
              <h2 id="composer-title">What should your team build today?</h2>
              <p>Describe the outcome. I will plan it and hand out the work.</p>
            </div>
          </div>
          {mission && (
            <>
              <p className="chat-bubble chat-bubble-user">{mission.title}</p>
              <div className="chat-row">
                <span className="chat-avatar-gap" aria-hidden="true" />
                <div className="chat-bubble chat-bubble-bot">
                  <p>
                    {done === tasks.length && tasks.length > 0
                      ? `Done. All ${tasks.length} tasks are finished.`
                      : `On it. ${done} of ${tasks.length} tasks are done.`}
                  </p>
                  <div
                    className="chat-progress"
                    role="progressbar"
                    aria-label="Mission progress"
                    aria-valuemin={0}
                    aria-valuemax={tasks.length}
                    aria-valuenow={done}
                  >
                    <i style={{ width: `${tasks.length ? (done / tasks.length) * 100 : 0}%` }} />
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            launch();
          }}
        >
          <div className="chat-input">
            <Label htmlFor="mission-prompt" className="sr-only">
              Mission objective
            </Label>
            <Textarea
              ref={input}
              id="mission-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  launch();
                }
              }}
              placeholder="Type a mission, for example: build a landing page for our app"
              className="min-h-24 resize-y border-0 bg-transparent p-0 text-base shadow-none focus-visible:ring-0 md:text-sm"
              maxLength={20000}
            />
          </div>
          <Collapsible>
            <div className="chat-actions flex flex-wrap items-center justify-between gap-3">
              <CollapsibleTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                >
                  <ChevronDown className="size-3.5" />
                  Advanced options
                </Button>
              </CollapsibleTrigger>
              <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
                {launchBlockedReason ? (
                  <span
                    id="launch-disabled-reason"
                    className="text-xs text-muted-foreground"
                  >
                    {launchBlockedReason}
                  </span>
                ) : (
                  <span className="hidden text-xs text-muted-foreground sm:block">
                    ⌘ / Ctrl + Enter
                  </span>
                )}
                <Button
                  type="submit"
                  className="console-launch"
                  disabled={!isLive || launching || !prompt.trim()}
                  aria-describedby={launchBlockedReason ? "launch-disabled-reason" : undefined}
                  title={launchBlockedReason ?? undefined}
                >
                  <Play className="size-3.5" />
                  {launching ? "Launching…" : "Launch mission"}
                </Button>
              </div>
            </div>
            <CollapsibleContent>
              <div className="grid gap-5 border-t p-5 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-2">
                  <Label htmlFor="workspace-path">Workspace folder</Label>
                  <Input
                    id="workspace-path"
                    value={workspace}
                    onChange={(event) => setWorkspace(event.target.value)}
                    placeholder="/Users/you/projects/portal"
                    aria-describedby="workspace-path-help"
                  />
                  <p id="workspace-path-help" className="text-xs text-muted-foreground">
                    On the machine running Neiro and Hermes.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="base-branch">Base branch</Label>
                  <Input
                    id="base-branch"
                    value={baseBranch}
                    onChange={(event) => setBaseBranch(event.target.value)}
                    placeholder="Current branch"
                    disabled={!isolate}
                    maxLength={200}
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    aria-describedby="base-branch-help"
                  />
                  <p id="base-branch-help" className="text-xs text-muted-foreground">
                    The new mission branch starts here.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="worker-limit">Parallel workers</Label>
                  <Input
                    id="worker-limit"
                    type="number"
                    min="1"
                    max="10"
                    value={workers}
                    onChange={(event) => setWorkers(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="retry-limit">Max auto-fix retries</Label>
                  <Input
                    id="retry-limit"
                    type="number"
                    min="0"
                    max="5"
                    value={retries}
                    onChange={(event) => setRetries(event.target.value)}
                  />
                </div>
                <div className="flex items-center gap-3">
                  <Switch
                    id="pause-plan"
                    checked={pause}
                    onCheckedChange={setPause}
                  />
                  <Label htmlFor="pause-plan">Pause after PRD review</Label>
                </div>
                <div className="flex items-center gap-3">
                  <Switch
                    id="isolate-workspace"
                    checked={isolate}
                    onCheckedChange={setIsolate}
                    aria-describedby="isolate-workspace-help"
                  />
                  <div>
                    <Label htmlFor="isolate-workspace">Work on a new branch</Label>
                    <p id="isolate-workspace-help" className="text-xs text-muted-foreground">
                      Git worktree on neiro/&lt;mission&gt;. Your checkout stays untouched.
                    </p>
                  </div>
                </div>
              </div>
              <p className="border-t px-5 py-3 text-xs text-muted-foreground">
                {isLive
                  ? "Applied to this mission: the orchestrator enforces the pause, worker cap and retry cap."
                  : "Demo mode: these options are saved only when Supabase is connected."}
              </p>
            </CollapsibleContent>
          </Collapsible>
        </form>
      </section>
      <section className="space-y-5">
        <div className="mission-pass">
          <div className="pass-main">
            <label htmlFor="mission-picker" className="pass-label">
              Current mission
            </label>
              <select
                id="mission-picker"
                className="pass-select"
                value={effectiveId ?? ""}
                onChange={(event) => {
                  setSelectedId(event.target.value);
                  setInspected(null);
                }}
              >
                {missions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            <ol className="pass-route" aria-label="Mission phases">
              {PHASES.map((step, index) => (
                <li
                  key={step}
                  aria-current={index === activeStep ? "step" : undefined}
                  data-state={
                    index < activeStep ? "done" : index === activeStep ? "now" : "next"
                  }
                >
                  <span className="pass-stop" aria-hidden="true">
                    {index === activeStep && <MiniRocket active={mission?.status === "running"} />}
                  </span>
                  <span className="pass-name">{step}</span>
                </li>
              ))}
            </ol>
          </div>
          <div className="pass-stub">
            <span className="pass-label">Phase</span>
            <span className="pass-count">
              {Math.min(activeStep + 1, PHASES.length)}
              <small>/{PHASES.length}</small>
            </span>
            <span className="pass-label">{PHASES[Math.min(activeStep, PHASES.length - 1)]}</span>
            <span className="pass-live">
              <i aria-hidden="true" />
              {isLive ? "Live" : isDemo ? "Demo" : "Loading"}
            </span>
            <div className="flex flex-wrap justify-center gap-1">
            {isLive && (
              <Button size="sm" variant="ghost" onClick={refresh}>
                Refresh
              </Button>
            )}
            {isDemo && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDemoMissions((items) =>
                    items.filter((item) => item.id !== effectiveId),
                  );
                  setSelectedId(null);
                }}
              >
                Remove from preview
              </Button>
            )}
            </div>
          </div>
        </div>
        {isLive && mission?.workBranch && (
          <WorktreeBar
            missionId={mission.id}
            branch={mission.workBranch}
            baseBranch={mission.baseBranch ?? null}
            status={mission.status}
            onDiscarded={refresh}
          />
        )}
        {mission?.lastError && (
          <Alert variant="destructive" role="alert">
            <AlertTitle>Orchestrator error</AlertTitle>
            <AlertDescription>{mission.lastError}</AlertDescription>
          </Alert>
        )}
        {isLive && detail.source === "demo" && (
          <Alert variant="destructive" role="alert">
            <AlertTitle>Could not load this mission</AlertTitle>
            <AlertDescription>{detail.reason}</AlertDescription>
          </Alert>
        )}
        {loading ? (
          <div className="space-y-3" aria-busy="true" aria-label="Loading missions">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : mission ? (
          <>
            {mission.status === "awaiting_plan_approval" && (
              <div
                role="status"
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-status-warning/30 bg-status-warning/5 p-4"
              >
                <p className="text-sm">
                  {isLive
                    ? "Plan and PRD are ready. Review the artifacts, then approve to start execution."
                    : "Preview plan ready. Approve to explore the local task board."}
                </p>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => void missionControl("approve_plan")}>
                    {isLive ? "Approve plan" : "Approve demo plan"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void missionControl("cancel")}
                  >
                    Cancel mission
                  </Button>
                </div>
              </div>
            )}
            <Tabs defaultValue="board">
              <div className="flex items-center justify-between gap-2 border-b pb-3">
                <TabsList>
                  <TabsTrigger value="board">
                    <Layers3 className="size-3.5" />
                    Board{" "}
                    <span className="font-mono text-[10px]">
                      {tasks.length}
                    </span>
                  </TabsTrigger>
                  <TabsTrigger value="artifacts">
                    <FileText className="size-3.5" />
                    Artifacts{" "}
                    <span className="font-mono text-[10px]">
                      {isLive ? (mission.artifacts?.length ?? 0) : 2}
                    </span>
                  </TabsTrigger>
                </TabsList>
                {isDemo && (
                  <span className="hidden text-xs text-muted-foreground sm:block">
                    Sample workflow · no live execution
                  </span>
                )}
              </div>
              <TabsContent value="board" className="mt-5">
                {tasks.length === 0 && (
                  <div
                    role="status"
                    className="mb-4 flex items-start gap-3 rounded-2xl border border-dashed p-4 text-sm"
                  >
                    <Play
                      className="mt-0.5 size-4 shrink-0 text-primary"
                      aria-hidden="true"
                    />
                    <p>
                      <span className="font-medium">No tasks yet.</span>{" "}
                      <span className="text-muted-foreground">
                        Launch a mission above. Your team splits it into tasks,
                        and they move through these columns from Queued to Done.
                      </span>
                    </p>
                  </div>
                )}
                {tasks.some((task) => task.approval) && (
                  <section aria-labelledby="needs-you-heading" className="mb-6 space-y-3">
                    <h3 id="needs-you-heading" className="text-sm font-semibold">
                      Waiting for your OK
                    </h3>
                    {tasks
                      .filter((task) => task.approval)
                      .map((task) => (
                        <article
                          key={task.id}
                          className="needs-you-card"
                          style={agentLook(roleForAgent(task.agent))}
                          onPointerMove={followPointer}
                          onPointerLeave={resetPointer}
                        >
                          <AgentBot
                            name={task.agent}
                            role={roleForAgent(task.agent)}
                            asleep={false}
                            working
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-white/85">
                              {task.agent} needs your OK
                            </p>
                            <h4 className="needs-you-title">{task.title}</h4>
                            <p className="mt-1 text-xs text-white/75">
                              {task.id}
                              {task.retries > 0 && ` · Retry ${task.retries}/${maxRetriesShown}`}
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-col gap-2">
                            <Button
                              className="agent-pill min-h-10"
                              onClick={() => updateTask(task.id, "Coding")}
                            >
                              Approve
                            </Button>
                            <Button
                              variant="ghost"
                              className="agent-icon min-h-10 bg-black/20"
                              onClick={() => denyTool(task.id)}
                            >
                              Deny
                            </Button>
                          </div>
                        </article>
                      ))}
                  </section>
                )}
                {gateTasks.length > 0 && (
                  <section aria-labelledby="routing-gate-heading" className="mb-6 space-y-3">
                    <h3 id="routing-gate-heading" className="eyebrow">
                      Menunggu keputusan routing · {gateTasks.length}
                    </h3>
                    <div className="grid gap-3 lg:grid-cols-2">
                      {gateTasks.map((task) => (
                        <RoutingGateCard
                          key={task.id}
                          task={task}
                          agents={routeAgents}
                          busy={routingBusy.has(task.id)}
                          onApprove={() => void routeGate(task.id, null)}
                          onOverride={(agent) => void routeGate(task.id, agent)}
                        />
                      ))}
                    </div>
                  </section>
                )}
                <div className="overflow-x-auto pb-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    {stages.map((stage) => (
                      <div
                        key={stage}
                        className="console-lane board-lane min-w-0"
                        data-stage={stage}
                        style={stageLook[stage]}
                      >
                        <h3 className="board-pill">
                          {stage}
                          <span>
                            {
                              tasks.filter((task) => task.stage === stage)
                                .length
                            }
                          </span>
                        </h3>
                        <div className={`console-tray space-y-3 rounded-lg p-2 ${tasks.length === 0 ? "min-h-24 border-dashed" : "min-h-60"}`}>
                          {tasks
                            .filter((task) => task.stage === stage)
                            .map((task) => (
                              <article
                                key={task.id}
                                className="console-task board-task"
                                style={agentLook(roleForAgent(task.agent))}
                              >
                                <span className="board-bot">
                                  <AgentBot
                                    name={task.agent}
                                    role={roleForAgent(task.agent)}
                                    asleep={false}
                                    working={task.stage === "Coding"}
                                  />
                                </span>
                                <div className="flex items-center justify-between text-[10px]">
                                  <span className="font-mono text-muted-foreground">
                                    {task.id}
                                  </span>
                                  {task.retries > 0 && (
                                    <span className="text-status-warning">
                                      Retry {task.retries}/{maxRetriesShown}
                                    </span>
                                  )}
                                </div>
                                <h4
                                  className="mt-3 text-xs leading-5 font-medium"
                                  title={task.title}
                                >
                                  {task.title}
                                </h4>
                                {task.depends.length > 0 && (
                                  <p className="mt-3 flex items-center gap-1 font-mono text-[9px] text-muted-foreground">
                                    <GitBranch className="size-3" />
                                    {task.depends.join(" · ")}
                                  </p>
                                )}
                                <TaskRouteFlow task={task} agents={routeAgents} />
                                <div className="mt-4 flex items-center gap-2 border-t pt-3">
                                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-secondary text-[8px]">
                                    {task.agent
                                      .split(" ")
                                      .map((word) => word[0])
                                      .join("")}
                                  </span>
                                  <span className="truncate text-[10px] text-muted-foreground">
                                    {task.agent}
                                  </span>
                                </div>
                                <p className="mt-2 truncate font-mono text-[9px] text-muted-foreground">
                                  {task.model} ·{" "}
                                  {formatCompactTokens(task.tokens)} tokens
                                </p>
                                {task.approval && (
                                  <div className="mt-3 flex gap-1">
                                    <Button
                                      size="sm"
                                      className="h-7 flex-1 text-[10px]"
                                      onClick={() =>
                                        updateTask(task.id, "Coding")
                                      }
                                    >
                                      Approve
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 flex-1 text-[10px]"
                                      onClick={() => denyTool(task.id)}
                                    >
                                      Deny
                                    </Button>
                                  </div>
                                )}
                                <button
                                  className="mt-3 flex w-full items-center justify-between border-t pt-3 text-[10px] text-muted-foreground hover:text-foreground"
                                  onClick={() => setInspected(task.id)}
                                >
                                  Inspect run
                                  <ArrowRight className="size-3" />
                                </button>
                              </article>
                            ))}
                          {!tasks.some((task) => task.stage === stage) && (
                            <div className="lane-empty" style={agentLook("PM")}>
                              <span inert aria-hidden="true">
                                <AgentBot
                                  name="Idle agent"
                                  role="PM"
                                  asleep
                                  working={false}
                                />
                              </span>
                              Nothing here yet
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </TabsContent>
              <TabsContent value="artifacts" className="mt-5">
                <MarkdownArtifactViewer
                  title={mission.title}
                  files={isLive ? mission.artifacts : undefined}
                />
              </TabsContent>
            </Tabs>
          </>
        ) : (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <Layers3 className="mx-auto mb-4 size-8 text-muted-foreground" />
            <h2 className="text-lg font-medium">
              A clear objective is all it takes.
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Plan a DAG, write requirements, execute, then verify.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {[
                "Build a customer portal",
                "Audit API security",
                "Create a public roadmap",
              ].map((idea) => (
                <Button
                  key={idea}
                  variant="outline"
                  onClick={() => {
                    setPrompt(idea);
                    input.current?.focus();
                  }}
                >
                  {idea}
                  <ArrowDown className="size-3" />
                </Button>
              ))}
            </div>
          </div>
        )}
      </section>
      <div aria-live="polite" className="sr-only">
        {mission?.title}: {done} of {tasks.length} tasks done.
        {isDemo ? " Demo data." : ""}
      </div>
      <footer className="flex flex-wrap justify-between gap-2 border-t pt-4 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-2">
          <Square className="size-2.5" />
          {isLive ? "Neiro / live" : "Neiro / local preview"}
        </span>
        <span>Hermes agents · 9Router inference · Supabase state</span>
      </footer>
      <RunInspectorSheet
        task={tasks.find((task) => task.id === inspected) ?? null}
        onClose={() => setInspected(null)}
        onUpdate={updateTask}
      />
    </div>
  );
}

const ActivityIcon = Clock3;
