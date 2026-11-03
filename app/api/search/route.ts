import { connection, NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { rankSearchResults, type SearchKind, type SearchResult } from "@/lib/workspace-search";

const SOURCES: { table: string; column: string; kind: SearchKind; mission: boolean }[] = [
  { table: "projects", column: "name", kind: "Projects", mission: false },
  { table: "missions", column: "title", kind: "Missions", mission: false },
  { table: "mission_tasks", column: "title", kind: "Tasks", mission: true },
  { table: "mission_artifacts", column: "title", kind: "Artifacts", mission: true },
];

export async function GET(request: NextRequest) {
  await connection();
  const query = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
  if (query.length < 2) return NextResponse.json({ results: [] });
  const escaped = query.replace(/[\\%_]/g, "\\$&");
  try {
    const db = getSupabaseAdmin();
    const groups = await Promise.all(SOURCES.map(async (source) => {
      const patterns = [escaped, `${escaped}%`, `%${escaped}%`];
      const responses = await Promise.all(patterns.map((pattern) => {
        let request = db.from(source.table).select(`id,${source.column},created_at${source.mission ? ",mission_id" : ""}`).ilike(source.column, pattern);
        if (source.kind === "Artifacts") request = request.neq("kind", "run_cost_provenance");
        return request.order("created_at", { ascending: false }).limit(5);
      }));
      const rows: SearchResult[] = [];
      for (const response of responses) {
        if (response.error) throw new Error(response.error.message);
        for (const raw of response.data ?? []) {
          const row = raw as unknown as Record<string, unknown>;
          const id = String(row.id);
          const missionId = source.mission ? String(row.mission_id) : id;
          const suffix = source.kind === "Tasks" ? `?task=${encodeURIComponent(id)}` : source.kind === "Artifacts" ? `?artifact=${encodeURIComponent(id)}` : "";
          const href = source.kind === "Projects" ? `/projects/${encodeURIComponent(id)}` : `/missions/${encodeURIComponent(missionId)}${suffix}`;
          rows.push({ id, title: String(row[source.column]), kind: source.kind, href, createdAt: String(row.created_at ?? "") });
        }
      }
      return rankSearchResults(rows, query);
    }));
    return NextResponse.json({ results: groups.flat() });
  } catch {
    return NextResponse.json({ error: "Search is unavailable. Try again." }, { status: 503 });
  }
}
