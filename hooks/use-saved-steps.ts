"use client";

import { useEffect, useState } from "react";
import type { LogStep } from "@/lib/run-events";

/*
 * Saved steps of finished runs (/api/run-steps). Every run asked for in the
 * same moment goes out in one request, and answers are cached for the page.
 */
const cache = new Map<string, LogStep[]>();
const pending = new Map<string, ((steps: LogStep[]) => void)[]>();
let timer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  timer = null;
  const batch = new Map(pending);
  pending.clear();
  const ids = [...batch.keys()];
  const settle = (found: Record<string, LogStep[]>) => {
    for (const id of ids) {
      const steps = found[id] ?? [];
      cache.set(id, steps);
      for (const done of batch.get(id) ?? []) done(steps);
    }
  };
  fetch(`/api/run-steps?ids=${ids.map(encodeURIComponent).join(",")}`, { cache: "no-store" })
    .then((res) => (res.ok ? res.json() : { steps: {} }))
    .then((data: { steps?: Record<string, LogStep[]> }) => settle(data.steps ?? {}))
    // No saved steps is a normal state; the reply just shows no summary.
    .catch(() => settle({}));
}

function savedSteps(runId: string): Promise<LogStep[]> {
  const hit = cache.get(runId);
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve) => {
    pending.set(runId, [...(pending.get(runId) ?? []), resolve]);
    timer ??= setTimeout(flush, 30);
  });
}

/** The saved steps of one finished run; [] until loaded or when none. */
export function useSavedSteps(runId: string | null | undefined): LogStep[] {
  const [loaded, setLoaded] = useState<{ id: string; steps: LogStep[] } | null>(null);
  useEffect(() => {
    if (!runId) return;
    let live = true;
    void savedSteps(runId).then((steps) => {
      if (live) setLoaded({ id: runId, steps });
    });
    return () => {
      live = false;
    };
  }, [runId]);
  if (!runId) return [];
  return loaded?.id === runId ? loaded.steps : (cache.get(runId) ?? []);
}
