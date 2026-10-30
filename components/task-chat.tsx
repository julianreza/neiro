"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { AgentMarkdown, CopyButton } from "@/components/agent-markdown";
import { ReplyTime } from "@/components/reply-parts";
import { Check, ChevronRight, CircleAlert, Clock3, ListTree, RotateCcw } from "lucide-react";
import { AgentBot, BotRig, agentLook, roleForAgent } from "@/components/agent-bot";
import { ApprovalAsk, AskHand } from "@/components/approval-ask";
import { TaskSteps } from "@/components/task-steps";
import { TaskRouteFlow } from "@/components/task-routing";
import { Button } from "@/components/ui/button";
import { useRole } from "@/hooks/use-role";
import { normalizeApprovals, type PendingApproval } from "@/lib/approvals";
import type { DemoTask, RouteAgentOption, TaskStage } from "@/lib/demo-missions";
import { buildTaskThread, stripVerdict } from "@/lib/task-thread";
import type { ThreadMessage } from "@/lib/task-thread";
import type { MissionArtifact } from "@/lib/types";
import { formatCompactTokens } from "@/lib/utils";

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
  tasks,
  artifacts,
  maxRetries,
  routeAgents,
  stageStyle,
  onInspect,
}: {
  /** Live mission id; without it (demo) no approvals are read. */
  missionId?: string;
  tasks: ChatTask[];
  artifacts: MissionArtifact[];
  maxRetries: number;
  routeAgents: RouteAgentOption[];
  stageStyle: Record<TaskStage, CSSProperties>;
  onInspect: (taskId: string) => void;
}) {
  const fallback =
    tasks.find((t) => WORKING.has(t.stage)) ?? tasks.find((t) => t.stage !== "Done") ?? tasks[0];
  const [picked, setPicked] = useState<string | null>(null);
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
          maxRetries={maxRetries}
          routeAgents={routeAgents}
          stageStyle={stageStyle}
          onInspect={onInspect}
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
        />
      )}
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

async function answerTask(missionId: string, taskId: string, requestId: string, approve: boolean): Promise<string | null> {
  try {
    const res = await fetch(`/api/missions/${encodeURIComponent(missionId)}/tasks/${encodeURIComponent(taskId)}/control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: approve ? "approve_tool" : "deny_tool", requestId }),
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
  maxRetries,
  routeAgents,
  stageStyle,
  onInspect,
  approvals,
  answer,
}: {
  task: ChatTask;
  artifacts: MissionArtifact[];
  maxRetries: number;
  routeAgents: RouteAgentOption[];
  stageStyle: Record<TaskStage, CSSProperties>;
  onInspect: (taskId: string) => void;
  approvals: PendingApproval[];
  answer?: (approval: PendingApproval, approve: boolean) => Promise<string | null>;
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
      ),
    [task, artifacts],
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
            <Message key={m.key} m={m} coder={coder} tries={tries} approvals={approvals} answer={answer} />
          ))}
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
      <div className="chat-foot">
        <CopyButton text={text} label="Copy answer" />
      </div>
    </>
  );
}

function Message({
  m,
  coder,
  tries,
  approvals,
  answer,
}: {
  m: ThreadMessage;
  coder: { name: string; role: string };
  tries: boolean;
  approvals: PendingApproval[];
  answer?: (approval: PendingApproval, approve: boolean) => Promise<string | null>;
}) {
  switch (m.kind) {
    case "brief":
      return (
        <div className="story-ask task-chat-brief">
          <span className="story-meta">{PM.name} · brief</span>
          <div className="story-ask-text">{m.text}</div>
        </div>
      );
    case "coding":
      return (
        <div className="story" style={agentLook(coder.role)}>
          <Who {...coder} />
          <div className="story-col">
            <div className="story-bubble">
              <span className="story-meta">
                {coder.name}
                {tries && ` · ${m.attempt === 0 ? "first try" : `retry ${m.attempt}`}`}
              </span>
              {m.text ? (
                <Body text={m.text} />
              ) : (
                <p className="text-sm text-muted-foreground">This output was not saved. Older runs kept only the latest.</p>
              )}
            </div>
            <ReplyTime at={m.at} />
          </div>
        </div>
      );
    case "qa":
    case "review": {
      const who = m.kind === "qa" ? QA : REVIEW;
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
              <Body text={stripVerdict(m.text) || m.verdict} />
            </div>
            <ReplyTime at={m.at} />
          </div>
        </div>
      );
    }
    case "failed-run":
      return (
        <div className="story" style={agentLook(coder.role)}>
          <Who {...coder} />
          <div className="story-bubble" data-failed="">
            <div className="chat-fail" role="status">
              <p className="chat-fail-head">
                <CircleAlert aria-hidden="true" />
                {m.attempt === 0 ? "First coding run failed" : `Coding retry ${m.attempt} failed`}
              </p>
              <pre className="chat-fail-detail">No output came back.</pre>
              <p className="chat-fail-note">
                <RotateCcw aria-hidden="true" /> It ran again on its own.
              </p>
            </div>
          </div>
        </div>
      );
    case "now":
      return <Now stage={m.stage} depends={m.depends} coder={coder} approvals={approvals} answer={answer} />;
  }
}

function Now({
  stage,
  depends,
  coder,
  approvals,
  answer,
}: {
  stage: TaskStage;
  depends: string[];
  coder: { name: string; role: string };
  approvals: PendingApproval[];
  answer?: (approval: PendingApproval, approve: boolean) => Promise<string | null>;
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
          <span className="story-thinking" role="status" aria-label={`${who.name} is working`}>
            <i />
            <i />
            <i />
          </span>
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
