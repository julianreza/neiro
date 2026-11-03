import type { RunCostSource } from "@/lib/run-cost-sources";

const labels: Record<RunCostSource, string> = {
  reported: "Runtime reported",
  runtime_estimate: "Runtime estimate",
  catalog_estimate: "Catalog estimate",
  included: "Included in subscription",
  unknown: "Source unknown",
};

export function CostSources({ totals }: { totals?: Record<RunCostSource, { cost: number; count: number }> | null }) {
  if (!totals) return null;
  return <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-label="Cost sources">
    {(Object.keys(labels) as RunCostSource[]).filter((key) => totals[key]?.count > 0).map((key) => <li key={key}>{labels[key]}: ${totals[key].cost.toFixed(6)} · {totals[key].count} {totals[key].count === 1 ? "run" : "runs"}</li>)}
  </ul>;
}
