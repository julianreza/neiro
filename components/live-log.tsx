"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRole } from "@/hooks/use-role";
import { formatTokens, sendJson, timeAgo } from "@/lib/client-api";
import { appendStep, parseRunEvent } from "@/lib/run-events";
import type { LogStep } from "@/lib/run-events";
import type { ActiveRunDTO } from "@/app/api/runs/active/route";

const POLL_MS = 10_000;

const DOT: Record<LogStep["kind"], string> = {
  tool: "bg-emerald-500",
  message: "bg-muted-foreground/50",
  approval: "bg-amber-400",
  done: "bg-primary",
  error: "bg-red-500",
  info: "bg-muted-foreground/30",
};

export function LiveLog() {
  const [runs, setRuns] = useState<ActiveRunDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/runs/active", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : `Couldn't load (${res.status})`);
        return;
      }
      setError(null);
      setRuns(Array.isArray(data.runs) ? data.runs : []);
    } catch {
      setError("Couldn't reach Neiro. Check your connection.");
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  const current = runs?.find((r) => r.runId === selected) ?? runs?.[0] ?? null;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8">
      <h1 className="text-2xl font-semibold">Live log</h1>
      <p className="text-sm text-muted-foreground">What each agent is doing right now, step by step.</p>

      {error && (
        <p role="alert" className="mt-4 rounded-xl border border-destructive/40 p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {runs === null && !error && (
        <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </p>
      )}
      {runs && runs.length === 0 && (
        <div className="mt-6 rounded-2xl border bg-card p-8 text-center text-card-foreground">
          <Radio className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-2 font-medium">No agent is working right now</p>
          <p className="text-sm text-muted-foreground">Start a mission and its runs appear here.</p>
        </div>
      )}

      {runs && runs.length > 0 && current && (
        <div className="mt-4 grid gap-4 md:grid-cols-[260px_1fr]">
          <ul className="space-y-1" aria-label="Running tasks">
            {runs.map((run) => (
              <li key={run.runId}>
                <button
                  type="button"
                  onClick={() => setSelected(run.runId)}
                  aria-current={run.runId === current.runId}
                  className="w-full rounded-xl border bg-card px-3 py-2 text-left text-card-foreground aria-[current=true]:border-primary"
                >
                  <span className="block truncate font-medium">{run.taskTitle}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {run.agentName || "Agent"} · {run.stage}
                    {run.needsApproval && " · waiting for you"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <RunTimeline key={current.runId} run={current} />
        </div>
      )}
    </div>
  );
}

function RunTimeline({ run }: { run: ActiveRunDTO }) {
  const [steps, setSteps] = useState<LogStep[]>([]);
  const [state, setState] = useState<"connecting" | "live" | "ended" | "error">("connecting");
  const [streamError, setStreamError] = useState<string | null>(null);
  const [answered, setAnswered] = useState<Set<number>>(new Set());
  const bottom = useRef<HTMLLIElement>(null);
  const role = useRole();

  useEffect(() => {
    const controller = new AbortController();
    const url = `/api/hermes/runs/${encodeURIComponent(run.runId)}/events${
      run.agentId ? `?agentId=${encodeURIComponent(run.agentId)}` : ""
    }`;

    (async () => {
      try {
        const res = await fetch(url, { signal: controller.signal, headers: { Accept: "text/event-stream" } });
        if (!res.ok || !res.body) {
          const data = await res.json().catch(() => ({}));
          setStreamError(typeof data.error === "string" ? data.error : `Stream failed (${res.status})`);
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
        setStreamError(err instanceof Error ? err.message : "Stream stopped");
        setState("error");
      }
    })();

    return () => controller.abort();
  }, [run.runId, run.agentId]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [steps.length]);

  async function decide(index: number, approve: boolean) {
    const result = await sendJson(
      `/api/missions/${encodeURIComponent(run.missionId)}/tasks/${encodeURIComponent(run.taskId)}/control`,
      "POST",
      { action: approve ? "approve_tool" : "deny_tool" }
    );
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setAnswered((set) => new Set(set).add(index));
    toast.success(approve ? "Allowed" : "Denied");
  }

  return (
    <section className="rounded-2xl border bg-card p-4 text-card-foreground" aria-live="polite">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">
          {run.agentName || "Agent"} · &ldquo;{run.taskTitle}&rdquo;
        </h2>
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          {state === "live" && <span className="live-dot" aria-hidden="true" />}
          {state === "connecting" ? "Connecting…" : state === "live" ? "Live" : state === "ended" ? "Stream ended" : "Not connected"}
          {" · "}
          {formatTokens(run.tokens)} tokens
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {run.missionTitle} · {run.stage}
        {run.startedAt && <> · started {timeAgo(run.startedAt)}</>}
      </p>

      {streamError && <p className="mt-3 text-sm text-destructive">{streamError}</p>}

      <ol className="mt-4 max-h-[60vh] overflow-y-auto border-l-2 pl-0">
        {steps.length === 0 && state !== "error" && (
          <li className="py-1 pl-4 text-sm text-muted-foreground">Waiting for the first step…</li>
        )}
        {steps.map((step, i) => (
          <li key={i} className="relative py-1.5 pl-4 text-sm">
            <span
              aria-hidden="true"
              className={`absolute -left-[6px] top-3 size-2.5 rounded-full ${DOT[step.kind]}`}
            />
            <span className={step.kind === "message" ? "text-muted-foreground" : step.kind === "error" ? "text-destructive" : ""}>
              {step.kind === "approval" ? <b>{step.text}</b> : step.text}
            </span>
            {step.detail && <code className="code-chip ml-2 break-all">{step.detail}</code>}
            {step.at && (
              <span className="ml-2 text-xs text-muted-foreground">
                {new Date(step.at).toLocaleTimeString("en-GB")}
              </span>
            )}
            {step.kind === "approval" && role !== "viewer" && !answered.has(i) && (
              <span className="ml-2 inline-flex gap-1.5 align-middle">
                <Button size="xs" onClick={() => void decide(i, true)}>
                  Allow
                </Button>
                <Button size="xs" variant="outline" onClick={() => void decide(i, false)}>
                  Deny
                </Button>
              </span>
            )}
          </li>
        ))}
        <li ref={bottom} aria-hidden="true" />
      </ol>
    </section>
  );
}
