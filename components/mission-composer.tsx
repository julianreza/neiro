"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ChevronDown,
  FolderOpen,
  MessageCircleQuestionMark,
  Play,
  Sparkles,
  Square,
  Timer,
  Wrench,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FolderPicker, rememberFolder } from "@/components/folder-picker";
import { BotRig, agentLook } from "@/components/agent-bot";
import { askContextBrief, splitAnswerFiles, type AskTurn } from "@/lib/ask-history";

export type ComposerMode = "ask" | "build" | "fix" | "plan";

type ModeInfo = {
  id: ComposerMode;
  name: string;
  detail: string;
  icon: LucideIcon;
  action: string;
  placeholder: string;
  steps: [string, string][];
  estimate: string;
};

export const COMPOSER_MODES: ModeInfo[] = [
  {
    id: "ask",
    name: "Ask a question",
    detail: "Get an answer about your project. No tasks, no mission.",
    icon: MessageCircleQuestionMark,
    action: "Ask",
    placeholder: "Ask anything, for example: what is this project?",
    steps: [
      ["Read", "Neiro opens the files it needs"],
      ["Answer", "The reply appears below"],
    ],
    estimate: "Usually 1 to 3 minutes. Neiro is told not to change any file.",
  },
  {
    id: "build",
    name: "Build something new",
    detail: "A full plan: requirements, design, and a task list.",
    icon: Sparkles,
    action: "Launch mission",
    placeholder: "Describe what to build, for example: a pricing page for our app",
    steps: [
      ["Plan", "The PM splits the goal into tasks"],
      ["Spec", "Requirements and acceptance criteria"],
      ["Build", "Workers do the tasks"],
      ["QA and review", "Every task is checked"],
    ],
    estimate: "Usually 20 to 60 minutes, depending on the number of tasks.",
  },
  {
    id: "fix",
    name: "Fix a bug",
    detail: "Investigate the problem, find the root cause, and fix it.",
    icon: Wrench,
    action: "Start fix",
    placeholder: "Describe the bug and how to see it",
    steps: [
      ["Investigate", "Reproduce the problem"],
      ["Root cause", "Find why it happens"],
      ["Fix", "A worker changes the code"],
      ["QA and review", "Check the bug is gone"],
    ],
    estimate: "Usually 15 to 40 minutes.",
  },
  {
    id: "plan",
    name: "Quick plan",
    detail: "Just a goal, a short spec and a task list. You approve before work starts.",
    icon: Zap,
    action: "Make plan",
    placeholder: "What is the goal?",
    steps: [
      ["Plan", "The PM writes the task list"],
      ["Spec", "A short spec for the tasks"],
      ["You decide", "Approve the plan to start the work"],
    ],
    estimate: "Usually 5 to 10 minutes, then it waits for you.",
  },
];

const WORKSPACE_KEY = "neiro.workspace";
const DONE = new Set(["completed", "failed", "cancelled", "canceled", "expired_404"]);

type AskState =
  | { phase: "idle" }
  | {
      phase: "running" | "done" | "failed";
      question: string;
      runId: string;
      agentId: string;
      agentName: string;
      startedAt: number;
      finishedAt?: number;
      output: string;
      error?: string;
    };

function rememberWorkspace(path: string) {
  rememberFolder(path);
  try {
    if (path.trim()) localStorage.setItem(WORKSPACE_KEY, path.trim());
  } catch {
    // Storage blocked: nothing to remember.
  }
}

function duration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

export function MissionComposer({
  prompt,
  onPromptChange,
  workspace,
  onWorkspaceChange,
  inputRef,
  isLive,
  launching,
  onLaunch,
  advanced,
  folderLocked = false,
  compact = false,
}: {
  prompt: string;
  onPromptChange: (value: string) => void;
  workspace: string;
  onWorkspaceChange: (value: string) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  isLive: boolean;
  launching: boolean;
  /** `context` is the Ask thread the mission came from, if any. */
  onLaunch: (mode: Exclude<ComposerMode, "ask">, context?: string) => void;
  /** Mission-only options, shown behind "Advanced options". */
  advanced: ReactNode;
  /** The folder is the project's: show it, but don't let it change. */
  folderLocked?: boolean;
  /** One row of mode pills and no "What happens next" side panel. */
  compact?: boolean;
}) {
  const [mode, setMode] = useState<ComposerMode>("ask");
  const [ask, setAsk] = useState<AskState>({ phase: "idle" });
  // Earlier turns of this Ask thread; the current one lives in `ask`.
  const [thread, setThread] = useState<AskTurn[]>([]);
  // Ask thread a mission was turned from; sent with the mission prompt.
  const [carried, setCarried] = useState("");
  const wasLaunching = useRef(false);
  const [startingAsk, setStartingAsk] = useState(false);
  const [now, setNow] = useState(0);
  const askRequest = useRef(false);
  const info = COMPOSER_MODES.find((m) => m.id === mode)!;
  const asking = ask.phase === "running";
  const busy = mode === "ask" ? asking || startingAsk : launching;
  const runId = asking ? ask.runId : null;
  const agentId = asking ? ask.agentId : null;

  // Fill the project folder: last one used, else the folder Neiro runs from.
  useEffect(() => {
    if (workspace || folderLocked) return;
    let cancelled = false;
    fetch("/api/ask")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { workspace?: string } | null) => {
        if (cancelled) return;
        let saved = "";
        try {
          saved = localStorage.getItem(WORKSPACE_KEY) ?? "";
        } catch {
          saved = "";
        }
        const path = saved || data?.workspace || "";
        if (path) onWorkspaceChange(path);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // Only on first mount: later edits belong to the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The parent empties the prompt once a mission is created: the context is used up.
  useEffect(() => {
    if (wasLaunching.current && !launching && !prompt.trim()) setCarried("");
    wasLaunching.current = launching;
  }, [launching, prompt]);

  // Elapsed time while a question runs.
  useEffect(() => {
    if (!asking) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [asking]);

  // Activity reconnects this effect when the preserved route becomes visible.
  useEffect(() => {
    if (!runId || !agentId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      try {
        const res = await fetch(`/api/ask/${encodeURIComponent(runId)}?agentId=${encodeURIComponent(agentId)}`);
        const data = (await res.json().catch(() => ({}))) as {
          status?: string;
          output?: string;
          error?: string | null;
        };
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
        const status = data.status ?? "running";
        if (DONE.has(status)) {
          const ok = status === "completed";
          setAsk((state) =>
            state.phase !== "running" || state.runId !== runId
              ? state
              : {
                  ...state,
                  phase: ok ? "done" : "failed",
                  output: data.output ?? "",
                  error: ok ? undefined : (data.error ?? `The question ended: ${status}`),
                  finishedAt: Date.now(),
                },
          );
          return;
        }
        setAsk((state) =>
          state.phase !== "running" || state.runId !== runId ? state : { ...state, output: data.output ?? "" },
        );
      } catch (err: unknown) {
        // A failed poll is retried; the run itself may still be fine.
        console.warn("[ask] poll failed", err);
      }
      if (!cancelled) timer = setTimeout(check, 3000);
    };
    timer = setTimeout(check, 2000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [runId, agentId]);

  async function startAsk(question: string, followUp: boolean) {
    if (askRequest.current || asking) return;
    if (!question.trim()) {
      inputRef.current?.focus();
      toast.error("Write a question first");
      return;
    }
    if (!isLive) {
      toast.error("Connect Supabase and Hermes on the Gateway page to ask.");
      return;
    }
    askRequest.current = true;
    setStartingAsk(true);
    const startedAt = Date.now();
    setNow(startedAt);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: question.trim(),
          workspace_path: workspace.trim(),
          session_id: followUp && ask.phase !== "idle" ? ask.runId : undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        runId?: string;
        agentId?: string;
        agentName?: string;
        error?: string;
      };
      if (!res.ok || !data.runId || !data.agentId) {
        toast.error(data.error ?? `Could not ask (${res.status})`);
        return;
      }
      rememberWorkspace(workspace);
      setThread((turns) =>
        followUp && ask.phase === "done" ? [...turns, { question: ask.question, answer: ask.output }] : [],
      );
      setAsk({
        phase: "running",
        question: question.trim(),
        runId: data.runId,
        agentId: data.agentId,
        agentName: data.agentName ?? "Neiro",
        startedAt,
        output: "",
      });
      onPromptChange("");
    } catch {
      toast.error("Network error");
    } finally {
      askRequest.current = false;
      setStartingAsk(false);
    }
  }

  async function stopAsk() {
    if (ask.phase !== "running") return;
    try {
      const res = await fetch(`/api/ask/${encodeURIComponent(ask.runId)}?agentId=${encodeURIComponent(ask.agentId)}`, {
        method: "DELETE",
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? `Could not stop the question (${res.status})`);
      setAsk((state) =>
        state.phase === "running" && state.runId === ask.runId
          ? { ...state, phase: "failed", error: "Stopped.", finishedAt: Date.now() }
          : state,
      );
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Could not stop the question");
    }
  }

  function submit() {
    if (busy || blocked) return;
    if (mode === "ask") {
      startAsk(prompt, ask.phase === "done");
      return;
    }
    rememberWorkspace(workspace);
    onLaunch(mode, carried || undefined);
  }

  const blocked = !isLive
    ? "Connect Supabase on the Gateway page first"
    : !prompt.trim()
      ? mode === "ask"
        ? "Write a question"
        : "Write an objective"
      : !workspace.trim() && mode === "ask"
        ? "Pick the project folder"
        : null;

  const answer = ask.phase === "idle" ? null : splitAnswerFiles(ask.output);

  return (
    <section className="composer" data-compact={compact || undefined} aria-labelledby="composer-title">
      <div className="composer-grid">
        <form
          className="min-w-0 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <h2 id="composer-title" className="text-lg font-semibold tracking-tight">
            What kind of work is it?
          </h2>
          <div className="composer-modes" role="radiogroup" aria-label="Kind of work">
            {COMPOSER_MODES.map((item) => {
              const Icon = item.icon;
              const selected = item.id === mode;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className="composer-mode"
                  onClick={() => setMode(item.id)}
                >
                  <span className="flex items-center gap-2 font-semibold">
                    <Icon className="size-4 shrink-0" aria-hidden="true" />
                    {item.name}
                    {item.id === "ask" && <span className="composer-new">New</span>}
                  </span>
                  <span className="composer-mode-detail mt-1 block text-xs text-muted-foreground">{item.detail}</span>
                </button>
              );
            })}
          </div>
          {compact && <p className="composer-hint">{info.detail}</p>}

          <div className="composer-input">
            <Label htmlFor="mission-prompt" className="sr-only">
              {mode === "ask" ? "Your question" : "Mission objective"}
            </Label>
            <Textarea
              ref={inputRef}
              id="mission-prompt"
              value={prompt}
              onChange={(event) => onPromptChange(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  submit();
                }
              }}
              placeholder={info.placeholder}
              className="resize-y text-base md:text-sm"
              maxLength={20000}
            />
            {mode !== "ask" && carried && (
              <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="folder-chip">
                  <MessageCircleQuestionMark className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="font-semibold">Q&amp;A attached</span>
                  <button
                    type="button"
                    className="-mr-1 rounded-sm p-0.5 hover:text-foreground"
                    aria-label="Remove the attached question and answer"
                    onClick={() => setCarried("")}
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                </span>
                The mission reads your question and answer above.
              </p>
            )}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
              {folderLocked ? (
                <span className="folder-chip" title={workspace}>
                  <FolderOpen className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="font-semibold">{workspace.replace(/\/+$/, "").split("/").pop() || workspace}</span>
                  <span className="folder-chip-path">project folder</span>
                </span>
              ) : (
                <FolderPicker value={workspace} onChange={onWorkspaceChange} />
              )}
              <div className="flex flex-wrap items-center gap-3">
                <span id="launch-disabled-reason" className="text-xs text-muted-foreground">
                  {blocked ?? "⌘ / Ctrl + Enter"}
                </span>
                <Button
                  type="submit"
                  className="console-launch"
                  disabled={!!blocked || busy}
                  aria-describedby="launch-disabled-reason"
                >
                  <Play className="size-3.5" />
                  {busy ? (mode === "ask" ? "Answering…" : "Launching…") : info.action}
                </Button>
              </div>
            </div>
          </div>

          {mode !== "ask" && (
            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button type="button" variant="ghost" size="sm" className="text-muted-foreground">
                  <ChevronDown className="size-3.5" />
                  Advanced options
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="composer-advanced">{advanced}</CollapsibleContent>
            </Collapsible>
          )}
        </form>

        <aside className="composer-next" aria-label="What happens next">
          <h2 className="text-lg font-semibold tracking-tight">What happens next</h2>
          <ol className="composer-steps" key={mode}>
            {info.steps.map(([title, text], i) => (
              <li key={title} style={{ "--i": i } as React.CSSProperties}>
                <span className="composer-dot" aria-hidden="true" />
                <div>
                  <p className="text-sm font-medium">{title}</p>
                  <p className="text-xs text-muted-foreground">{text}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="composer-estimate">
            <Timer className="size-4 shrink-0" aria-hidden="true" />
            {info.estimate}
          </p>
        </aside>
      </div>

      {ask.phase !== "idle" && answer && (
        <article className="composer-answer" data-phase={ask.phase} aria-live="polite" aria-busy={asking}>
          <p className="answer-you">
            <span className="sr-only">You asked: </span>
            {ask.question}
          </p>
          <div className="answer-row">
            <span className="answer-avatar" aria-hidden="true">
              <span
                className="agent-bot answer-bot"
                data-state={ask.phase === "running" ? "working" : undefined}
                data-hop={ask.phase === "done" ? "" : undefined}
                style={agentLook("PM")}
              >
                <BotRig role="PM" />
              </span>
            </span>
            <div className="answer-bubble">
              <p className="answer-meta tabular-nums">
                <b>{ask.agentName}</b>
                <span>
                  {ask.phase === "running"
                    ? `is reading the project · ${duration(now - ask.startedAt)}`
                    : ask.phase === "done"
                      ? `answered in ${duration((ask.finishedAt ?? now) - ask.startedAt)}`
                      : ask.error}
                </span>
              </p>
              {answer.body ? (
                <div className="composer-markdown">
                  <Markdown remarkPlugins={[remarkGfm]}>{answer.body}</Markdown>
                </div>
              ) : (
                ask.phase === "running" && (
                  <p className="composer-thinking">
                    <i />
                    <i />
                    <i />
                    <span className="sr-only">Waiting for the answer</span>
                  </p>
                )
              )}
              {answer.files.length > 0 && (
                <ul className="flex flex-wrap gap-1.5" aria-label="Files read">
                  {answer.files.map((file) => (
                    <li key={file}>
                      <code className="code-chip">{file}</code>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap gap-2">
                {ask.phase === "running" ? (
                  <Button variant="outline" className="min-h-10" onClick={stopAsk}>
                    <Square className="size-3.5" />
                    Stop
                  </Button>
                ) : (
                  <>
                    {ask.phase === "done" && (
                      <Button
                        variant="outline"
                        className="min-h-10"
                        onClick={() => {
                          setMode("ask");
                          inputRef.current?.focus();
                        }}
                      >
                        Ask a follow-up
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      className="min-h-10"
                      onClick={() => {
                        setMode("build");
                        setCarried(
                          askContextBrief([...thread, { question: ask.question, answer: ask.output }]),
                        );
                        onPromptChange(ask.question);
                        inputRef.current?.focus();
                      }}
                    >
                      Turn into a mission
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        </article>
      )}
    </section>
  );
}
