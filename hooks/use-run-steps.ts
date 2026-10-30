"use client";

import { useEffect, useState } from "react";
import { appendStep, parseRunEvent, type LogStep } from "@/lib/run-events";

export type RunStreamState = "idle" | "connecting" | "live" | "ended" | "error";

/**
 * The live steps of one run, read from its SSE stream
 * (/api/hermes/runs/<runId>/events, any runtime). `onGone` fires when the
 * run no longer exists (finished long ago, or the server restarted).
 */
export function useRunSteps(runId: string | null, agentId: string | null, onGone?: (runId: string) => void) {
  const [steps, setSteps] = useState<LogStep[]>([]);
  const [state, setState] = useState<RunStreamState>(runId ? "connecting" : "idle");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [shownFor, setShownFor] = useState(runId);

  // A different run starts from an empty list.
  if (shownFor !== runId) {
    setShownFor(runId);
    setSteps([]);
    setError(null);
    setState(runId ? "connecting" : "idle");
  }

  useEffect(() => {
    if (!runId) return;
    const controller = new AbortController();
    const url = `/api/hermes/runs/${encodeURIComponent(runId)}/events${
      agentId ? `?agentId=${encodeURIComponent(agentId)}` : ""
    }`;

    (async () => {
      try {
        const res = await fetch(url, { signal: controller.signal, headers: { Accept: "text/event-stream" } });
        if (!res.ok || !res.body) {
          const data = await res.json().catch(() => ({}));
          const message = typeof data.error === "string" ? data.error : `Stream failed (${res.status})`;
          // The run is gone (finished long ago or cleaned up).
          if (res.status === 404 || /run[_ ]not[_ ]found/i.test(message)) {
            onGone?.(runId);
            setState("ended");
            return;
          }
          setError(message);
          setState("error");
          return;
        }
        setState("live");
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          // SSE frames end with a blank line; keep any partial frame.
          const frames = buffer.split(/\r?\n\r?\n/);
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            let name: string | undefined;
            const data: string[] = [];
            for (const line of frame.split(/\r?\n/)) {
              if (line.startsWith("event:")) name = line.slice(6).trim();
              else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
            }
            const step = data.length > 0 ? parseRunEvent(data.join("\n"), name) : null;
            if (step) setSteps((list) => appendStep(list, { ...step, at: step.at ?? new Date().toISOString() }));
          }
        }
        setState("ended");
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Stream stopped");
        setState("error");
      }
    })();

    return () => controller.abort();
  }, [runId, agentId, attempt, onGone]);

  return {
    steps,
    state,
    error,
    retry: () => {
      setError(null);
      setState("connecting");
      setAttempt((n) => n + 1);
    },
  };
}
