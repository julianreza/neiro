import { connection, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { summarizeRunCosts } from "@/lib/usage-cost";
import { matchingCostSource, summarizeCostSources, type RunCostSource } from "@/lib/run-cost-sources";
import { loadRunCostSources } from "@/lib/run-cost-sources-store";

/** All recorded mission runs for this agent; unknown costs remain unknown. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  await connection();
  try {
    const { id } = await context.params;
    const db = getSupabaseAdmin();
    const rows: { runId: string; costUsd: number | null; costSource?: RunCostSource }[] = [];
    const size = 1000;
    for (let offset = 0; ;) {
      const { data, error, count } = await db.from("agent_token_usage").select("run_id, cost_usd", { count: "exact" }).eq("agent_id", id).order("run_id").range(offset, offset + size - 1);
      if (error) throw error;
      for (const row of data ?? []) {
        const cost = row.cost_usd == null ? null : Number(row.cost_usd);
        rows.push({ runId: String(row.run_id ?? ""), costUsd: cost !== null && Number.isFinite(cost) && cost >= 0 ? cost : null });
      }
      offset += data?.length ?? 0;
      if (count !== null && offset >= count) break;
      if (!data?.length) {
        if (count !== null && offset < count) throw new Error("Agent usage page was incomplete.");
        break;
      }
      if (count === null && data.length < size) break;
    }
    try {
      const sources = await loadRunCostSources(db, rows.map((row) => row.runId));
      for (const row of rows) row.costSource = matchingCostSource(row.costUsd, sources.get(row.runId));
    } catch (error) { console.warn("[agent-cost] cost sources unavailable", error); }
    return NextResponse.json({ ...summarizeRunCosts(rows), costSources: summarizeCostSources(rows) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load agent usage" }, { status: 503 });
  }
}
