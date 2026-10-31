import type { Agent, MissionDetailDTO, MissionTask } from "@/lib/types";

/**
 * Token budgets. `mission.tokenBudget` caps all task tokens in one mission;
 * `agent.tokenBudget` caps what one agent may spend inside one mission.
 * Null or 0 means no limit. Checked before a task run starts, so a run that
 * is already going is never cut off midway.
 */

export function missionTokensUsed(m: MissionDetailDTO): number {
  return m.tasks.reduce((sum, t) => sum + (Number(t.tokens) || 0), 0);
}

/**
 * Fallback for when the per-run usage table cannot be read: a task's
 * agent_id is only its latest stage's agent, so this over-counts that
 * agent and misses the others. Prefer the `agentUsed` from the store.
 */
export function agentTokensUsed(m: MissionDetailDTO, agentId: string): number {
  return m.tasks
    .filter((t) => t.agentId === agentId)
    .reduce((sum, t) => sum + (Number(t.tokens) || 0), 0);
}

/**
 * Prompt tokens Hermes served from its cache, over a mission's tasks.
 * `readShare` is the part of all tokens read from cache, in percent with one
 * decimal (0 when nothing was spent).
 */
export function cacheSummary(
  tasks: Pick<MissionTask, "tokens" | "cacheReadTokens" | "cacheWriteTokens">[],
): { readTokens: number; writeTokens: number; readShare: number } {
  let total = 0;
  let readTokens = 0;
  let writeTokens = 0;
  for (const t of tasks) {
    total += Number(t.tokens) || 0;
    readTokens += Number(t.cacheReadTokens) || 0;
    writeTokens += Number(t.cacheWriteTokens) || 0;
  }
  const readShare = total > 0 ? Math.round((readTokens / total) * 1000) / 10 : 0;
  return { readTokens, writeTokens, readShare };
}

export type BudgetBlock = { scope: "mission" | "agent"; used: number; limit: number; message: string };

function limitOf(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Why this agent may not start another run in this mission, or null.
 * `agentUsed` is what the agent's own runs spent here (agent_token_usage);
 * null or omitted falls back to the task-based count.
 */
export function budgetBlock(
  m: MissionDetailDTO,
  agent: Pick<Agent, "id" | "name" | "tokenBudget">,
  agentUsed?: number | null,
): BudgetBlock | null {
  const missionLimit = limitOf(m.tokenBudget);
  if (missionLimit !== null) {
    const used = missionTokensUsed(m);
    if (used >= missionLimit) {
      return {
        scope: "mission",
        used,
        limit: missionLimit,
        message: `Mission token budget reached: ${used.toLocaleString("en-US")} of ${missionLimit.toLocaleString("en-US")} used. Raise the budget, then retry the task.`,
      };
    }
  }

  const agentLimit = limitOf(agent.tokenBudget);
  if (agentLimit !== null) {
    const used = typeof agentUsed === "number" ? agentUsed : agentTokensUsed(m, agent.id);
    if (used >= agentLimit) {
      return {
        scope: "agent",
        used,
        limit: agentLimit,
        message: `${agent.name} reached its token budget for this mission: ${used.toLocaleString("en-US")} of ${agentLimit.toLocaleString("en-US")} used. Raise the agent's budget, then retry the task.`,
      };
    }
  }

  return null;
}

/** Validates an optional budget from a request body: null, or a positive integer. */
export function parseTokenBudget(
  value: unknown,
  field: string
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (value === undefined || value === null || value === 0) return { ok: true, value: null };
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 1_000_000_000) {
    return { ok: false, error: `${field} must be a whole number between 0 and 1000000000 (0 = no limit)` };
  }
  return { ok: true, value };
}
