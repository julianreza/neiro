import { NextResponse } from "next/server";
import { connection } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { FolderError, isGitRepo, resolveFolder } from "@/lib/folders";
import { MISSING_PROJECTS_TABLE, PROJECTS_TABLE, isMissingProjectsTable, mapProjectRow, projectName } from "@/lib/projects";
import type { SavedProject } from "@/lib/projects";
import { AppConfigError } from "@/lib/types";

/** The row as the page shows it, with whether the folder is a git repo now. */
async function withGit(row: Record<string, unknown>): Promise<SavedProject> {
  const project = mapProjectRow(row);
  return { ...project, git: await isGitRepo(project.path) };
}

function failure(err: unknown, fallback: string) {
  if (err instanceof FolderError) return NextResponse.json({ error: err.message }, { status: err.status });
  if (err instanceof AppConfigError) return NextResponse.json({ error: err.message, code: err.code }, { status: 503 });
  return NextResponse.json({ error: err instanceof Error ? err.message : fallback }, { status: 500 });
}

/** Missions and chats in `path` with no project (e.g. after the project was removed) get `projectId`. */
async function relinkOrphans(projectId: string, path: string) {
  const supabase = getSupabaseAdmin();
  for (const table of ["missions", "ask_questions"] as const) {
    const { error } = await supabase
      .from(table)
      .update({ project_id: projectId })
      .is("project_id", null)
      .eq("workspace_path", path);
    if (error) console.warn(`[projects] could not relink ${table}:`, error.message);
  }
}

/** Folders added by hand on the Projects page, newest first. */
export async function GET() {
  await connection();
  try {
    const { data, error } = await getSupabaseAdmin()
      .from(PROJECTS_TABLE)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      if (isMissingProjectsTable(error.message)) {
        return NextResponse.json({ error: MISSING_PROJECTS_TABLE, code: "missing_table" }, { status: 503 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ projects: await Promise.all((data ?? []).map(withGit)) });
  } catch (err: unknown) {
    return failure(err, "Could not load projects");
  }
}

/** Add a folder as a project. `{ path }`; adding the same folder twice is fine. Admin only. */
export async function POST(request: NextRequest) {
  await connection();
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const raw = typeof body?.path === "string" ? body.path : "";
  if (!raw.trim()) return NextResponse.json({ error: "Pick a folder first." }, { status: 400 });
  try {
    const path = await resolveFolder(raw);
    const { data, error } = await getSupabaseAdmin()
      .from(PROJECTS_TABLE)
      .upsert({ path, name: projectName(path) }, { onConflict: "path" })
      .select("*")
      .single();
    if (error) {
      if (isMissingProjectsTable(error.message)) {
        return NextResponse.json({ error: MISSING_PROJECTS_TABLE, code: "missing_table" }, { status: 503 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    // Re-adding a removed project picks its old missions and chats back up.
    await relinkOrphans(String(data.id), path);
    return NextResponse.json({ project: await withGit(data) }, { status: 201 });
  } catch (err: unknown) {
    return failure(err, "Could not add the project");
  }
}
