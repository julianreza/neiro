"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, ChevronRight, CircleAlert, Clock3, RotateCcw } from "lucide-react";
import { AgentBot, BotRig, agentLook, roleForAgent } from "@/components/agent-bot";
import { TaskRouteFlow } from "@/components/task-routing";
import { Button } from "@/components/ui/button";
import type { DemoTask, RouteAgentOption, TaskStage } from "@/lib/demo-missions";
import { buildTaskThread, stripVerdict } from "@/lib/task-thread";
import type { ThreadMessage } from "@/lib/task-thread";
import type { MissionArtifact } from "@/lib/types";
import { formatCompactTokens } from "@/lib/utils";

export type ChatTask = DemoTask & { rowId?: string; brief?: string | null; resultOutput?: string | null };

const WORKING = new Set<TaskStage>(["Coding", "QA check", "Final review"]);
const PM = { name: "Neiro PM", role: "PM" };
const QA = { name: "QA check", role: "QA" };
const REVIEW = { name: "Final review", role: "Security" };
const FOLD_AT = 700;

/** Board as chat: tasks on the left, the selected task's conversation on the right. */
export function TaskChat({
  tasks,
  artifacts,
  maxRetries,
  routeAgents,
  stageStyle,
  onInspect,
}: {
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
              {t.stage === "Done" ? (
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
        />
      )}
    </div>
  );
}

function TaskThread({
  task,
  artifacts,
  maxRetries,
  routeAgents,
  stageStyle,
  onInspect,
}: {
  task: ChatTask;
  artifacts: MissionArtifact[];
  maxRetries: number;
  routeAgents: RouteAgentOption[];
  stageStyle: Record<TaskStage, CSSProperties>;
  onInspect: (taskId: string) => void;
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

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

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
        <Button variant="ghost" size="sm" onClick={() => onInspect(task.id)} title={task.model}>
          {formatCompactTokens(task.tokens)} tokens
          <span className="sr-only">. Inspect run</span>
          <ChevronRight className="size-3.5" aria-hidden="true" />
        </Button>
      </header>
      <div ref={scroller} className="task-chat-scroll" role="log" aria-label="Task conversation">
        {messages.map((m) => (
          <Message key={m.key} m={m} coder={coder} tries={tries} />
        ))}
      </div>
    </section>
  );
}

function Who({ name, role, working = false }: { name: string; role: string; working?: boolean }) {
  return (
    <span className="story-bot" style={agentLook(role)}>
      <AgentBot name={name} role={role} asleep={false} working={working} />
    </span>
  );
}

function Body({ text }: { text: string }) {
  const long = text.length > FOLD_AT;
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="story-md story-answer text-sm" data-folded={long && !open ? "" : undefined}>
        <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
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
}: {
  m: ThreadMessage;
  coder: { name: string; role: string };
  tries: boolean;
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
        <div className="story">
          <Who {...coder} />
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
        </div>
      );
    case "qa":
    case "review": {
      const who = m.kind === "qa" ? QA : REVIEW;
      return (
        <div className="story">
          <Who {...who} />
          <div className="story-bubble task-chat-gate" data-passed={m.passed}>
            <span className="story-meta flex items-center gap-2">
              {who.name}
              <span className="task-chat-verdict" data-passed={m.passed}>
                {m.verdict.replace("_", " ")}
              </span>
            </span>
            <Body text={stripVerdict(m.text) || m.verdict} />
          </div>
        </div>
      );
    }
    case "failed-run":
      return (
        <p className="task-chat-note">
          <RotateCcw className="size-3.5" aria-hidden="true" />
          {m.attempt === 0 ? "The first coding run" : `Coding retry ${m.attempt}`} failed with no output. It ran again.
        </p>
      );
    case "now":
      return <Now stage={m.stage} depends={m.depends} coder={coder} />;
  }
}

function Now({
  stage,
  depends,
  coder,
}: {
  stage: TaskStage;
  depends: string[];
  coder: { name: string; role: string };
}) {
  if (WORKING.has(stage)) {
    const who = stage === "Coding" ? coder : stage === "QA check" ? QA : REVIEW;
    return (
      <div className="story">
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
