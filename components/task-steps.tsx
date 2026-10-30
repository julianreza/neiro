"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useRunSteps } from "@/hooks/use-run-steps";
import type { LogStep } from "@/lib/run-events";

const KIND: Record<LogStep["kind"], string> = {
  tool: "Tool",
  message: "Says",
  approval: "Asks you",
  done: "Done",
  error: "Error",
  info: "Note",
};

/**
 * The running agent's steps, live, beside the task chat: every tool call,
 * command, file and message as it happens. Click a step to see all of it.
 */
export function TaskSteps({ runId, agentId, agentName }: { runId: string | null; agentId: string | null; agentName: string }) {
  const { steps, state, error, retry } = useRunSteps(runId, agentId);
  const [open, setOpen] = useState<number | null>(null);
  const end = useRef<HTMLLIElement>(null);

  // Follow the newest step while nothing is opened.
  useEffect(() => {
    if (open === null) end.current?.scrollIntoView({ block: "nearest" });
  }, [steps.length, open]);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied");
    } catch {
      toast.error("Clipboard unavailable. Select and copy the text instead.");
    }
  }

  return (
    <aside className="task-steps" aria-label="Steps">
      <p className="task-steps-head">
        <span className="font-semibold">Steps</span>
        <span className="truncate text-muted-foreground">{runId ? agentName : ""}</span>
        {state === "live" && (
          <span className="task-steps-live">
            <span className="live-dot" aria-hidden="true" /> live
          </span>
        )}
      </p>
      {!runId ? (
        <p className="task-steps-empty">No run right now. Steps show here while an agent works on this task.</p>
      ) : error ? (
        <div className="task-steps-empty" role="alert">
          <p>Couldn&apos;t open the steps. {error.length > 120 ? "" : error}</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={retry}>
            <RotateCw className="size-3.5" aria-hidden="true" /> Try again
          </Button>
        </div>
      ) : steps.length === 0 ? (
        <p className="task-steps-empty">
          {state === "connecting" ? "Connecting…" : state === "ended" ? "This run has ended." : "Waiting for the first step…"}
        </p>
      ) : (
        <ol className="task-steps-list" role="log" aria-live="polite">
          {steps.map((step, i) => {
            const shown = open === i;
            const full = [step.text, step.detail].filter(Boolean).join("\n");
            return (
              <li key={i} ref={i === steps.length - 1 ? end : undefined}>
                <button
                  type="button"
                  className="task-step"
                  data-kind={step.kind}
                  aria-expanded={shown}
                  onClick={() => setOpen(shown ? null : i)}
                >
                  <span className="log-kind-dot" data-kind={step.kind} aria-hidden="true" />
                  <span className="task-step-kind">{KIND[step.kind]}</span>
                  <span className="task-step-text" data-open={shown || undefined}>
                    {step.text}
                    {step.detail && <code className="task-step-detail">{step.detail}</code>}
                  </span>
                </button>
                {shown && full && (
                  <button type="button" className="task-step-copy" onClick={() => void copy(full)}>
                    <Copy className="size-3" aria-hidden="true" /> Copy
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </aside>
  );
}
