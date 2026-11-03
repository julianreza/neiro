import { getSupabaseAdmin } from "@/lib/supabase";
import { advanceCodeReviews } from "@/lib/code-review-runner";
import { advanceActiveMissions } from "@/lib/orchestrator";
import { advanceAllRooms } from "@/lib/rooms-runtime";
import { deliverBotReplies } from "@/lib/bot-replies";
import { reconcileAsks } from "@/lib/reconcile-asks";

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
  // Manual code reviews; a failure here never stops the missions above.
  try {
    const reviews = await advanceCodeReviews();
    errors.push(...reviews.errors);
  } catch (err: unknown) {
    errors.push(`Code reviews: ${err instanceof Error ? err.message : String(err)}`);
  }
  // Group rooms (Bot Mode): one turn step per running room.
  errors.push(...(await advanceAllRooms()));
  errors.push(...(await reconcileAsks().catch((err: unknown) => [`Chat reconciliation: ${String(err)}`])));
  // /ask answers going back to Telegram.
  errors.push(...(await deliverBotReplies().catch((err: unknown) => [`Bot replies: ${String(err)}`])));
  return { advancedCount, errors, tickedAt };
}
