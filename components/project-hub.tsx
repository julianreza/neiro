"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { FolderGit2, GitBranch, Loader2, MessageCircleQuestionMark, Plus, Rocket } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StoryEmpty, StoryPill } from "@/components/history-story";
import type { StoryTone } from "@/components/history-story";
import { rememberFolder, useFolderDialog } from "@/components/folder-picker";
import { MissionRail, RailLegend } from "@/components/mission-rail-card";
import { ProjectComposer } from "@/components/project-composer";
import { useRole } from "@/hooks/use-role";
import { projectHref, timeAgo } from "@/lib/client-api";
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

  useEffect(() => {
    let cancelled = false;
    // The list comes from the projects table; missions and questions fill it in.
    getJson("/api/projects")
      .then((d) => !cancelled && setSaved({ state: "ready", data: Array.isArray(d.projects) ? d.projects : [] }))
      .catch((e: Error) => !cancelled && setSaved({ state: "error", message: e.message }));
    getJson("/api/missions?limit=200")
      .then((d) => !cancelled && setMissions(Array.isArray(d.missions) ? d.missions : []))
      .catch((e: Error) => !cancelled && setMissionsError(e.message));
    getJson("/api/questions?limit=100")
      .then((d) => !cancelled && setQuestions(Array.isArray(d.questions) ? d.questions : []))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const projects = useMemo(
    () => (saved.state === "ready" ? groupProjects(missions, saved.data) : []),
    [missions, saved],
  );
  const project = projects.find((p) => p.id === picked) ?? projects[0] ?? null;
  const asked = useMemo(
    () => (project ? questions.filter((q) => q.projectId === project.id) : []),
    [project, questions],
  );

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
  const addButton = canAdd && (
    <Button className="min-h-10" onClick={() => folders.open("folder", project?.path.split("/").slice(0, -1).join("/"))}>
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
          <nav className="project-list" aria-label="Projects">
            <ul>
              {projects.map((p) => (
                <li key={p.path}>
                  <button
                    type="button"
                    className="project-item"
                    aria-current={p.id === project.id ? "true" : undefined}
                    onClick={() => setPicked(p.id)}
                  >
                    <span className="project-dot" data-tone={projectTone(p)} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{p.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{projectLine(p)}</span>
                    </span>
                    {p.git && (
                      <span className="project-git" title="Git repo">
                        git
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <section className="project-detail" aria-labelledby="project-title">
            <header className="project-detail-head">
              <div className="min-w-0">
                <h2 id="project-title" className="truncate text-lg font-semibold tracking-tight">
                  {project.name}
                </h2>
                <p className="truncate text-xs text-muted-foreground">
                  <span className="code-chip">{project.path}</span>
                  {project.baseBranch && (
                    <>
                      {" "}
                      on <span className="code-chip">{project.baseBranch}</span>
                    </>
                  )}
                </p>
              </div>
              <Button asChild variant="outline" className="min-h-10">
                <Link href={projectHref(project.id)}>
                  <Rocket aria-hidden="true" />
                  Open Mission control
                </Link>
              </Button>
            </header>

            {canAdd && (
              <ProjectComposer key={project.id} projectId={project.id} path={project.path} inputRef={composerRef} />
            )}

            <Tabs defaultValue="missions" key={project.path}>
              <TabsList aria-label="Project details" className="history-seg">
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
                  Questions <span className="project-count">{asked.length}</span>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="missions">
                {project.missions.length === 0 ? (
                  <p className="project-none">No missions here yet. Write one above to give the team work.</p>
                ) : (
                  <div className="project-rails">
                    <RailLegend />
                    <ol className="rail-list">
                      {project.missions.map((m) => (
                        <MissionRail key={m.id} mission={m} />
                      ))}
                    </ol>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="branches">
                {project.branches.length === 0 ? (
                  <p className="project-none">No mission branches. Missions here ran without a worktree.</p>
                ) : (
                  <ul className="project-rows">
                    {project.branches.map((b) => (
                      <li key={`${b.missionId}:${b.name}`}>
                        <Link href={projectHref(project.id, { mission: b.missionId })} className="project-row">
                          <GitBranch className="size-4 text-primary" aria-hidden="true" />
                          <span className="code-chip truncate">{b.name}</span>
                          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                            {b.missionTitle}
                          </span>
                          <StoryPill tone={STATUS[b.status].tone}>{STATUS[b.status].label}</StoryPill>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>

              <TabsContent value="questions">
                {asked.length === 0 ? (
                  <p className="project-none">No questions asked about this project yet.</p>
                ) : (
                  <ul className="project-rows">
                    {asked.map((q) => (
                      <li key={q.id}>
                        <Link href={`/chat?chat=${encodeURIComponent(q.id)}`} className="project-row">
                          <MessageCircleQuestionMark className="size-4 text-primary" aria-hidden="true" />
                          <span className="min-w-0 flex-1 truncate">{q.question}</span>
                          <span className="text-xs text-muted-foreground">{timeAgo(q.createdAt)}</span>
                          <StoryPill tone={ASK_TONE[q.status]}>{q.agentName}</StoryPill>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>
            </Tabs>
          </section>
        </div>
      )}
    </div>
  );
}
