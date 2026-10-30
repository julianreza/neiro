import "server-only";
import { projectRepos, type ProjectRepo } from "@/lib/github-pr";
import { isMissingProjectsTable, PROJECTS_TABLE, projectName } from "@/lib/projects";
import { getSupabaseAdmin } from "@/lib/supabase";

/** Every saved project whose folder is a GitHub git repo (its origin remote). */
export async function savedProjectRepos(): Promise<ProjectRepo[]> {
  const { data, error } = await getSupabaseAdmin()
    .from(PROJECTS_TABLE)
    .select("id, name, path")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    if (isMissingProjectsTable(error.message)) return [];
    throw new Error(error.message);
  }
  const projects = (data ?? [])
    .filter((p) => typeof p.path === "string" && p.path)
    .map((p) => ({
      id: String(p.id),
      name: typeof p.name === "string" && p.name ? p.name : projectName(String(p.path)),
      path: String(p.path),
    }));
  return projectRepos(projects);
}

/** A local checkout of `owner/repo` among the saved projects, or null. */
export async function findLocalCheckout(repo: string): Promise<string | null> {
  const want = repo.toLowerCase();
  const found = await savedProjectRepos().catch(() => []);
  return found.find((r) => r.repo.toLowerCase() === want)?.path ?? null;
}
