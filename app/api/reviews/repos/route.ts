import { NextResponse, connection } from "next/server";
import type { NextRequest } from "next/server";
import { savedProjectRepos } from "@/lib/project-repos";
import { callerFrom } from "@/lib/reviews-api";

/**
 * GitHub repos of the saved projects (their `origin` remote), for the repo
 * picker on /reviews. A project that is not a GitHub git repo is left out.
 */
export async function GET(request: NextRequest) {
  await connection();
  if (!callerFrom(request.headers)) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  try {
    const found = await savedProjectRepos();
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
