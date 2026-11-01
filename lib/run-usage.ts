import type { SupabaseClient } from "@supabase/supabase-js";
import type { TaskRunUsage } from "@/lib/types";

export function mapRunUsage(row: Record<string, unknown>): TaskRunUsage {
  const cost = row.cost_usd == null ? null : Number(row.cost_usd);
  return {
    runId: String(row.run_id ?? ""), taskId: String(row.task_id ?? ""), stage: String(row.stage ?? ""),
    tokens: Number(row.tokens) || 0, model: row.model ? String(row.model) : null,
    inputTokens: row.input_tokens == null ? null : Number(row.input_tokens) || 0,
    outputTokens: row.output_tokens == null ? null : Number(row.output_tokens) || 0,
    cacheReadTokens: row.cache_read_tokens == null ? null : Number(row.cache_read_tokens) || 0,
    costUsd: cost !== null && Number.isFinite(cost) && cost >= 0 ? cost : null,
    at: String(row.created_at ?? ""),
  };
}

/** Read all recorded runs so mission costs cannot be truncated by the API's page limit. */
export async function loadMissionRunUsage(db: SupabaseClient, missionId: string): Promise<TaskRunUsage[]> {
  const rows: TaskRunUsage[] = [];
  const pageSize = 1000;
  for (let offset = 0; ;) {
    const { data, error, count } = await db.from("agent_token_usage").select("*", { count: "exact" }).eq("mission_id", missionId)
      .order("created_at", { ascending: true }).order("run_id", { ascending: true }).range(offset, offset + pageSize - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []).map((row) => mapRunUsage(row as Record<string, unknown>)));
    offset += data?.length ?? 0;
    if (count !== null && offset >= count) return rows;
    if (!data?.length) {
      if (count !== null && offset < count) throw new Error("Run usage page was incomplete.");
      return rows;
    }
    if (count === null && data.length < pageSize) return rows;
  }
}
