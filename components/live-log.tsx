"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Copy, Loader2, RotateCw } from "lucide-react";
import { BotRig, agentLook, roleForAgent } from "@/components/agent-bot";
import { Button } from "@/components/ui/button";
import { formatTokens, missionHref, timeAgo } from "@/lib/client-api";
import { useRunSteps } from "@/hooks/use-run-steps";
import type { LogStep } from "@/lib/run-events";
import type { ActiveRunDTO } from "@/app/api/runs/active/route";

const POLL_MS = 10_000;

const KIND_LABEL: Record<LogStep["kind"], string> = {
  tool: "Tool",
  message: "Says",
  approval: "Asks you",
  done: "Done",
  error: "Error",
  info: "Info",
};

type RunStatus = "work" | "wait" | "gone";

const STATUS_LABEL: Record<RunStatus, string> = {
  work: "Working",
  wait: "Waiting for you",
  gone: "Ended",
};

const clock = (at: string | null) => (at ? new Date(at).toLocaleTimeString("en-GB") : "");

/** A drawn robot (not a button), animated by run status. */
function RunBot({ name, status, className }: { name: string; status: RunStatus; className: string }) {
  const role = roleForAgent(name);
  return (
    <span
      className={`agent-bot ${className}`}
      data-state={status === "work" ? "working" : status === "gone" ? "asleep" : undefined}
      style={agentLook(role)}
      aria-hidden="true"
    >
      <BotRig role={role} asleep={status === "gone"} />
    </span>
  );
}

function StatusPill({ status }: { status: RunStatus }) {
  return (
    <span className="log-pill" data-status={status}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function LiveLog() {
  const [runs, setRuns] = useState<ActiveRunDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [gone, setGone] = useState<Set<string>>(new Set());

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

  const markGone = useCallback((runId: string) => {
    setGone((set) => (set.has(runId) ? set : new Set(set).add(runId)));
  }, []);

  const statusOf = (run: ActiveRunDTO): RunStatus =>
    gone.has(run.runId) ? "gone" : run.needsApproval ? "wait" : "work";

  const current = runs?.find((r) => r.runId === selected) ?? runs?.[0] ?? null;

  return (
    <div className="flex w-full flex-col px-4 py-6 md:px-8">
      <h1 className="text-2xl font-semibold">Live log</h1>
      <p className="text-sm text-muted-foreground">What each agent is doing right now, step by step.</p>

      {error && (
        <p role="alert" className="log-panel mt-4 p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {runs === null && !error && (
        <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </p>
      )}
      {runs && runs.length === 0 && (
        <div className="log-panel log-empty mt-6">
          <RunBot name="PM" status="gone" className="log-bot-lg" />
          <p className="mt-3 font-medium">No agent is working right now</p>
          <p className="text-sm text-muted-foreground">Start a mission and its runs appear here.</p>
        </div>
      )}

      {runs && runs.length > 0 && current && (
        <div className="log-grid mt-4">
          <ul className="log-runs" aria-label="Running tasks">
            {runs.map((run) => {
              const status = statusOf(run);
              return (
                <li key={run.runId}>
                  <button
                    type="button"
                    onClick={() => setSelected(run.runId)}
                    aria-current={run.runId === current.runId}
                    className="log-run"
                    data-status={status}
                  >
                    <RunBot name={run.agentName} status={status} className="log-bot-sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{run.taskTitle}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {run.agentName || "Agent"} · {run.stage}
                      </span>
                    </span>
                    {status !== "work" && <span className="log-run-dot" data-status={status} aria-label={STATUS_LABEL[status]} />}
                  </button>
                </li>
              );
            })}
          </ul>
          <RunInspector
            key={current.runId}
            run={current}
            status={statusOf(current)}
            onGone={markGone}
          />
        </div>
      )}
    </div>
  );
}

function RunInspector({
  run,
  status,
  onGone,
}: {
  run: ActiveRunDTO;
  status: RunStatus;
  onGone: (runId: string) => void;
}) {
  const { steps, state, error: streamError, retry } = useRunSteps(run.runId, run.agentId ?? null, onGone);
  const [picked, setPicked] = useState<number | null>(null);
  const bottom = useRef<HTMLLIElement>(null);

  // Follow the newest step until the user picks one.
  useEffect(() => {
    if (picked === null) bottom.current?.scrollIntoView({ block: "nearest" });
  }, [steps.length, picked]);

  const focusIndex = picked ?? steps.length - 1;
  const focus = steps[focusIndex] ?? null;

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Copied");
    } catch {
      toast.error("Clipboard unavailable. Select and copy the text instead.");
    }
  }

  // Allow / Deny live in the mission's task chat; the log only points there.
  const asksYou = (i: number) => steps[i]?.kind === "approval";

  const header = (
    <div className="log-head">
      <RunBot name={run.agentName} status={status} className="log-bot-md" />
      <div className="min-w-0 flex-1">
        <h2 className="truncate font-semibold">{run.taskTitle}</h2>
        <p className="truncate text-xs text-muted-foreground tabular-nums">
          {run.agentName || "Agent"} · {run.stage}
          {run.startedAt && <> · started {timeAgo(run.startedAt)}</>} · {formatTokens(run.tokens)} tokens
        </p>
      </div>
      <span className="flex items-center gap-2">
        {state === "live" && <span className="live-dot" aria-hidden="true" />}
        <StatusPill status={status} />
      </span>
    </div>
  );

  if (status === "gone") {
    return (
      <section className="log-panel log-steps log-wide">
        {header}
        <div className="log-empty flex-1">
          <RunBot name={run.agentName} status="gone" className="log-bot-lg" />
          <p className="mt-3 font-medium">This run has ended</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Hermes no longer has this run, so there is nothing live to show. It used {formatTokens(run.tokens)} tokens.
          </p>
          <Button asChild size="sm" variant="outline" className="mt-4">
            {/* Plain link: /missions/<id> is a redirect, not a page. */}
            <a href={missionHref(run.missionId)}>Open mission</a>
          </Button>
        </div>
      </section>
    );
  }

  return (
    <>
      <section className="log-panel log-steps" aria-live="polite">
        {header}
        {streamError && (
          <div role="alert" className="log-error">
            <span>Couldn&apos;t open this run&apos;s log. {streamError.length > 120 ? "" : streamError}</span>
            <Button
              size="xs"
              variant="outline"
              onClick={retry}
            >
              <RotateCw className="size-3" /> Retry
            </Button>
          </div>
        )}
        <ol className="log-list">
          {steps.length === 0 && state !== "error" && (
            <li className="px-3 py-2 text-sm text-muted-foreground">
              {state === "connecting" ? "Connecting…" : "Waiting for the first step…"}
            </li>
          )}
          {steps.map((step, i) => (
            <li key={i}>
              <button
                type="button"
                className="log-step"
                data-kind={step.kind}
                aria-current={i === focusIndex}
                onClick={() => setPicked(i === steps.length - 1 ? null : i)}
              >
                <span className="log-kind-dot" data-kind={step.kind} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">
                  {step.kind === "approval" ? <b>{step.text}</b> : step.text}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">{clock(step.at)}</span>
              </button>
            </li>
          ))}
          <li ref={bottom} aria-hidden="true" />
        </ol>
        {picked !== null && (
          <button type="button" className="log-follow" onClick={() => setPicked(null)}>
            Follow newest step
          </button>
        )}
      </section>

      <aside className="log-panel log-detail" aria-label="Selected step">
        <p className="text-xs text-muted-foreground">{picked === null ? "Newest step" : "Selected step"}</p>
        {focus ? (
          <>
            <h3 className="mt-1 font-semibold">{focus.text}</h3>
            <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
              <span className="log-kind-dot" data-kind={focus.kind} aria-hidden="true" />
              {KIND_LABEL[focus.kind]}
              {focus.at && <> · {clock(focus.at)}</>}
            </p>
            {focus.detail && (
              <div className="log-term">
                <pre>{focus.detail}</pre>
                <button
                  type="button"
                  className="log-copy"
                  aria-label="Copy"
                  onClick={() => void copy(focus.detail ?? "")}
                >
                  <Copy className="size-3.5" />
                </button>
              </div>
            )}
            {asksYou(focusIndex) && (
              <p className="mt-3 text-sm text-muted-foreground">
                Allow or deny it in the{" "}
                <a className="underline" href={missionHref(run.missionId)}>
                  mission chat
                </a>
                .
              </p>
            )}
          </>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">Click a step to see its command, file or text.</p>
        )}
      </aside>
    </>
  );
}
