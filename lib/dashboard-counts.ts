import type { SupabaseClient } from "@supabase/supabase-js";

/** Old tasks without evidence of their finish time are never backdated. */
export async function countCompletedTasks(db: SupabaseClient, since: string, until: string): Promise<{ completed: number | null; withoutTime: number | null }> {
  const [recent, unknown] = await Promise.all([
    db.from("mission_tasks").select("id", { count: "exact", head: true }).eq("stage", "Done").gte("completed_at", since).lte("completed_at", until),
    db.from("mission_tasks").select("id", { count: "exact", head: true }).eq("stage", "Done").is("completed_at", null),
  ]);
  return { completed: recent.error ? null : recent.count, withoutTime: unknown.error ? null : unknown.count };
}
