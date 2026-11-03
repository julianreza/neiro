import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { costSourcesFromArtifacts, type RunCostSource } from "@/lib/run-cost-sources";

/** Read every provenance artifact for these run IDs, even with a lower server page cap. */
export async function loadRunCostSources(db: SupabaseClient, runIds: string[]): Promise<Map<string, { source: RunCostSource; costUsd: number }>> {
  const ids = [...new Set(runIds.filter(Boolean))];
  const records: Array<{ run_id?: unknown; content?: unknown }> = [];
  for (let start = 0; start < ids.length; start += 100) {
    const batch = ids.slice(start, start + 100);
    let offset = 0;
    for (;;) {
      const { data, error, count } = await db.from("mission_artifacts").select("run_id, content", { count: "exact" }).eq("kind", "run_cost_provenance").in("run_id", batch).order("id").range(offset, offset + 999);
      if (error) throw new Error(error.message);
      records.push(...(data ?? []));
      offset += data?.length ?? 0;
      if (count !== null && offset >= count) break;
      if (!data?.length) {
        if (count !== null && offset < count) throw new Error("Cost provenance page was incomplete.");
        break;
      }
      if (count === null && data.length < 1000) break;
    }
  }
  return costSourcesFromArtifacts(records);
}
