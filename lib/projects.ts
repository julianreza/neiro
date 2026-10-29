import type { MissionStatus, MissionSummaryDTO } from "@/lib/types";

/**
 * A project is a row in the `projects` table. Missions and questions point
 * to it with `project_id`.
 */
export type ProjectBranch = {
  name: string;
  missionId: string;
  missionTitle: string;
  status: MissionStatus;
};

export type Project = {
  /** Row id in `projects`. */
  id: string;
  path: string;
  name: string;
  /** Base branch of the newest mission, when it named one. */
  baseBranch: string | null;
  missions: MissionSummaryDTO[];
  running: number;
  needsYou: number;
  done: number;
  branches: ProjectBranch[];
  /** True when the folder is a git repo (checked on disk). */
  git: boolean;
  /** Newest mission time, ISO. */
  lastActive: string | null;
};

export function projectName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

function newest(a: string | undefined, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) > Date.parse(b) ? a : b;
}

/**
 * The project list, from the `projects` table. Each mission joins the
 * project its `project_id` points to; missions without one are left out.
 * Busiest and newest first.
 */
export function groupProjects(missions: MissionSummaryDTO[], saved: SavedProject[]): Project[] {
  const byId = new Map<string, Project>();
  for (const s of saved) {
    byId.set(s.id, {
      id: s.id,
      path: s.path,
      name: s.name || projectName(s.path),
      baseBranch: null,
      missions: [],
      running: 0,
      needsYou: 0,
      done: 0,
      branches: [],
      git: s.git,
      lastActive: s.createdAt,
    });
  }
  for (const m of missions) {
    const p = m.projectId ? byId.get(m.projectId) : undefined;
    if (!p) continue;
    p.missions.push(m);
    if (m.status === "running") p.running += 1;
    if (m.status === "awaiting_plan_approval") p.needsYou += 1;
    if (m.status === "completed") p.done += 1;
    if (m.workBranch) {
      p.branches.push({ name: m.workBranch, missionId: m.id, missionTitle: m.title, status: m.status });
    }
    p.lastActive = newest(m.createdAt, p.lastActive);
  }
  for (const p of byId.values()) {
    p.missions.sort((a, b) => Date.parse(b.createdAt ?? "") - Date.parse(a.createdAt ?? ""));
    p.baseBranch = p.missions.find((m) => m.baseBranch)?.baseBranch ?? null;
  }
  return [...byId.values()].sort((a, b) => {
    const live = b.running + b.needsYou - (a.running + a.needsYou);
    if (live !== 0) return live;
    return Date.parse(b.lastActive ?? "") - Date.parse(a.lastActive ?? "");
  });
}

/** True when `path` is the project folder or a folder inside it. */
export function inProject(project: string, path: string | null | undefined): boolean {
  if (!path) return false;
  const clean = path.replace(/\/+$/, "");
  return clean === project || clean.startsWith(`${project}/`);
}

/** The deepest project whose folder holds `path`, if any. */
export function findProjectFor<T extends { path: string }>(projects: T[], path: string | null | undefined): T | undefined {
  return [...projects].sort((a, b) => b.path.length - a.path.length).find((p) => inProject(p.path, path));
}

/** A folder added by hand on the Projects page (table `projects`). */
export type SavedProject = {
  id: string;
  path: string;
  name: string;
  git: boolean;
  createdAt: string | null;
};

export const PROJECTS_TABLE = "projects";

export const MISSING_PROJECTS_TABLE =
  "The projects table is missing. Apply supabase/migrations/20261029000100_projects.sql.";

export function isMissingProjectsTable(message: string) {
  return /\bprojects\b/.test(message) && /does not exist|schema cache/i.test(message);
}

export function mapProjectRow(row: Record<string, unknown>): SavedProject {
  const path = String(row.path ?? "");
  return {
    id: String(row.id ?? ""),
    path,
    name: String(row.name ?? "") || projectName(path),
    git: row.git === true,
    createdAt: typeof row.created_at === "string" ? row.created_at : null,
  };
}
