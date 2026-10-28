import { getSupabaseAdmin } from "@/lib/supabase";
import { advanceActiveMissions } from "@/lib/orchestrator";

export type TickResult = {
  advancedCount: number;
  errors: string[];
  tickedAt: string;
};

/** Records the cron heartbeat shown on the Gateway page. Returns its time. */
export async function recordTickHeartbeat(): Promise<string> {
  const tickedAt = new Date().toISOString();
  await getSupabaseAdmin().from("app_state").upsert({
    key: "last_cron_tick_at",
    value: { at: tickedAt },
    updated_at: tickedAt,
  });
  return tickedAt;
}

/**
 * One orchestrator tick: record the heartbeat, then advance every active
 * mission. Shared by POST /api/orchestrator/tick (external cron) and the
 * in-process local ticker (lib/local-ticker.ts).
 */
export async function runTick(): Promise<TickResult> {
  const tickedAt = await recordTickHeartbeat();
  const { advancedCount, errors } = await advanceActiveMissions();
  return { advancedCount, errors, tickedAt };
}
