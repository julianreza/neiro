import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readCountedPages } from "@/lib/counted-pages";

/** Run references recorded by Neiro, grouped by the agent actually running them. */
export async function agentActivity(db: SupabaseClient): Promise<Map<string, Set<string>>> {
  // PostgREST filters preserve the builder type while changing its generic result.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pages = (table: string, fields: string, filter: (query: any) => any) =>
    readCountedPages<Record<string, unknown>>((from, to) =>
      filter(db.from(table).select(fields, { count: "exact" })).order("id").range(from, to),
    );
  const [missions, tasks, asks, rooms, reviews] = await Promise.all([
    pages("missions", "id,run_id,run_agent_id", (q) => q.not("run_id", "is", null)),
    pages("mission_tasks", "id,run_id,run_agent_id", (q) => q.not("run_id", "is", null)),
    pages("ask_questions", "id,agent_id", (q) => q.eq("status", "running")),
    pages("bot_rooms", "id,driver", (q) => q.not("driver", "is", null)),
    pages("code_reviews", "id,run_id,agent_id", (q) => q.in("status", ["fetching", "reviewing"]).not("run_id", "is", null)),
  ]);
  const result = new Map<string, Set<string>>();
  const add = (agent: unknown, run: unknown) => {
    if (typeof agent !== "string" || !agent || typeof run !== "string" || !run) return;
    const runs = result.get(agent) ?? new Set<string>();
    runs.add(run);
    result.set(agent, runs);
  };
  for (const row of [...missions, ...tasks]) add(row.run_agent_id, row.run_id);
  for (const row of asks) add(row.agent_id, row.id);
  for (const row of reviews) add(row.agent_id, row.run_id);
  for (const row of rooms) {
    const driver = row.driver as { claim?: { agentId?: unknown; runId?: unknown } } | null;
    add(driver?.claim?.agentId, driver?.claim?.runId);
  }
  return result;
}
