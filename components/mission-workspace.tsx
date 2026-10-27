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
import type { DemoMission, TaskStage } from "@/lib/demo-missions";
import { formatCompactTokens } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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
import { MarkdownArtifactViewer } from "@/components/markdown-artifact-viewer";

const stageColors: Record<TaskStage, string> = {
  Queued: "text-muted-foreground",
  Coding: "text-status-running",
  "QA check": "text-status-warning",
  "Final review": "text-primary",
  "Needs you": "text-status-danger",
  Done: "text-status-success",
};

export function MissionWorkspace() {
  const [missions, setMissions] = useState<DemoMission[]>(initialMissions);
  const [selectedId, setSelectedId] = useState(initialMissions[0].id);
  const [prompt, setPrompt] = useState("");
  const [pause, setPause] = useState(false);
  const [workspace, setWorkspace] = useState("");
  const [workers, setWorkers] = useState("3");
  const [retries, setRetries] = useState("2");
  const [inspected, setInspected] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const mission = missions.find((item) => item.id === selectedId);
  const tasks = mission?.tasks ?? [];
  const done = tasks.filter((task) => task.stage === "Done").length;
  const tokens = tasks.reduce((sum, task) => sum + task.tokens, 0);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("compose"))
      input.current?.focus();

    async function fetchMissions() {
      try {
        const res = await fetch("/api/missions");
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.missions) && data.missions.length > 0) {
            setMissions(data.missions);
            setSelectedId(data.missions[0].id);
          }
        }
      } catch {
        // Fallback to local demo missions
      }
    }
    fetchMissions();
  }, []);
  async function launch() {
    if (!prompt.trim()) {
      input.current?.focus();
      toast.error("Describe the mission objective first");
      return;
    }
    const id = crypto.randomUUID();
    const next: DemoMission = {
      id,
      title: prompt.trim().split("\n")[0].slice(0, 80),
      prompt: prompt.trim(),
      status: "awaiting_plan_approval",
      tasks: [
        {
          id: "T1",
          title: "Review the mission and define acceptance criteria",
          stage: "Queued",
          agent: "PM orchestrator",
          model: "claude-sonnet",
          tokens: 0,
          depends: [],
          retries: 0,
        },
      ],
    };
    setMissions((items) => [next, ...items]);
    setSelectedId(id);
    setPrompt("");

    try {
      const res = await fetch("/api/missions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: next.title,
          prompt: next.prompt,
          pause_after_planning: pause,
          workspace_path: workspace || undefined,
          max_parallel_workers: Number(workers) || 3,
          max_retries: Number(retries) || 2,
        }),
      });
      if (res.ok) {
        toast.success("Mission persisted to Supabase");
      } else {
        toast.success(
          `Mission created. ${pause ? "Plan approval selected." : "Execution pending."}`,
        );
      }
    } catch {
      toast.success(
        `Mission created. ${pause ? "Plan approval selected." : "Execution pending."}`,
      );
    }
  }
  function updateTask(id: string, stage: TaskStage) {
    setMissions((items) =>
      items.map((item) =>
        item.id === selectedId ? updateDemoTask(item, id, stage) : item,
      ),
    );
    toast.success(`Demo ${id}: ${stage.toLowerCase()}`);
  }
  return (
    <div className="space-y-8 p-4 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Mission control
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            One objective. A team built to move it forward.
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
            label: "MISSION STATUS",
            value:
              mission?.status === "running"
                ? "In progress"
                : mission?.status === "completed"
                  ? "Completed"
                  : mission?.status === "cancelled"
                    ? "Cancelled"
                    : "Awaiting plan",
            detail: "Local demonstration",
            icon: ActivityIcon,
            color: "text-amber-500 bg-amber-500/10 border-amber-500/20",
          },
          {
            label: "TASKS COMPLETED",
            value: `${done} / ${tasks.length}`,
            detail: "Across execution pipeline",
            icon: Check,
            color: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20",
          },
          {
            label: "TEAM CAPACITY",
            value: "6 agents",
            detail: "Sample team ready",
            icon: Layers3,
            color: "text-sky-400 bg-sky-500/10 border-sky-500/20",
          },
          {
            label: "TOKEN USAGE",
            value: formatCompactTokens(tokens),
            detail: "Illustrative usage",
            icon: Zap,
            color: "text-amber-400 bg-amber-500/10 border-amber-500/20",
          },
        ].map(({ label, value, detail, icon: Icon, color }) => (
          <div className="card-trendy p-5" key={label}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
                {label}
              </span>
              <span
                className={`flex size-7 items-center justify-center rounded-lg border ${color}`}
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
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">
            PROMPT → PLAN → EXECUTE
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
              <div className="flex items-center gap-4">
                <span className="hidden text-[10px] text-muted-foreground sm:block">
                  ⌘ / Ctrl + Enter
                </span>
                <Button type="submit" className="console-launch">
                  <Play className="size-3.5" />
                  Launch demo mission
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
                Options preview only. No workspace or parallel execution is
                started.
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
                className="mb-1 block text-[10px] tracking-widest text-muted-foreground"
              >
                CURRENT MISSION
              </label>
              <select
                id="mission-picker"
                className="w-full min-w-0 max-w-full truncate bg-transparent text-sm font-medium focus-visible:outline-2 focus-visible:outline-primary"
                value={selectedId}
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
              Demo state
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setMissions((items) =>
                  items.filter((item) => item.id !== selectedId),
                );
                setSelectedId(
                  missions.find((item) => item.id !== selectedId)?.id ?? "",
                );
              }}
            >
              Remove from preview
            </Button>
          </div>
        </div>
        {mission ? (
          <>
            <div className="card-trendy grid grid-cols-2 gap-3 p-4 lg:grid-cols-4">
              {["Plan DAG", "Write PRD", "Execute & verify", "Summary"].map(
                (step, index) => (
                  <div
                    key={step}
                    className={`flex items-center gap-3 text-xs ${index === 2 ? "text-foreground" : "text-muted-foreground"}`}
                  >
                    <span
                      className={`flex size-6 shrink-0 items-center justify-center rounded-full border font-mono text-[10px] ${index < 2 ? "border-primary/20 bg-primary/10 text-primary" : ""}`}
                    >
                      {index < 2 ? (
                        <Check className="size-3" />
                      ) : (
                        `0${index + 1}`
                      )}
                    </span>
                    {step}
                    {index === 2 && (
                      <span className="ml-auto rounded bg-primary/10 px-1.5 py-0.5 text-[9px] text-primary">
                        DEMO
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
                  Preview plan ready. Approve to explore the local task board.
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() =>
                      setMissions((items) =>
                        items.map((item) =>
                          item.id === selectedId
                            ? { ...item, status: "running" }
                            : item,
                        ),
                      )
                    }
                  >
                    Approve demo plan
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setMissions((items) =>
                        items.map((item) =>
                          item.id === selectedId
                            ? { ...item, status: "cancelled" }
                            : item,
                        ),
                      )
                    }
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
                    Artifacts <span className="font-mono text-[10px]">2</span>
                  </TabsTrigger>
                </TabsList>
                <span className="hidden text-[10px] text-muted-foreground sm:block">
                  SAMPLE WORKFLOW · NO LIVE EXECUTION
                </span>
              </div>
              <TabsContent value="board" className="mt-5">
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
                        <div className="console-tray min-h-60 space-y-3 rounded-lg p-2">
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
                                      Retry {task.retries}/{retries}
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
                                      onClick={() =>
                                        updateTask(task.id, "Queued")
                                      }
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
                            <div className="py-8 text-center text-[10px] text-muted-foreground">
                              No tasks
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </TabsContent>
              <TabsContent value="artifacts" className="mt-5">
                <MarkdownArtifactViewer title={mission.title} />
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
              Plan a DAG, write requirements, execute, then verify. Try a demo
              mission.
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
        {mission?.title}: {done} of {tasks.length} tasks done. Demo only.
      </div>
      <footer className="flex flex-wrap justify-between gap-2 border-t pt-4 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-2">
          <Square className="size-2.5" />
          Neiro / local preview
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
