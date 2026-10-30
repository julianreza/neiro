"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FolderGit2, GitBranch, Loader2, MessageCircleQuestionMark, Plus, Rocket } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Picker } from "@/components/ui/picker";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StoryEmpty } from "@/components/history-story";
import type { StoryTone } from "@/components/history-story";
import { rememberFolder, useFolderDialog } from "@/components/folder-picker";
import { MissionWorkspace } from "@/components/mission-workspace";
import { ProjectSettings } from "@/components/project-settings";
import { ProjectComposer } from "@/components/project-composer";
import { ProjectQuestionPanel } from "@/components/project-question-panel";
import { useRole } from "@/hooks/use-role";
import { timeAgo } from "@/lib/client-api";
import { groupThreads } from "@/lib/chats";
import { groupProjects } from "@/lib/projects";
import type { Project, SavedProject } from "@/lib/projects";
import type { AskQuestionDTO } from "@/lib/ask-history";
import type { MissionStatus, MissionSummaryDTO } from "@/lib/types";

const STATUS: Record<MissionStatus, { tone: StoryTone; label: string }> = {
  running: { tone: "live", label: "Running" },
  awaiting_plan_approval: { tone: "wait", label: "Needs you" },
  completed: { tone: "done", label: "Done" },
  cancelled: { tone: "off", label: "Cancelled" },
};

const ASK_TONE: Record<AskQuestionDTO["status"], StoryTone> = {
  completed: "done",
  running: "live",
  failed: "bad",
  stopped: "off",
};

/** Picker value for the "+ Add project" row in the project dropdown. */
const ADD_PROJECT = "__add_project__";

/** The mission or chat shown under the composer. */
type Opened = { kind: "mission" | "question"; id: string };

type Load<T> = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; data: T };

async function getJson(url: string) {
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : `Couldn't load (${res.status})`);
  return data;
}

/** One short line under a project name: what needs looking at first. */
function projectLine(p: Project): string {
  if (p.missions.length === 0) return "No missions yet";
  if (p.needsYou > 0) return `${p.needsYou} needs you`;
  if (p.running > 0) return `${p.running} running`;
  const ago = timeAgo(p.lastActive);
  return ago ? `Idle, last ${ago}` : "Idle";
}

function projectTone(p: Project): StoryTone {
  if (p.needsYou > 0) return "wait";
  if (p.running > 0) return "live";
  return "off";
}

export function ProjectHub() {
  const role = useRole();
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [saved, setSaved] = useState<Load<SavedProject[]>>({ state: "loading" });
  const [missions, setMissions] = useState<MissionSummaryDTO[]>([]);
  const [missionsError, setMissionsError] = useState("");
  const [questions, setQuestions] = useState<AskQuestionDTO[]>([]);
  // `?project=<id>` (from Mission control's "New mission") picks that project.
  const [picked, setPicked] = useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("project"),
  );

  // Missions and questions refresh every 10s (while the tab is visible) and
  // right after the composer starts or finishes something. A running answer
  // re-reads only the questions.
  const [tick, setTick] = useState(0);
  const [questionTick, setQuestionTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  const refreshQuestions = useCallback(() => setQuestionTick((t) => t + 1), []);
  // What the panel under the composer shows; null = the project's newest item.
  const [opened, setOpened] = useState<Opened | null>(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    const mission = params.get("mission");
    const chat = params.get("chat");
    return mission ? { kind: "mission", id: mission } : chat ? { kind: "question", id: chat } : null;
  });

  useEffect(() => {
    let cancelled = false;
    // The list comes from the projects table; missions and questions fill it in.
    getJson("/api/projects")
      .then((d) => !cancelled && setSaved({ state: "ready", data: Array.isArray(d.projects) ? d.projects : [] }))
      .catch((e: Error) => !cancelled && setSaved({ state: "error", message: e.message }));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getJson("/api/missions?limit=200")
      .then((d) => {
        if (cancelled) return;
        setMissions(Array.isArray(d.missions) ? d.missions : []);
        setMissionsError("");
      })
      .catch((e: Error) => !cancelled && setMissionsError(e.message));
    return () => {
      cancelled = true;
    };
  }, [tick]);

  useEffect(() => {
    let cancelled = false;
    getJson("/api/questions?limit=100")
      .then((d) => !cancelled && setQuestions(Array.isArray(d.questions) ? d.questions : []))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [tick, questionTick]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 10_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const projects = useMemo(
    () => (saved.state === "ready" ? groupProjects(missions, saved.data) : []),
    [missions, saved],
  );
  const project = projects.find((p) => p.id === picked) ?? projects[0] ?? null;
  const asked = useMemo(
    () =>
      project
        ? questions.filter((q) => q.projectId === project.id || (!q.projectId && q.workspacePath === project.path))
        : [],
    [project, questions],
  );
  // One row per chat: a question and its follow-ups.
  const threads = useMemo(() => groupThreads(asked), [asked]);

  // The newest mission or chat of the project, shown when nothing is picked.
  const newest: Opened | null = useMemo(() => {
    if (!project) return null;
    const at = (s?: string | null) => (s ? Date.parse(s) || 0 : 0);
    const m = project.missions.reduce<MissionSummaryDTO | null>(
      (best, x) => (!best || at(x.createdAt) > at(best.createdAt) ? x : best),
      null,
    );
    const t = threads[0];
    if (!m && !t) return null;
    if (m && (!t || at(m.createdAt) >= at(t.lastAt))) return { kind: "mission", id: m.id };
    return { kind: "question", id: t.id };
  }, [project, threads]);
  const shown = opened ?? newest;
  const shownThread =
    shown?.kind === "question"
      ? (threads.find((t) => t.id === shown.id || t.messages.some((m) => m.id === shown.id)) ?? null)
      : null;

  function pickProject(id: string) {
    setPicked(id);
    setOpened(null);
  }

  // `?compose=1` focuses the composer once the project has loaded.
  const ready = project !== null;
  useEffect(() => {
    if (!ready || !new URLSearchParams(window.location.search).has("compose")) return;
    const frame = requestAnimationFrame(() => composerRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [ready]);

  async function addProject(path: string): Promise<string | void> {
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return typeof data.error === "string" ? data.error : `Couldn't add (${res.status})`;
      const added = data.project as SavedProject;
      setSaved((list) => ({
        state: "ready",
        data: [added, ...(list.state === "ready" ? list.data.filter((p) => p.path !== added.path) : [])],
      }));
      setPicked(added.id);
      setOpened(null);
      rememberFolder(added.path);
      toast.success(`Added ${added.name}`);
    } catch {
      return "Network error";
    }
  }

  const folders = useFolderDialog({
    onPicked: addProject,
    folderTitle: "Add a project folder",
    folderAction: "Add folder",
    cloneAction: "Clone & add",
  });
  const canAdd = role === "admin";
  const openAdd = () => folders.open("folder", project?.path.split("/").slice(0, -1).join("/"));
  // With no projects there is no dropdown yet, so show the button instead.
  const addButton = canAdd && !project && (
    <Button className="min-h-10" onClick={openAdd}>
      <Plus aria-hidden="true" />
      Add project
    </Button>
  );

  return (
    <div className="w-full p-4 md:p-8">
      <div className="history-head">
        <span className="history-mark" aria-hidden="true">
          <FolderGit2 className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground">Folders your AI team works in.</p>
        </div>
        {addButton}
      </div>
      {folders.element}

      {missionsError && saved.state === "ready" && (
        <p className="project-note" role="status">
          Missions can&apos;t load: {missionsError}
        </p>
      )}

      {saved.state === "loading" && (
        <p className="mt-8 flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading projects…
        </p>
      )}
      {saved.state === "error" && (
        <p className="mt-8 text-sm text-destructive" role="alert">
          {saved.message}
        </p>
      )}
      {saved.state === "ready" && !project && (
        <div className="mt-8">
          <StoryEmpty
            title="No projects yet"
            body={
              canAdd ? (
                <>
                  Press <b>Add project</b> to add a folder or clone a repo.
                </>
              ) : (
                "Ask an admin to add a project."
              )
            }
          />
        </div>
      )}

      {project && (
        <div className="project-hub">
          <aside className="project-list" aria-label="Project">
            <div className="project-pick">
              <span className="project-dot" data-tone={projectTone(project)} aria-hidden="true" />
              <Picker
                value={project.id}
                onChange={(v) => (v === ADD_PROJECT ? openAdd() : pickProject(v))}
                options={[
                  ...projects.map((p) => ({
                    value: p.id,
                    label: p.name,
                    hint: p.git ? `git · ${projectLine(p)}` : projectLine(p),
                  })),
                  ...(canAdd ? [{ value: ADD_PROJECT, label: "+ Add project", group: " " }] : []),
                ]}
                searchable={projects.length > 6}
                searchPlaceholder="Find a project…"
                aria-label="Project"
                className="min-w-0 flex-1"
              />
            </div>

            <Tabs defaultValue={shown?.kind === "question" ? "questions" : "missions"} key={project.path}>
              <TabsList aria-label="Project details" className="history-seg project-tabs">
                <TabsTrigger value="missions">
                  <Rocket aria-hidden="true" />
                  Missions <span className="project-count">{project.missions.length}</span>
                </TabsTrigger>
                <TabsTrigger value="branches">
                  <GitBranch aria-hidden="true" />
                  Branches <span className="project-count">{project.branches.length}</span>
                </TabsTrigger>
                <TabsTrigger value="questions">
                  <MessageCircleQuestionMark aria-hidden="true" />
                  Questions <span className="project-count">{threads.length}</span>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="missions">
                {project.missions.length === 0 ? (
                  <p className="project-none">No missions yet. Write one on the right.</p>
                ) : (
                  <ul className="project-rows">
                    {project.missions.map((m) => (
                      <li key={m.id}>
                        <button
                          type="button"
                          className="project-row"
                          aria-current={shown?.kind === "mission" && shown.id === m.id ? "true" : undefined}
                          onClick={() => setOpened({ kind: "mission", id: m.id })}
                        >
                          <span className="project-dot" data-tone={STATUS[m.status].tone} aria-hidden="true" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{m.title}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {STATUS[m.status].label} · {m.completedTasks}/{m.totalTasks} tasks · {timeAgo(m.createdAt)}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>

              <TabsContent value="branches">
                {project.branches.length === 0 ? (
                  <p className="project-none">No mission branches yet.</p>
                ) : (
                  <ul className="project-rows">
                    {project.branches.map((b) => (
                      <li key={`${b.missionId}:${b.name}`}>
                        <button
                          type="button"
                          className="project-row"
                          aria-current={shown?.kind === "mission" && shown.id === b.missionId ? "true" : undefined}
                          onClick={() => setOpened({ kind: "mission", id: b.missionId })}
                        >
                          <span className="project-dot" data-tone={STATUS[b.status].tone} aria-hidden="true" />
                          <span className="min-w-0 flex-1">
                            <span className="code-chip block truncate">{b.name}</span>
                            <span className="block truncate text-xs text-muted-foreground">{b.missionTitle}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>

              <TabsContent value="questions">
                {threads.length === 0 ? (
                  <p className="project-none">No questions yet.</p>
                ) : (
                  <ul className="project-rows">
                    {threads.map((t) => (
                      <li key={t.id}>
                        <button
                          type="button"
                          className="project-row"
                          aria-current={shownThread?.id === t.id ? "true" : undefined}
                          onClick={() => setOpened({ kind: "question", id: t.id })}
                        >
                          <span className="project-dot" data-tone={ASK_TONE[t.status]} aria-hidden="true" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{t.title}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {t.status === "running" ? "Answering…" : timeAgo(t.lastAt)}
                              {t.messages.length > 1 && ` · ${t.messages.length} messages`}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>
            </Tabs>
          </aside>

          <section className="project-detail" aria-labelledby="project-title">
            <header className="project-detail-head">
              <h2 id="project-title" className="min-w-0 truncate text-lg font-semibold tracking-tight">
                {project.name}
              </h2>
              <ProjectSettings
                project={project}
                canDelete={canAdd}
                onDeleted={() => {
                  setSaved((list) =>
                    list.state === "ready" ? { state: "ready", data: list.data.filter((p) => p.id !== project.id) } : list,
                  );
                  setPicked(null);
                  setOpened(null);
                }}
              />
            </header>

            {canAdd && (
              <ProjectComposer
                key={project.id}
                projectId={project.id}
                path={project.path}
                inputRef={composerRef}
                onChanged={refresh}
                onOpen={(item) => {
                  setOpened(item);
                  refresh();
                }}
              />
            )}

            {shown?.kind === "mission" && (
              <div className="project-open">
                <MissionWorkspace
                  key={`${project.id}:${shown.id}`}
                  project={project}
                  embedded
                  missionId={shown.id}
                  onDeleted={() => {
                    setMissions((list) => list.filter((m) => m.id !== shown.id));
                    setOpened(null);
                  }}
                />
              </div>
            )}
            {shown?.kind === "question" &&
              (shownThread ? (
                <ProjectQuestionPanel
                  key={shownThread.id}
                  thread={shownThread}
                  projectPath={project.path}
                  canSend={canAdd}
                  onReload={refreshQuestions}
                  onDeleted={() => {
                    const gone = new Set(shownThread.messages.map((m) => m.id));
                    setQuestions((list) => list.filter((q) => !gone.has(q.id)));
                    setOpened(null);
                  }}
                />
              ) : (
                <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading the chat…
                </p>
              ))}
          </section>
        </div>
      )}
    </div>
  );
}
