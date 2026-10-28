import { runTick } from "@/lib/tick";

const DEFAULT_INTERVAL_MS = 15_000;
const MIN_INTERVAL_MS = 5_000;

type TickerState = {
  timer: ReturnType<typeof setInterval> | null;
  running: boolean;
  lastWarning: string | null;
};

// HMR re-evaluates modules in dev; keep one ticker per server process.
const globalForTicker = globalThis as typeof globalThis & { __neiroTicker?: TickerState };

/**
 * Whether the in-process ticker should run. NEIRO_LOCAL_TICK="on"/"off"
 * wins; unset means on for `next dev` and off for `next start`, where an
 * external cron calls POST /api/orchestrator/tick instead.
 */
export function localTickEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const flag = env.NEIRO_LOCAL_TICK?.trim().toLowerCase();
  if (flag === "on" || flag === "true" || flag === "1") return true;
  if (flag === "off" || flag === "false" || flag === "0") return false;
  return env.NODE_ENV === "development";
}

export function localTickIntervalMs(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env.NEIRO_LOCAL_TICK_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_INTERVAL_MS;
  return Math.max(MIN_INTERVAL_MS, Math.floor(raw));
}

export function startLocalTicker(): void {
  if (!localTickEnabled()) return;
  if (globalForTicker.__neiroTicker?.timer) return;

  const state: TickerState = { timer: null, running: false, lastWarning: null };
  // Same problem every 15s (e.g. Supabase not configured) is logged once.
  const warn = (message: string) => {
    if (message === state.lastWarning) return;
    state.lastWarning = message;
    console.warn(`[neiro] local tick: ${message}`);
  };
  const intervalMs = localTickIntervalMs();

  const tick = async () => {
    // Skip a beat instead of stacking ticks when one runs long.
    if (state.running) return;
    state.running = true;
    try {
      const { advancedCount, errors } = await runTick();
      if (errors.length > 0) warn(`${advancedCount} advanced, errors: ${errors.join(" | ")}`);
      else state.lastWarning = null;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      warn(`failed: ${message}`);
    } finally {
      state.running = false;
    }
  };

  state.timer = setInterval(tick, intervalMs);
  globalForTicker.__neiroTicker = state;
  console.log(`[neiro] local ticker on: every ${intervalMs / 1000}s (NEIRO_LOCAL_TICK=off to disable)`);
}
