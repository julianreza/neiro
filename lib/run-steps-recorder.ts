import "server-only";
import { openRunEventStream } from "@/lib/agent-runtime";
import { createStepCollector, RUN_ID } from "@/lib/run-steps";
import { recordRunActivity, saveRunSteps } from "@/lib/run-steps-store";
import type { Agent } from "@/lib/types";

/*
 * Mission runs started by a tick (browser, VPS cron or API) often have no
 * one watching them, so the events proxy never sees their steps. This
 * listens to the run's stream on the server and saves the steps itself.
 *
 * One listener per run in this process; ticks that overlap or repeat just
 * find it already running. A restart drops the listeners, and the next tick
 * that sees the run still going attaches a new one. Saved every 30s while it
 * runs, so a restart loses at most the last half minute.
 */
const listening = new Set<string>();

const MAX_LISTEN_MS = 6 * 60 * 60 * 1000;
const CHECKPOINT_MS = 30_000;

export function watchRunSteps(agent: Agent, runId: string): void {
  if (!RUN_ID.test(runId) || runId.startsWith("claim:") || listening.has(runId)) return;
  listening.add(runId);
  void listen(agent, runId).finally(() => listening.delete(runId));
}

async function listen(agent: Agent, runId: string): Promise<void> {
  const controller = new AbortController();
  const stop = setTimeout(() => controller.abort(), MAX_LISTEN_MS);
  let lastWrite = 0;
  const collector = createStepCollector((event) => {
    const now = Date.now();
    if (!event.terminal && now - lastWrite < 15_000) return;
    lastWrite = now;
    void recordRunActivity(runId, event).catch((error: unknown) => console.warn("[run-activity]", error));
  });
  let savedCount = 0;
  const save = async () => {
    const steps = collector.steps();
    if (steps.length === savedCount) return;
    savedCount = steps.length;
    await saveRunSteps(runId, steps);
  };
  const checkpoint = setInterval(() => {
    save().catch((err: unknown) => console.warn("[run-steps] checkpoint failed", runId, err));
  }, CHECKPOINT_MS);
  try {
    const stream = await openRunEventStream(agent, runId, controller.signal);
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      collector.feed(decoder.decode(value, { stream: true }));
    }
    collector.feed(decoder.decode());
    collector.end();
    await save();
  } catch (err: unknown) {
    // A run that is gone, or a stream that broke: keep what was read.
    if (!controller.signal.aborted) console.warn("[run-steps] stream ended early", runId, err);
    collector.end();
    await save().catch(() => undefined);
  } finally {
    clearInterval(checkpoint);
    clearTimeout(stop);
  }
}
