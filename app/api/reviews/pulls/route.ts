import { NextResponse, connection } from "next/server";
import type { NextRequest } from "next/server";
import { listOpenPulls, parseRepoSlug, PrError, type OpenPull } from "@/lib/github-pr";
import { savedProjectRepos } from "@/lib/project-repos";
import { callerFrom } from "@/lib/reviews-api";

/** At most this many project repos are listed for "All repositories". */
const MAX_REPOS = 10;

/**
 * Open pull requests. `?repo=owner/repo` for one repo; without it, the open
 * PRs of every saved project's GitHub repo (first 10 repos).
 */
export async function GET(request: NextRequest) {
  await connection();
  if (!callerFrom(request.headers)) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const raw = request.nextUrl.searchParams.get("repo");
  try {
    let repos: string[];
    if (raw) {
      const slug = parseRepoSlug(raw);
      if (!slug) return NextResponse.json({ error: "repo must look like owner/repo." }, { status: 400 });
      repos = [slug];
    } else {
      repos = [...new Set((await savedProjectRepos()).map((r) => r.repo))].slice(0, MAX_REPOS);
    }
    const errors: string[] = [];
    const lists = await Promise.all(
      repos.map((repo) =>
        listOpenPulls(repo).catch((err: unknown) => {
          errors.push(err instanceof Error ? err.message : String(err));
          return [] as OpenPull[];
        }),
      ),
    );
    const pulls = lists.flat().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    // One repo asked for and gh failed: say why instead of an empty list.
    if (raw && errors.length > 0) {
      return NextResponse.json({ error: errors[0] }, { status: 502 });
    }
    return NextResponse.json({ pulls, repos, errors });
  } catch (err: unknown) {
    const message = err instanceof PrError || err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Could not list pull requests: ${message}` }, { status: 500 });
  }
}
