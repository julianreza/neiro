export type RunCostSource = "reported" | "runtime_estimate" | "catalog_estimate" | "included" | "unknown";
const sources = new Set<RunCostSource>(["reported", "runtime_estimate", "catalog_estimate", "included", "unknown"]);
const validAmount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

/** A value without a trustworthy origin is deliberately left unknown. */
export function costSourceForRun(run: { estimated_cost_usd?: number; cost_status?: string }, cost: number | null, usedCatalogEstimator: boolean): RunCostSource {
  if (!validAmount(cost)) return "unknown";
  if (validAmount(run.estimated_cost_usd) && run.estimated_cost_usd === cost) {
    if (run.cost_status === "actual") return "reported";
    if (run.cost_status === "estimated") return "runtime_estimate";
    if (run.cost_status === "included") return "included";
  }
  return usedCatalogEstimator ? "catalog_estimate" : "unknown";
}

/** Read only verified per-run provenance artifacts; older records have no source. */
export function costSourcesFromArtifacts(rows: Array<{ run_id?: unknown; content?: unknown }>): Map<string, { source: RunCostSource; costUsd: number }> {
  const result = new Map<string, { source: RunCostSource; costUsd: number }>();
  const conflicts = new Set<string>();
  for (const row of rows) {
    if (typeof row.run_id !== "string" || typeof row.content !== "string") continue;
    try {
      const parsed = JSON.parse(row.content) as { runId?: unknown; source?: unknown; costUsd?: unknown };
      if (parsed.runId !== row.run_id || typeof parsed.source !== "string" || !sources.has(parsed.source as RunCostSource) || !validAmount(parsed.costUsd)) continue;
      const source = parsed.source as RunCostSource;
      const existing = result.get(row.run_id);
      if (existing && (existing.source !== source || existing.costUsd !== parsed.costUsd)) { result.delete(row.run_id); conflicts.add(row.run_id); }
      else if (!conflicts.has(row.run_id)) result.set(row.run_id, { source, costUsd: parsed.costUsd });
    } catch { /* Corrupt provenance never changes the cost's source. */ }
  }
  return result;
}

/** A concurrent write must not attribute a different saved value. */
export function matchingCostSource(cost: number | null | undefined, saved?: { source: RunCostSource; costUsd: number }): RunCostSource {
  return validAmount(cost) && saved && Math.round(saved.costUsd * 1_000_000) === Math.round(cost * 1_000_000) ? saved.source : "unknown";
}

export function summarizeCostSources(rows: Array<{ costUsd?: number | null; costSource?: RunCostSource }>): Record<RunCostSource, { cost: number; count: number }> {
  const totals: Record<RunCostSource, { cost: number; count: number }> = {
    reported: { cost: 0, count: 0 }, runtime_estimate: { cost: 0, count: 0 }, catalog_estimate: { cost: 0, count: 0 }, included: { cost: 0, count: 0 }, unknown: { cost: 0, count: 0 },
  };
  for (const row of rows) {
    if (!validAmount(row.costUsd)) continue;
    const source = row.costSource && sources.has(row.costSource) ? row.costSource : "unknown";
    totals[source].cost += row.costUsd;
    totals[source].count++;
  }
  return totals;
}
