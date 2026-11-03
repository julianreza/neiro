import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase";
import { compactSteps, readSavedSteps, RUN_ID } from "@/lib/run-steps";
import type { LogStep } from "@/lib/run-events";
import type { SubagentRun } from "@/lib/types";

const TABLE = "run_steps";

/** Before 20261031000200_run_steps.sql runs, the table is missing: skip quietly. */
function missingTable(error: { code?: string } | null): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

/**
 * Keep a finished run's steps. A shorter list never replaces a longer one,
 * so a viewer who joined late can't overwrite the full record.
 */
export async function saveRunSteps(runId: string, steps: LogStep[]): Promise<void> {
  if (!RUN_ID.test(runId)) return;
  const kept = compactSteps(steps);
  if (kept.length === 0) return;
  const db = getSupabaseAdmin();
  const { data, error: readError } = await db.from(TABLE).select("step_count").eq("run_id", runId).maybeSingle();
  if (missingTable(readError)) return;
  if (readError) throw new Error(readError.message);
  if (data && Number((data as { step_count?: unknown }).step_count) > kept.length) return;
  const { error } = await db
    .from(TABLE)
    .upsert(
      { run_id: runId, steps: kept, step_count: kept.length, updated_at: new Date().toISOString() },
      { onConflict: "run_id" },
    );
  if (error && !missingTable(error)) throw new Error(error.message);
}

/** Saved steps for these runs; a run with none is left out. */
export async function loadRunSteps(runIds: string[]): Promise<Record<string, LogStep[]>> {
  const ids = [...new Set(runIds.filter((id) => RUN_ID.test(id)))].slice(0, 100);
  if (ids.length === 0) return {};
  const { data, error } = await getSupabaseAdmin().from(TABLE).select("run_id, steps").in("run_id", ids);
  if (missingTable(error)) return {};
  if (error) throw new Error(error.message);
  const out: Record<string, LogStep[]> = {};
  for (const row of (data ?? []) as { run_id: string; steps: unknown }[]) {
    const steps = readSavedSteps(row.steps);
    if (steps.length) out[row.run_id] = steps;
  }
  return out;
}

/** Persist a timestamp only for observed event frames, never a polling read. */
export async function recordRunActivity(runId: string, event: { at: string; terminal: boolean }): Promise<void> {
  if (!RUN_ID.test(runId)) return;
  const { error } = await getSupabaseAdmin().rpc("record_run_activity", { p_run_id: runId, p_observed_at: event.at, p_terminal: event.terminal });
  if (error && error.code !== "42883" && error.code !== "PGRST202") throw new Error(error.message);
}

export async function loadRunActivity(runIds: string[]): Promise<Record<string, { at: string; terminal: boolean }>> {
  const ids = [...new Set(runIds.filter((id) => RUN_ID.test(id)))].slice(0, 100);
  if (!ids.length) return {};
  const { data, error } = await getSupabaseAdmin().from("run_activity").select("run_id, observed_at, terminal").in("run_id", ids);
  if (missingTable(error)) return {};
  if (error) throw new Error(error.message);
  return Object.fromEntries((data ?? []).map((row) => [row.run_id, { at: row.observed_at, terminal: row.terminal }]));
}

/**
 * The sub-agents a task's run delegated to, kept on its mission_tasks row so
 * the inspector shows them after the stream is gone. Best effort.
 */
export async function saveSubagentRuns(runId: string, steps: LogStep[]) {
  const byId = new Map<string, SubagentRun>();
  for (const step of steps) if (step.subagent) byId.set(step.subagent.delegationId, step.subagent);
  if (byId.size === 0) return;
  const { error } = await getSupabaseAdmin()
    .from("mission_tasks")
    .update({ subagent_runs: [...byId.values()] })
    .eq("run_id", runId);
  // Before 20261031000000_hermes_full_suite.sql the column is missing: skip.
  if (error && error.code !== "42703" && error.code !== "PGRST204") {
    throw new Error(`Could not save sub-agents for ${runId}: ${error.message}`);
  }
}
