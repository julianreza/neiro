"use client";

import { useEffect, useRef, useState } from "react";
import { beginRunStream, consumeRunFrame, emptyRunStream } from "@/lib/run-stream";

export type RunStreamState = "idle" | "connecting" | "live" | "ended" | "error";

/**
 * The live steps of one run, read from its SSE stream
 * (/api/hermes/runs/<runId>/events, any runtime). `onGone` fires when the
 * run no longer exists (finished long ago, or the server restarted).
 */
export function useRunSteps(runId: string | null, agentId: string | null, onGone?: (runId: string) => void, onTerminal?: () => void) {
  const [snapshot, setSnapshot] = useState(emptyRunStream);
  const streamRef = useRef({ runId, snapshot: emptyRunStream(), attached: false });
  const onGoneRef = useRef(onGone);
  onGoneRef.current = onGone;
  const onTerminalRef = useRef(onTerminal);
  onTerminalRef.current = onTerminal;
  const [state, setState] = useState<RunStreamState>(runId ? "connecting" : "idle");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [shownFor, setShownFor] = useState(runId);

  // A different run starts from an empty list.
  if (shownFor !== runId) {
    setShownFor(runId);
    setSnapshot(emptyRunStream());
    setError(null);
    setState(runId ? "connecting" : "idle");
  }

  useEffect(() => {
    if (!runId) return;
    const controller = new AbortController();
    if (streamRef.current.runId !== runId) streamRef.current = { runId, snapshot: emptyRunStream(), attached: false };
    const prior = streamRef.current.snapshot;
    if (streamRef.current.attached && (prior.lastSeq !== null || prior.answer || prior.steps.length)) streamRef.current.snapshot = beginRunStream(prior);
    streamRef.current.attached = true;
    const cursor = streamRef.current.snapshot.lastSeq;
    const url = `/api/hermes/runs/${encodeURIComponent(runId)}/events${
      agentId ? `?agentId=${encodeURIComponent(agentId)}` : ""
    }`;

    (async () => {
      try {
        const headers: Record<string, string> = { Accept: "text/event-stream" };
        if (cursor !== null) headers["Last-Event-ID"] = String(cursor);
        const res = await fetch(url, { signal: controller.signal, headers });
        if (!res.ok || !res.body) {
          const data = await res.json().catch(() => ({}));
          const message = typeof data.error === "string" ? data.error : `Stream failed (${res.status})`;
          // The run is gone (finished long ago or cleaned up).
          if (res.status === 404 || /run[_ ]not[_ ]found/i.test(message)) {
            onGoneRef.current?.(runId);
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
        const acceptFrame = (frame: string) => {
          const result = consumeRunFrame(streamRef.current.snapshot, frame);
          streamRef.current.snapshot = result.state;
          setSnapshot(result.state);
          if (result.terminal) onTerminalRef.current?.();
        };
        for (;;) {
          const { value, done } = await reader.read();
          if (controller.signal.aborted || streamRef.current.runId !== runId) return;
          if (done) break;
          buffer += value;
          // SSE frames end with a blank line; keep any partial frame.
          const frames = buffer.split(/\r?\n\r?\n/);
          buffer = frames.pop() ?? "";
          for (const frame of frames) acceptFrame(frame);
        }
        if (buffer.trim()) acceptFrame(buffer);
        setState("ended");
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Stream stopped");
        setState("error");
      }
    })();

    return () => controller.abort();
  }, [runId, agentId, attempt]);

  return {
    steps: snapshot.steps,
    answer: snapshot.answer,
    incomplete: snapshot.incomplete,
    state,
    error,
    retry: () => {
      setError(null);
      const next = beginRunStream(streamRef.current.snapshot);
      streamRef.current.snapshot = next;
      setSnapshot(next);
      setState("connecting");
      setAttempt((n) => n + 1);
    },
  };
}
