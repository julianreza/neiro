import { listHermesModelOptions, type HermesRunStatus } from "@/lib/hermes";
import { asRuntime, type Agent } from "@/lib/types";

/** Rates are the approximate USD-per-million amounts returned by Hermes' picker. */
type Rates = { input?: number; output?: number; cacheRead?: number };
type Usage = { input_tokens?: number; output_tokens?: number; cache_read_tokens?: number };

const valid = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Estimate list-price cost, not an invoice. Unknown cache pricing uses the input rate. */
export function estimateRunCost(usage: Usage, rates: Rates): number | null {
  const { input_tokens: input, output_tokens: output, cache_read_tokens: cached = 0 } = usage;
  if (!valid(input) || !valid(output) || !valid(cached) || cached > input || !valid(rates.input) || !valid(rates.output)) return null;
  const cacheRate = valid(rates.cacheRead) ? rates.cacheRead : rates.input;
  return Math.round(((input - cached) * rates.input + cached * cacheRate + output * rates.output)) / 1_000_000;
}

export function summarizeRunCosts(rows: Array<{ costUsd?: number | null }>): { cost: number | null; priced: number; total: number } {
  const known = rows.map((row) => row.costUsd).filter(valid);
  return { cost: known.length ? known.reduce((sum, n) => sum + n, 0) : null, priced: known.length, total: rows.length };
}

/** Best effort only: pricing must never prevent the run from advancing. */
export async function estimateAgentRunCost(agent: Agent, run: HermesRunStatus): Promise<number | null> {
  if (valid(run.estimated_cost_usd) && ["actual", "estimated", "included"].includes(run.cost_status ?? "")) return run.estimated_cost_usd;
  if (asRuntime(agent.runtime) !== "hermes" || !valid(run.input_tokens) || !valid(run.output_tokens)) return null;
  try {
    const catalog = await listHermesModelOptions(agent, { signal: AbortSignal.timeout(2500) });
    const model = run.runtime?.model || run.model || agent.model;
    const provider = run.runtime?.provider || process.env.HERMES_PROVIDER_SLUG || (model === catalog.currentModel ? catalog.currentProvider : "");
    const rates = catalog.models.find((option) => option.id === model && option.provider === provider)?.pricing;
    return rates ? estimateRunCost(run, rates) : null;
  } catch {
    return null;
  }
}
