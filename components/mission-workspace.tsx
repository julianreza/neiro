"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  Check,
  ChevronDown,
  Circle,
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
import { initialMissions, stages, updateDemoTask } from "@/lib/demo-missions";
import type { DemoMission, DemoTask, TaskStage } from "@/lib/demo-missions";
import type { MissionDetailDTO, MissionPhase, MissionSummaryDTO } from "@/lib/types";
import { formatCompactTokens } from "@/lib/utils";
import { useLiveData } from "@/hooks/use-live-data";
import { DataSourceBadge } from "@/components/data-source-badge";
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
import {
  MarkdownArtifactViewer,
  type ArtifactFile,
} from "@/components/markdown-artifact-viewer";

const stageColors: Record<TaskStage, string> = {
  Queued: "text-muted-foreground",
  Coding: "text-status-running",
  "QA check": "text-status-warning",
  "Final review": "text-primary",
  "Needs you": "text-status-danger",
  Done: "text-status-success",
};

/** A task as the board renders it; `rowId` is the database id (live mode only). */
type TaskView = DemoTask & { rowId?: string };

type MissionView = Omit<DemoMission, "tasks"> & {
  tasks: TaskView[];
  phase?: MissionPhase;
  lastError?: string | null;
  artifacts?: ArtifactFile[];
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
  const [workers, setWorkers] = useState("3");
  const [retries, setRetries] = useState("2");
  const [launching, setLaunching] = useState(false);
  const [inspected, setInspected] = useState<string | null>(null);
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
            accent: "violet",
          },
          {
            label: "Tasks completed",
            value: `${done} / ${tasks.length}`,
            detail: "Across execution pipeline",
            icon: Check,
            accent: "emerald",
          },
          {
            label: "Team capacity",
            value: isLive ? `${assignedAgents} assigned` : "6 agents",
            detail: isLive ? "Agents on this mission" : "Sample team",
            icon: Layers3,
            accent: "sky",
          },
          {
            label: "Token usage",
            value: formatCompactTokens(tokens),
            detail: isLive ? "Reported by Hermes" : "Sample usage",
            icon: Zap,
            accent: "pink",
          },
        ].map(({ label, value, detail, icon: Icon, accent }, index) => (
          <div
            className="card-trendy p-5"
            key={label}
            style={{ "--i": index } as React.CSSProperties}
          >
            <div className="flex items-center justify-between">
              <span className="eyebrow">
                {label}
              </span>
              {/* Same neutral card for all four; color lives only in the
                  icon chip, so no single card shouts louder than the rest. */}
              <span
                data-accent={accent}
                className="accent-icon flex size-7 items-center justify-center rounded-lg border"
              >
                <Icon className="size-3.5" />
              </span>
            </div>
            <p className="mt-3 text-2xl font-semibold tracking-tight tabular-nums">
              {value}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
          </div>
        ))}
      </section>
      <section
        className="console-composer overflow-hidden rounded-lg border bg-card"
        aria-labelledby="composer-title"
      >
        <div className="flex items-center gap-2 border-b px-5 py-3">
          <FileText className="size-4 text-primary" />
          <h2 id="composer-title" className="text-xs font-medium">
            What should your team build?
          </h2>
          <span className="eyebrow ml-auto">
            Prompt → plan → execute
          </span>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            launch();
          }}
        >
          <div className="p-5">
            <Label
              htmlFor="mission-prompt"
              className="mb-3 text-xs text-muted-foreground"
            >
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
              placeholder="Describe the outcome. Your team will handle the breakdown."
              className="min-h-24 resize-y border-0 bg-transparent p-0 text-base shadow-none focus-visible:ring-0 md:text-sm"
              maxLength={20000}
            />
          </div>
          <Collapsible>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-secondary/15 px-5 py-3">
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
                  <Label htmlFor="workspace-path">VPS workspace path</Label>
                  <Input
                    id="workspace-path"
                    value={workspace}
                    onChange={(event) => setWorkspace(event.target.value)}
                    placeholder="/root/projects/portal"
                  />
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
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border">
              <GitBranch className="size-4" />
            </div>
            <div className="min-w-0">
              <label
                htmlFor="mission-picker"
                className="eyebrow mb-1 block"
              >
                Current mission
              </label>
              <select
                id="mission-picker"
                className="w-full min-w-0 max-w-full truncate bg-transparent text-sm font-medium focus-visible:outline-2 focus-visible:outline-primary"
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
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <Circle className="size-2 fill-current" />
              {isLive ? "Live state" : isDemo ? "Demo state" : "Loading"}
            </span>
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
            <div className="card-trendy grid grid-cols-2 gap-3 p-4 lg:grid-cols-4">
              {["Plan DAG", "Write PRD", "Execute & verify", "Summary"].map(
                (step, index) => (
                  <div
                    key={step}
                    aria-current={index === activeStep ? "step" : undefined}
                    className={`flex items-center gap-3 text-sm ${index === activeStep ? "font-semibold text-foreground" : index < activeStep ? "text-foreground/90" : "text-muted-foreground"}`}
                  >
                    <span
                      className={`flex size-7 shrink-0 items-center justify-center rounded-full border font-mono text-xs font-semibold ${
                        index < activeStep
                          ? "border-status-success/30 bg-status-success/10 text-status-success"
                          : index === activeStep
                            ? "border-status-running bg-status-running/15 text-status-running ring-2 ring-status-running/25"
                            : "border-foreground/30 text-foreground/85"
                      }`}
                    >
                      {index < activeStep ? (
                        <Check className="size-3" />
                      ) : (
                        `0${index + 1}`
                      )}
                    </span>
                    {step}
                    {isDemo && index === 2 && (
                      <span className="ml-auto rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        Demo
                      </span>
                    )}
                  </div>
                ),
              )}
            </div>
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
                <div className="overflow-x-auto pb-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
                    {stages.map((stage) => (
                      <div
                        key={stage}
                        className="console-lane min-w-0"
                        data-stage={stage}
                      >
                        <h3 className="mb-4 flex items-center gap-2 px-1 text-xs font-medium">
                          <Circle
                            className={`size-2 fill-current ${stageColors[stage]}`}
                          />
                          {stage}
                          <span className="ml-auto font-mono text-[10px] text-muted-foreground">
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
                                className="console-task rounded-md border p-3"
                              >
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
                          {tasks.length > 0 && !tasks.some((task) => task.stage === stage) && (
                            <div className="py-8 text-center text-xs text-muted-foreground">
                              No tasks here yet
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
