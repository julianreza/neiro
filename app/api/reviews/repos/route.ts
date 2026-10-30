import { NextResponse, connection } from "next/server";
import type { NextRequest } from "next/server";
import { projectRepos } from "@/lib/github-pr";
import { isMissingProjectsTable, PROJECTS_TABLE, projectName } from "@/lib/projects";
import { callerFrom } from "@/lib/reviews-api";
import { getSupabaseAdmin } from "@/lib/supabase";

/**
 * GitHub repos of the saved projects (their `origin` remote), for the repo
 * picker on /reviews. A project that is not a GitHub git repo is left out.
 */
export async function GET(request: NextRequest) {
  await connection();
  if (!callerFrom(request.headers)) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  try {
    const { data, error } = await getSupabaseAdmin()
      .from(PROJECTS_TABLE)
      .select("id, name, path")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      if (isMissingProjectsTable(error.message)) return NextResponse.json({ repos: [] });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const projects = (data ?? [])
      .filter((p) => typeof p.path === "string" && p.path)
      .map((p) => ({
        id: String(p.id),
        name: typeof p.name === "string" && p.name ? p.name : projectName(String(p.path)),
        path: String(p.path),
      }));
    const found = await projectRepos(projects);
    // One entry per repo; several folders can point at the same one.
    const byRepo = new Map<string, { repo: string; projects: string[] }>();
    for (const r of found) {
      const entry = byRepo.get(r.repo) ?? { repo: r.repo, projects: [] };
      entry.projects.push(r.projectName);
      byRepo.set(r.repo, entry);
    }
    return NextResponse.json({ repos: [...byRepo.values()].sort((a, b) => a.repo.localeCompare(b.repo)) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Could not read project repos: ${message}` }, { status: 500 });
  }
}
