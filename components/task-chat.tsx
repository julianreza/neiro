"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { AgentMarkdown } from "@/components/agent-markdown";
import { AttemptDiff } from "@/components/attempt-diff";
import { FilesRead, ReplyMeta, StepTrail, took } from "@/components/reply-parts";
import { ThinkingBlock, WorkSummary, reasoningOf } from "@/components/reply-extras";
import { useRunSteps } from "@/hooks/use-run-steps";
import { useSavedSteps } from "@/hooks/use-saved-steps";
import { Check, ChevronRight, CircleAlert, Clock3, ListTree, RotateCcw } from "lucide-react";
import { AgentBot, BotRig, agentLook, roleForAgent } from "@/components/agent-bot";
import { ApprovalAsk, AskHand } from "@/components/approval-ask";
import { TaskSteps } from "@/components/task-steps";
import { TaskRouteFlow } from "@/components/task-routing";
import { Button } from "@/components/ui/button";
import { useRole } from "@/hooks/use-role";
import { normalizeApprovals, type PendingApproval } from "@/lib/approvals";
import type { DemoTask, RouteAgentOption, TaskStage } from "@/lib/demo-missions";
import { splitAnswerFiles } from "@/lib/ask-history";
import { buildTaskThread, stripVerdict } from "@/lib/task-thread";
import type { ThreadMessage } from "@/lib/task-thread";
import type { MissionArtifact, TaskRunUsage } from "@/lib/types";
import { formatCompactTokens } from "@/lib/utils";
import { toast } from "sonner";

export type ChatTask = DemoTask & {
  rowId?: string;
  brief?: string | null;
  resultOutput?: string | null;
  runId?: string | null;
  runAgentId?: string | null;
};

const WORKING = new Set<TaskStage>(["Coding", "QA check", "Final review"]);
const PM = { name: "Neiro PM", role: "PM" };
const QA = { name: "QA check", role: "QA" };
const REVIEW = { name: "Final review", role: "Security" };
const FOLD_AT = 700;
const APPROVAL_POLL_MS = 3000;

/** Board as chat: tasks on the left, the selected task's conversation on the right. */
export function TaskChat({
  missionId,
  initialTaskId,
  tasks,
  artifacts,
  runUsage = [],
  maxRetries,
  routeAgents,
  stageStyle,
  onInspect,
  reviewHrefFor,
}: {
  /** Live mission id; without it (demo) no approvals are read. */
  missionId?: string;
  initialTaskId?: string | null;
  tasks: ChatTask[];
  artifacts: MissionArtifact[];
  /** Each finished run's tokens and model, for the reply footers. */
  runUsage?: TaskRunUsage[];
  maxRetries: number;
  routeAgents: RouteAgentOption[];
  stageStyle: Record<TaskStage, CSSProperties>;
  onInspect: (taskId: string) => void;
  /** Link to the task's code review on /reviews (Build / Fix missions). */
  reviewHrefFor?: (taskRowId: string) => string | null;
}) {
  const fallback =
    tasks.find((t) => WORKING.has(t.stage)) ?? tasks.find((t) => t.stage !== "Done") ?? tasks[0];
  const [picked, setPicked] = useState<string | null>(() => tasks.find((t) => t.rowId === initialTaskId || t.id === initialTaskId)?.id ?? null);
  const task = tasks.find((t) => t.id === picked) ?? fallback;
  const { approvals, reload } = useApprovals(missionId, tasks.some((t) => WORKING.has(t.stage)));
  const waitingFor = (t: ChatTask) => approvals[t.rowId ?? t.id] ?? [];

  return (
    <div className="task-chat">
      <nav className="task-chat-list" aria-label="Tasks">
        {tasks.map((t) => {
          const role = roleForAgent(t.agent);
          return (
            <button
              key={t.id}
              type="button"
              className="task-chat-item"
              aria-current={t.id === task?.id ? "true" : undefined}
              style={{ ...agentLook(role), ...stageStyle[t.stage] }}
              onClick={() => setPicked(t.id)}
            >
              <span className="agent-bot task-chat-bot" data-state={WORKING.has(t.stage) ? "working" : "idle"}>
                <BotRig role={role} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="code-chip">{t.id}</span>
                  <span className="truncate text-sm font-medium">{t.title}</span>
                </span>
                <span className="task-chat-sub">
                  {t.stage}
                  {t.retries > 0 && ` · Retry ${t.retries}/${maxRetries}`}
                </span>
              </span>
              {waitingFor(t).length > 0 ? (
                <span className="ask-needs">Needs you</span>
              ) : t.stage === "Done" ? (
                <Check className="task-chat-dot-icon size-3.5" aria-label="Done" />
              ) : (
                <span className="task-chat-dot" data-live={WORKING.has(t.stage) || undefined} aria-hidden="true" />
              )}
            </button>
          );
        })}
      </nav>
      {task && (
        <TaskThread
          key={task.id}
          task={task}
          artifacts={artifacts}
          runUsage={runUsage}
          maxRetries={maxRetries}
          routeAgents={routeAgents}
          stageStyle={stageStyle}
          onInspect={onInspect}
          reviewHref={reviewHrefFor?.(task.rowId ?? task.id) ?? null}
          approvals={waitingFor(task)}
          answer={
            missionId
              ? async (approval, approve) => {
                  const error = await answerTask(missionId, task.rowId ?? task.id, approval.requestId, approve);
                  reload();
                  return error;
                }
              : undefined
          }
          retry={
            missionId
              ? async () => {
                  const error = await retryTask(missionId, task.rowId ?? task.id);
                  reload();
                  return error;
                }
              : undefined
          }
        />
      )}
    </div>
  );
}

/** Send a task that ran out of retries back to the queue. */
async function retryTask(missionId: string, taskId: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/missions/${encodeURIComponent(missionId)}/tasks/${encodeURIComponent(taskId)}/control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "retry" }),
    });
    if (res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return data.error ?? `Request failed (${res.status})`;
  } catch {
    return "Network error";
  }
}

/** Under the conversation: what you can do next with this task. */
function TaskNext({
  stage,
  onInspect,
  reviewHref,
  retry,
}: {
  stage: TaskStage;
  onInspect: () => void;
  reviewHref: string | null;
  retry?: () => Promise<string | null>;
}) {
  const [busy, setBusy] = useState(false);
  const canRetry = useRole() !== "viewer";
  return (
    <div className="task-next follow" role="group" aria-label="Next steps for this task">
      {stage === "Needs you" && retry && canRetry && (
        <button
          type="button"
          className="follow-chip"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const error = await retry();
            setBusy(false);
            if (error) toast.error(error);
          }}
        >
          {busy ? "Retrying…" : "Retry this task"}
        </button>
      )}
      {reviewHref && (
        <Link href={reviewHref} className="follow-chip">
          Open the code review
        </Link>
      )}
      <button type="button" className="follow-chip" onClick={onInspect}>
        Inspect the run
      </button>
    </div>
  );
}

/** Waiting tool calls per task row id, read every few seconds while any task works. */
function useApprovals(missionId: string | undefined, working: boolean) {
  const [approvals, setApprovals] = useState<Record<string, PendingApproval[]>>({});
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!missionId || !working) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const res = await fetch(`/api/missions/${encodeURIComponent(missionId)}/approvals`, { cache: "no-store" });
        const data = (await res.json().catch(() => null)) as { approvals?: Record<string, unknown> } | null;
        if (!cancelled && res.ok && data?.approvals) {
          setApprovals(
            Object.fromEntries(Object.entries(data.approvals).map(([id, list]) => [id, normalizeApprovals(list)])),
          );
        }
      } catch {
        // A failed read is retried on the next tick.
      }
      if (!cancelled) timer = setTimeout(read, APPROVAL_POLL_MS);
    };
    void read();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [missionId, working, nonce]);

  return { approvals: working ? approvals : {}, reload };
}

async function answerTask(
  missionId: string,
  taskId: string,
  requestId: string,
  approve: boolean | "always",
): Promise<string | null> {
  const action = approve === "always" ? "approve_tool_always" : approve ? "approve_tool" : "deny_tool";
  try {
    const res = await fetch(`/api/missions/${encodeURIComponent(missionId)}/tasks/${encodeURIComponent(taskId)}/control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, requestId }),
    });
    if (res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return data.error ?? `Request failed (${res.status})`;
  } catch {
    return "Network error";
  }
}

function TaskThread({
  task,
  artifacts,
  runUsage,
  maxRetries,
  routeAgents,
  stageStyle,
  onInspect,
  reviewHref,
  approvals,
  answer,
  retry,
}: {
  task: ChatTask;
  artifacts: MissionArtifact[];
  runUsage: TaskRunUsage[];
  maxRetries: number;
  routeAgents: RouteAgentOption[];
  stageStyle: Record<TaskStage, CSSProperties>;
  onInspect: (taskId: string) => void;
  reviewHref: string | null;
  approvals: PendingApproval[];
  answer?: (approval: PendingApproval, approve: boolean | "always") => Promise<string | null>;
  /** Send a task that ran out of retries back to the queue (live missions). */
  retry?: () => Promise<string | null>;
}) {
  const messages = useMemo(
    () =>
      buildTaskThread(
        {
          rowId: task.rowId ?? task.id,
          title: task.title,
          stage: task.stage,
          retries: task.retries,
          depends: task.depends,
          brief: task.brief,
          resultOutput: task.resultOutput,
        },
        artifacts,
        runUsage,
      ),
    [task, artifacts, runUsage],
  );
  const coder = { name: task.agent === "Unassigned" ? "Coding agent" : task.agent, role: roleForAgent(task.agent) };
  const tries = messages.some((m) => m.kind === "coding" && m.attempt > 0);
  const scroller = useRef<HTMLDivElement>(null);
  // Live missions show the agent's steps beside the chat; the toggle hides them.
  const live = Boolean(answer);
  const [showSteps, setShowSteps] = useState(true);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, approvals.length]);

  return (
    <section className="task-chat-thread" aria-label={`${task.id}: ${task.title}`}>
      <header className="task-chat-head">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2">
            <span className="code-chip">{task.id}</span>
            <span className="task-chat-stage" style={stageStyle[task.stage]}>
              {task.stage}
            </span>
            {task.retries > 0 && (
              <span className="text-xs font-semibold text-status-warning">
                Retry {task.retries}/{maxRetries}
              </span>
            )}
            {reviewHref && (
              <Link href={reviewHref} className="text-xs font-semibold text-primary hover:underline">
                Open review
              </Link>
            )}
          </p>
          <h3 className="mt-1 text-base font-semibold">{task.title}</h3>
          {task.depends.length > 0 && (
            <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              Needs
              {task.depends.map((d) => (
                <span key={d} className="code-chip">
                  {d}
                </span>
              ))}
            </p>
          )}
          <TaskRouteFlow task={task} agents={routeAgents} />
        </div>
        {live ? (
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-xs text-muted-foreground tabular-nums" title={task.model}>
              {formatCompactTokens(task.tokens)} tokens
            </span>
            <Button
              variant="outline"
              size="sm"
              aria-pressed={showSteps}
              aria-controls={`steps-${task.id}`}
              data-on={showSteps || undefined}
              className="task-steps-toggle"
              onClick={() => setShowSteps((v) => !v)}
            >
              <ListTree className="size-3.5" aria-hidden="true" />
              See steps
            </Button>
          </div>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => onInspect(task.id)} title={task.model}>
            {formatCompactTokens(task.tokens)} tokens
            <span className="sr-only">. Inspect run</span>
            <ChevronRight className="size-3.5" aria-hidden="true" />
          </Button>
        )}
      </header>
      <div className="task-chat-body" data-steps={live && showSteps ? "" : undefined}>
        <div ref={scroller} className="task-chat-scroll" role="log" aria-label="Task conversation">
          {messages.map((m) => (
            <Message
              key={m.key}
              m={m}
              coder={coder}
              tries={tries}
              approvals={approvals}
              answer={answer}
              runId={task.runId ?? null}
              runAgentId={task.runAgentId ?? null}
              gaveUp={task.stage === "Needs you" && m.kind === "failed-run" && m.attempt === task.retries}
            />
          ))}
          <TaskNext stage={task.stage} onInspect={() => onInspect(task.id)} reviewHref={reviewHref} retry={retry} />
        </div>
        {live && showSteps && (
          <div id={`steps-${task.id}`} className="contents">
            <TaskSteps
              runId={task.runId ?? null}
              agentId={task.runAgentId ?? null}
              agentName={task.stage === "Coding" ? coder.name : task.stage === "QA check" ? QA.name : REVIEW.name}
            />
          </div>
        )}
      </div>
    </section>
  );
}

function Who({ name, role, working = false, asks = false }: { name: string; role: string; working?: boolean; asks?: boolean }) {
  return (
    <span className="story-bot" style={agentLook(role)} data-asks={asks || undefined}>
      <AgentBot name={name} role={role} asleep={false} working={working && !asks} />
      {asks && <AskHand />}
    </span>
  );
}

/** The steps a past run took, saved when its stream ended: "Worked 2m · 14 steps". */
function SavedWork({ m, files }: { m: { runId?: string; startedAt?: string | null; at?: string }; files: number }) {
  const steps = useSavedSteps(m.runId);
  const spent = m.startedAt && m.at ? took(m.startedAt, m.at) : "";
  return (
    <>
      <WorkSummary steps={steps} spent={spent} files={files}>
        <StepTrail steps={steps} live={false} all />
      </WorkSummary>
      <ThinkingBlock text={reasoningOf(steps)} />
    </>
  );
}

/** Footer facts for a saved run: started → saved gives the ⏱ run time. */
function runMeta(m: {
  at?: string;
  startedAt?: string | null;
  model?: string | null;
  tokens?: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadTokens?: number | null;
}) {
  return {
    at: m.startedAt ?? m.at,
    finishedAt: m.startedAt ? m.at : null,
    model: m.model,
    tokens: m.tokens,
    inputTokens: m.inputTokens,
    outputTokens: m.outputTokens,
    cacheReadTokens: m.cacheReadTokens,
  };
}

function Body({ text }: { text: string }) {
  const long = text.length > FOLD_AT;
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="story-md story-answer text-sm" data-folded={long && !open ? "" : undefined}>
        <AgentMarkdown text={text} />
      </div>
      {long && (
        <button type="button" className="story-more" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? "Show less" : "Show all"}
        </button>
      )}
    </>
  );
}

function Message({
  m,
  coder,
  tries,
  approvals,
  answer,
  runId,
  runAgentId,
  gaveUp = false,
}: {
  m: ThreadMessage;
  coder: { name: string; role: string };
  tries: boolean;
  approvals: PendingApproval[];
  answer?: (approval: PendingApproval, approve: boolean | "always") => Promise<string | null>;
  runId: string | null;
  runAgentId: string | null;
  /** The last failure: retries ran out and the task waits for a person. */
  gaveUp?: boolean;
}) {
  switch (m.kind) {
    case "brief":
      return (
        <div className="story-ask task-chat-brief">
          <span className="story-meta">{PM.name} · brief</span>
          <div className="story-ask-text">{m.text}</div>
        </div>
      );
    case "coding": {
      const reply = splitAnswerFiles(m.text ?? "");
      return (
        <div className="story" style={agentLook(coder.role)}>
          <Who {...coder} />
          <div className="story-col">
            <div className="story-bubble">
              <span className="story-meta">
                {coder.name}
                {tries && ` · ${m.attempt === 0 ? "first try" : `retry ${m.attempt}`}`}
              </span>
              <SavedWork m={m} files={reply.files.length} />
              {m.text ? (
                <Body text={reply.body || m.text} />
              ) : (
                <p className="text-sm text-muted-foreground">This output was not saved. Older runs kept only the latest.</p>
              )}
              {m.diff && <AttemptDiff patch={m.diff} />}
            </div>
            <FilesRead files={reply.files} />
            <ReplyMeta {...runMeta(m)} copyText={reply.body || undefined} />
          </div>
        </div>
      );
    }
    case "qa":
    case "review": {
      const who = m.kind === "qa" ? QA : REVIEW;
      const reply = splitAnswerFiles(stripVerdict(m.text));
      return (
        <div className="story" style={agentLook(who.role)}>
          <Who {...who} />
          <div className="story-col">
            <div className="story-bubble task-chat-gate" data-passed={m.passed}>
              <span className="story-meta flex items-center gap-2">
                {who.name}
                <span className="task-chat-verdict" data-passed={m.passed}>
                  {m.verdict.replace("_", " ")}
                </span>
              </span>
              <SavedWork m={m} files={reply.files.length} />
              <Body text={reply.body || m.verdict} />
            </div>
            <FilesRead files={reply.files} />
            <ReplyMeta {...runMeta(m)} copyText={reply.body || undefined} />
          </div>
        </div>
      );
    }
    case "failed-run": {
      const who = m.stage === "QA check" ? QA : m.stage === "Final review" ? REVIEW : coder;
      const what = m.stage === "QA check" ? "QA check" : m.stage === "Final review" ? "Review" : "coding run";
      return (
        <div className="story" style={agentLook(who.role)}>
          <Who {...who} />
          <div className="story-bubble" data-failed="">
            <div className="chat-fail" role="status">
              <p className="chat-fail-head">
                <CircleAlert aria-hidden="true" />
                {m.attempt === 0 ? `First ${what} failed` : `${what[0].toUpperCase()}${what.slice(1)} on retry ${m.attempt} failed`}
              </p>
              {m.reason ? (
                <pre className="fail-reason">{m.reason}</pre>
              ) : (
                <pre className="chat-fail-detail">No output came back.</pre>
              )}
              <p className="chat-fail-note">
                {gaveUp ? (
                  <>
                    <CircleAlert aria-hidden="true" /> Out of retries: it waits for you.
                  </>
                ) : (
                  <>
                    <RotateCcw aria-hidden="true" /> It ran again on its own.
                  </>
                )}
              </p>
            </div>
          </div>
        </div>
      );
    }
    case "now":
      return (
        <Now
          stage={m.stage}
          depends={m.depends}
          coder={coder}
          approvals={approvals}
          answer={answer}
          runId={runId}
          runAgentId={runAgentId}
        />
      );
  }
}

function Now({
  stage,
  depends,
  coder,
  approvals,
  answer,
  runId,
  runAgentId,
}: {
  stage: TaskStage;
  depends: string[];
  coder: { name: string; role: string };
  approvals: PendingApproval[];
  answer?: (approval: PendingApproval, approve: boolean | "always") => Promise<string | null>;
  runId: string | null;
  runAgentId: string | null;
}) {
  const role = useRole();
  if (WORKING.has(stage)) {
    const who = stage === "Coding" ? coder : stage === "QA check" ? QA : REVIEW;
    if (approvals.length > 0) {
      return (
        <div className="story" style={agentLook(who.role)}>
          <Who {...who} working asks />
          <div className="story-bubble" data-asks="">
            <ApprovalAsk
              agentName={who.name}
              approvals={approvals}
              readOnly={!answer || role === "viewer"}
              send={answer ?? (async () => "Not connected")}
              sendAlways={answer ? (approval) => answer(approval, "always") : undefined}
            />
          </div>
        </div>
      );
    }
    return (
      <div className="story" style={agentLook(who.role)}>
        <Who {...who} working />
        <div className="story-bubble task-chat-typing">
          <span className="story-meta">{who.name}</span>
          <LiveTrail runId={runId} agentId={runAgentId} />
        </div>
      </div>
    );
  }
  const text: Record<string, string> = {
    Queued: depends.length > 0 ? `Waiting for ${depends.join(", ")} to finish.` : "In the queue. Starts when a worker is free.",
    "Awaiting routing": "Waiting for your routing decision above.",
    Routed: "Routed to an agent. Starts soon.",
    "Needs you": "Needs you: out of retries or over budget. Open the run to decide.",
  };
  const Icon = stage === "Needs you" ? CircleAlert : Clock3;
  return (
    <p className="task-chat-note" data-tone={stage === "Needs you" ? "warn" : undefined}>
      <Icon className="size-3.5" aria-hidden="true" />
      {text[stage] ?? stage}
    </p>
  );
}

/** The working agent's steps under its name, Kiro Crew style. */
function LiveTrail({ runId, agentId }: { runId: string | null; agentId: string | null }) {
  const { steps } = useRunSteps(runId, agentId);
  return <StepTrail steps={steps} live />;
}
