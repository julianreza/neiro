"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  FileText,
  Layers3,
  Play,
  Plus,
  RefreshCw,
  Square,
} from "lucide-react";
import { toast } from "sonner";
import {
  demoRouteAgents,
  initialMissions,
  routeDemoTask,
  updateDemoTask,
} from "@/lib/demo-missions";
import type { DemoMission, DemoTask, RouteAgentOption, TaskStage } from "@/lib/demo-missions";
import { RoutingGateCard } from "@/components/task-routing";
import type { MissionArtifact, MissionDetailDTO, MissionPhase, MissionSummaryDTO } from "@/lib/types";
import { useLiveData } from "@/hooks/use-live-data";
import { DataSourceBadge } from "@/components/data-source-badge";
import {
  AgentBot,
  agentLook,
  followPointer,
  resetPointer,
  roleForAgent,
} from "@/components/agent-bot";
import { StoryPill } from "@/components/history-story";
import type { StoryTone } from "@/components/history-story";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RunInspectorSheet } from "@/components/run-inspector-sheet";
import { WorktreeBar } from "@/components/worktree-bar";
import { DeleteButton } from "@/components/delete-button";
import { useRole } from "@/hooks/use-role";
import {
  MarkdownArtifactViewer,
  type ArtifactFile,
} from "@/components/markdown-artifact-viewer";
import { prdHref } from "@/lib/client-api";
import { TaskChat } from "@/components/task-chat";

/** Status label next to the mission title, in History's colours. */
const MISSION_PILL: Record<MissionView["status"], { tone: StoryTone; label: string }> = {
  running: { tone: "live", label: "Running" },
  awaiting_plan_approval: { tone: "wait", label: "Needs you" },
  completed: { tone: "done", label: "Done" },
  cancelled: { tone: "off", label: "Cancelled" },
};

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
type TaskView = DemoTask & {
  rowId?: string;
  brief?: string | null;
  resultOutput?: string | null;
  /** The live run (not a `claim:` token) and the agent running it. */
  runId?: string | null;
  runAgentId?: string | null;
};

type MissionView = Omit<DemoMission, "tasks"> & {
  tasks: TaskView[];
  phase?: MissionPhase;
  lastError?: string | null;
  artifacts?: ArtifactFile[];
  /** Every saved artifact, for the task chat (live missions only). */
  rawArtifacts?: MissionArtifact[];
  /** Mission branch when it runs in a git worktree (live missions only). */
  workBranch?: string | null;
  baseBranch?: string | null;
  /** Auto-fix retries this mission allows per task (live missions only). */
  maxRetries?: number;
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
    maxRetries: m.maxRetries,
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
    maxRetries: m.maxRetries,
    tasks: m.tasks.map((t) => ({
      id: t.taskKey ?? t.id.slice(0, 8),
      rowId: t.id,
      runId: t.runId && !t.runId.startsWith("claim:") ? t.runId : null,
      runAgentId: t.runAgentId ?? t.agentId ?? null,
      title: t.title,
      stage: t.stage,
      agent: t.agentName || "Unassigned",
      model: t.model,
      tokens: t.tokens,
      depends: t.depends,
      brief: t.result ?? null,
      resultOutput: t.resultOutput,
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
    rawArtifacts: m.artifacts,
    // Coding outputs live in the task chat, not in the Artifacts list.
    artifacts: m.artifacts.filter((a) => a.kind !== "coding_output").map((a) => ({
      name: `${a.kind.toUpperCase()}.md`,
      label: a.title,
      content: a.content,
    })),
  };
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

export type WorkspaceProject = { id: string; path: string; name: string };

/**
 * Mission control of one project: its missions, and new ones start in its folder.
 * `embedded` (Projects page) drops the page chrome; `missionId` then picks the mission.
 */
export function MissionWorkspace({
  project,
  embedded = false,
  missionId,
  onDeleted,
}: {
  project: WorkspaceProject;
  embedded?: boolean;
  missionId?: string;
  /** After this mission is deleted; without it the page goes back to Projects. */
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const role = useRole();
  const list = useLiveData<MissionView[]>(
    `/api/missions?project=${encodeURIComponent(project.id)}`,
    initialMissions,
    parseMissionList,
  );
  const isLive = list.source === "live";
  const isDemo = list.source === "demo";
  const [demoMissions, setDemoMissions] = useState<MissionView[]>(initialMissions);
  const missions: MissionView[] = isLive ? list.data : isDemo ? demoMissions : [];
  // `?mission=<id>` (links from Needs you, History, notifications) opens that mission.
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("mission"),
  );
  const effectiveId = missionId
    ? missionId
    : missions.some((m) => m.id === selectedId)
      ? selectedId
      : (missions[0]?.id ?? null);
  const detail = useLiveData<MissionView | null>(
    isLive && effectiveId ? `/api/missions/${encodeURIComponent(effectiveId)}` : null,
    null,
    parseMissionDetail,
  );
  const [inspected, setInspected] = useState<string | null>(null);
  const agentList = useLiveData<RouteAgentOption[]>("/api/agents", demoRouteAgents, parseRouteAgents);
  // Live missions only offer live agents: demo agents could not be assigned for real.
  const routeAgents: RouteAgentOption[] = isLive
    ? agentList.source === "live"
      ? agentList.data
      : []
    : demoRouteAgents;
  const [routingBusy, setRoutingBusy] = useState<Set<string>>(() => new Set());
  const mission: MissionView | null | undefined = isLive
    ? detail.source === "live"
      ? detail.data
      : null
    : missions.find((item) => item.id === effectiveId);
  const loading =
    list.source === "loading" || (isLive && effectiveId !== null && detail.source === "loading");
  const tasks = mission?.tasks ?? [];
  const hasPrd = Boolean(mission?.artifacts?.some((a) => a.name === "PRD.md"));
  const done = tasks.filter((task) => task.stage === "Done").length;
  // The mission's own retry cap; demo missions use the orchestrator default.
  const maxRetriesShown = mission?.maxRetries ?? 2;

  function refresh() {
    list.reload();
    detail.reload();
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
    <div className={embedded ? "space-y-5" : "space-y-8 p-4 md:p-8"}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          {!embedded && (
            <nav aria-label="Breadcrumb" className="mb-1 text-sm text-muted-foreground">
              <Link href="/projects" className="hover:text-foreground hover:underline">
                Projects
              </Link>
              <span aria-hidden="true"> / </span>
              <Link href={`/projects?project=${encodeURIComponent(project.id)}`} className="hover:text-foreground hover:underline">
                {project.name}
              </Link>
            </nav>
          )}
          <h1
            className={`flex flex-wrap items-center gap-3 font-semibold tracking-tight ${embedded ? "text-lg" : "text-3xl"}`}
          >
            <span className="min-w-0 break-words">{mission?.title ?? "Mission control"}</span>
            {mission && (
              <StoryPill tone={MISSION_PILL[mission.status].tone}>{MISSION_PILL[mission.status].label}</StoryPill>
            )}
          </h1>
          {!embedded && (
            <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="code-chip" title={project.path}>{project.path}</span>
              <DataSourceBadge
                source={list.source}
                reason={list.source === "demo" ? list.reason : undefined}
              />
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isLive && (
            <Button variant="ghost" onClick={refresh}>
              <RefreshCw className="size-4" aria-hidden="true" />
              Refresh
            </Button>
          )}
          {isLive && mission && hasPrd && (
            <Button asChild variant="outline">
              <Link href={prdHref(project.id, mission.id)}>
                <FileText className="size-4" aria-hidden="true" />
                Open PRD
              </Link>
            </Button>
          )}
          {isDemo && effectiveId && (
            <Button
              variant="ghost"
              onClick={() => {
                setDemoMissions((items) => items.filter((item) => item.id !== effectiveId));
                setSelectedId(null);
              }}
            >
              Remove from preview
            </Button>
          )}
          {!embedded && (
            <Button asChild variant="outline">
              <Link href={`/projects?project=${encodeURIComponent(project.id)}&compose=1`}>
                <Plus className="size-4" />
                New mission
              </Link>
            </Button>
          )}
        </div>
      </div>
      <section className="space-y-5">
        {isLive && mission?.workBranch && (
          <WorktreeBar
            missionId={mission.id}
            branch={mission.workBranch}
            baseBranch={mission.baseBranch ?? null}
            status={mission.status}
            onDiscarded={refresh}
          />
        )}
          {isLive && mission && role === "admin" && (
            <DeleteButton
              url={`/api/missions/${encodeURIComponent(mission.id)}`}
              what="Mission"
              title={`Delete “${mission.title}”?`}
              disabledReason={
                mission.status === "running" ? "This mission is still running. Cancel it first, then delete it." : undefined
              }
              body={
                <>
                  <p>The mission, its tasks and its artifacts are deleted. This can&apos;t be undone.</p>
                  {mission.workBranch && (
                    <p>
                      Its branch <span className="code-chip">{mission.workBranch}</span> stays in git.
                    </p>
                  )}
                </>
              }
              onDeleted={() => {
                if (onDeleted) onDeleted();
                else router.push(`/projects?project=${encodeURIComponent(project.id)}`);
              }}
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
                    ? hasPrd
                      ? "Plan and PRD are ready. Read the PRD, then approve or ask for changes."
                      : "The plan is ready. Review the artifacts, then approve to start execution."
                    : "Preview plan ready. Approve to explore the local task board."}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => void missionControl("approve_plan")}>
                    {isLive ? "Approve plan" : "Approve demo plan"}
                  </Button>
                  {isLive && hasPrd && (
                    <Button asChild size="sm" variant="secondary">
                      <Link href={prdHref(project.id, mission.id)}>
                        <FileText className="size-3.5" aria-hidden="true" />
                        Open PRD
                      </Link>
                    </Button>
                  )}
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
                    <span className="project-count">
                      {tasks.length}
                    </span>
                  </TabsTrigger>
                  <TabsTrigger value="artifacts">
                    <FileText className="size-3.5" />
                    Artifacts{" "}
                    <span className="project-count">
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
                {tasks.length === 0 ? (
                  <div className="lane-empty board-empty" style={agentLook("PM")}>
                    <span inert aria-hidden="true">
                      <AgentBot name="Idle agent" role="PM" asleep working={false} />
                    </span>
                    Tasks show up here once the PM plans the mission.
                  </div>
                ) : (
                  <TaskChat
                    missionId={isLive ? mission.id : undefined}
                    tasks={tasks}
                    artifacts={mission.rawArtifacts ?? []}
                    maxRetries={maxRetriesShown}
                    routeAgents={routeAgents}
                    stageStyle={stageLook}
                    onInspect={setInspected}
                  />
                )}
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
              Write a mission on Projects. It shows up here as it runs.
            </p>
            <Button asChild className="mt-5">
              <Link href={`/projects?project=${encodeURIComponent(project.id)}&compose=1`}>
                <Plus className="size-4" />
                New mission
              </Link>
            </Button>
          </div>
        )}
      </section>
      <div aria-live="polite" className="sr-only">
        {mission?.title}: {done} of {tasks.length} tasks done.
        {isDemo ? " Demo data." : ""}
      </div>
      {!embedded && (
        <footer className="flex flex-wrap justify-between gap-2 border-t pt-4 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-2">
            <Square className="size-2.5" />
            {isLive ? "Neiro / live" : "Neiro / local preview"}
          </span>
          <span>Hermes agents · Supabase state</span>
        </footer>
      )}
      <RunInspectorSheet
        task={tasks.find((task) => task.id === inspected) ?? null}
        onClose={() => setInspected(null)}
        onUpdate={updateTask}
      />
    </div>
  );
}
