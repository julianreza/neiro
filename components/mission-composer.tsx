"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  ChevronDown,
  FolderOpen,
  MessageCircleQuestionMark,
  Play,
  RotateCcw,
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
import { AgentMarkdown } from "@/components/agent-markdown";
import { FilesRead, ReplyMeta, StepTrail } from "@/components/reply-parts";
import { ThinkingBlock, WorkSummary, reasoningOf } from "@/components/reply-extras";
import { useRunSteps } from "@/hooks/use-run-steps";
import { useSavedSteps } from "@/hooks/use-saved-steps";
import { ApprovalAsk, AskHand } from "@/components/approval-ask";
import { useRole } from "@/hooks/use-role";
import { normalizeApprovals, type PendingApproval } from "@/lib/approvals";
import { askContextBrief, splitAnswerFiles, type AskTurn } from "@/lib/ask-history";
import { AttachImages, useImageDrop } from "@/components/attach-images";
import type { ImageAttachment } from "@/lib/types";

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
      model?: string | null;
      tokens?: number;
      inputTokens?: number | null;
      outputTokens?: number | null;
      cacheReadTokens?: number | null;
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
  images,
  onImagesChange,
  folderLocked = false,
  compact = false,
  onAskChange,
  answerElsewhere = false,
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
  /** Screenshots sent with the next question or mission. Omit to hide the attach button. */
  images?: ImageAttachment[];
  onImagesChange?: (next: ImageAttachment[]) => void;
  /** The folder is the project's: show it, but don't let it change. */
  folderLocked?: boolean;
  /** One row of mode pills and no "What happens next" side panel. */
  compact?: boolean;
  /** Called when a question starts (with its run id) or ends, so a parent list can refresh. */
  onAskChange?: (runId?: string) => void;
  /** The parent shows answers: start the question, hand over its id, show no answer card. */
  answerElsewhere?: boolean;
}) {
  // Kept in a ref so a new callback does not restart the answer poll.
  const askChanged = useRef(onAskChange);
  useEffect(() => {
    askChanged.current = onAskChange;
  }, [onAskChange]);
  const [mode, setMode] = useState<ComposerMode>("ask");
  const [triage, setTriage] = useState<{ prompt: string; suggestedMode: string; complexity: number; recommendedWorkers: number; ambiguous: boolean } | null>(null);
  useEffect(() => {
    const text = prompt.trim();
    if (mode === "ask" || text.length < 20 || text.length > 8000) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch("/api/missions/preflight", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "triage", prompt: text }), signal: controller.signal })
        .then((response) => response.ok ? response.json() : null)
        .then((body) => { if (!controller.signal.aborted && body?.suggestion) setTriage({ prompt: text, ...body.suggestion }); })
        .catch(() => undefined);
    }, 1000);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [prompt, mode]);
  const [ask, setAsk] = useState<AskState>({ phase: "idle" });
  // Tool calls the answering agent waits on; shown as Allow / Deny in its bubble.
  const [askApprovals, setAskApprovals] = useState<{ runId: string; list: PendingApproval[] } | null>(null);
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
  // One stream per question; kept after it finishes for the work summary.
  const { steps: liveAskSteps } = useRunSteps(ask.phase === "idle" ? null : ask.runId, ask.phase === "idle" ? null : ask.agentId);
  const savedAskSteps = useSavedSteps(ask.phase === "done" && liveAskSteps.length === 0 ? ask.runId : null);
  const askSteps = liveAskSteps.length > 0 ? liveAskSteps : savedAskSteps;
  const busy = mode === "ask" ? asking || startingAsk : launching;
  const imageDrop = useImageDrop(images ?? [], onImagesChange ?? (() => undefined));
  const runId = asking ? ask.runId : null;
  const agentId = asking ? ask.agentId : null;
  const role = useRole();
  const waiting = runId && askApprovals?.runId === runId ? askApprovals.list : [];

  async function answerAsk(approval: PendingApproval, approve: boolean): Promise<string | null> {
    if (!runId || !agentId) return "The question has ended.";
    try {
      const res = await fetch(`/api/ask/${encodeURIComponent(runId)}?agentId=${encodeURIComponent(agentId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approve, requestId: approval.requestId }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        return data.error ?? `Request failed (${res.status})`;
      }
      // Hide it now; the next poll shows any request that follows.
      setAskApprovals((cur) => (cur ? { ...cur, list: cur.list.filter((a) => a !== approval) } : cur));
      return null;
    } catch {
      return "Network error";
    }
  }

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
          approvals?: unknown;
          model?: string | null;
          tokens?: number;
          inputTokens?: number | null;
          outputTokens?: number | null;
          cacheReadTokens?: number | null;
        };
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
        const status = data.status ?? "running";
        setAskApprovals(DONE.has(status) ? null : { runId, list: normalizeApprovals(data.approvals) });
        if (DONE.has(status)) {
          const ok = status === "completed";
          askChanged.current?.();
          setAsk((state) =>
            state.phase !== "running" || state.runId !== runId
              ? state
              : {
                  ...state,
                  phase: ok ? "done" : "failed",
                  output: data.output ?? "",
                  error: ok ? undefined : (data.error ?? `The question ended: ${status}`),
                  finishedAt: Date.now(),
                  model: data.model ?? null,
                  tokens: data.tokens ?? 0,
                  inputTokens: data.inputTokens ?? null,
                  outputTokens: data.outputTokens ?? null,
                  cacheReadTokens: data.cacheReadTokens ?? null,
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

  /** Start a question; `retry` asks a failed question again and keeps the earlier turns. */
  async function startAsk(question: string, followUp: boolean, retry = false) {
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
          images: images?.length ? images : undefined,
          session_id: followUp && !retry && ask.phase !== "idle" ? ask.runId : undefined,
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
      if (images?.length) onImagesChange?.([]);
      rememberWorkspace(workspace);
      if (answerElsewhere) {
        // The parent shows the answer (Projects page chat panel); the composer stays free.
        onPromptChange("");
        askChanged.current?.(data.runId);
        return;
      }
      setThread((turns) =>
        retry
          ? turns
          : followUp && ask.phase === "done"
            ? [
                ...turns,
                {
                  question: ask.question,
                  answer: ask.output,
                  runId: ask.runId,
                  model: ask.model,
                  tokens: ask.tokens,
                  inputTokens: ask.inputTokens,
                  outputTokens: ask.outputTokens,
                  cacheReadTokens: ask.cacheReadTokens,
                  startedAt: new Date(ask.startedAt).toISOString(),
                  finishedAt: ask.finishedAt ? new Date(ask.finishedAt).toISOString() : null,
                },
              ]
            : [],
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
      askChanged.current?.();
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
      startAsk(prompt, !answerElsewhere && ask.phase === "done");
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
          {mode !== "ask" && triage?.prompt === prompt.trim() && <p className="text-xs text-muted-foreground" role="status">Suggestion: {triage.suggestedMode} · complexity {triage.complexity}/3 · {triage.recommendedWorkers} workers{triage.ambiguous ? " · consider pausing for PRD review" : ""}</p>}
          <div className="flex flex-wrap items-center gap-2 text-sm" aria-label="Mission templates">
            <span className="text-muted-foreground">Templates:</span>
            {([
              { label: "Implement feature", mode: "build" as const, text: "Goal:\n\nAcceptance criteria:\n- " },
              { label: "Fix failing tests", mode: "fix" as const, text: "Failing tests or error:\n\nExpected behavior:\n\nAcceptance criteria:\n- Reproduce the failure\n- Fix the cause\n- Verify the affected tests" },
            ]).map((template) => (
              <button key={template.label} type="button" className="rounded-lg border px-2 py-1 hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" onClick={() => {
                if (prompt.trim() && !window.confirm("Replace your current draft with this template?")) return;
                setMode(template.mode);
                onPromptChange(template.text);
                inputRef.current?.focus();
              }}>{template.label}</button>
            ))}
            <Link className="rounded-lg border px-2 py-1 hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" href="/reviews">Review changes</Link>
          </div>

          <div className="composer-input">
            <Label htmlFor="mission-prompt" className="sr-only">
              {mode === "ask" ? "Your question" : "Mission objective"}
            </Label>
            <Textarea
              ref={inputRef}
              id="mission-prompt"
              value={prompt}
              onChange={(event) => onPromptChange(event.target.value)}
              {...(onImagesChange ? imageDrop : {})}
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
              {onImagesChange && <AttachImages images={images ?? []} onChange={onImagesChange} disabled={busy} />}
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
          <EarlierTurns turns={thread} />
          <p className="answer-you">
            <span className="sr-only">You asked: </span>
            {ask.question}
          </p>
          <div className="answer-row" style={agentLook("PM")}>
            <span className="answer-avatar" aria-hidden="true" data-asks={waiting.length > 0 || undefined}>
              <span
                className="agent-bot answer-bot"
                data-state={ask.phase === "running" && waiting.length === 0 ? "working" : undefined}
                data-hop={ask.phase === "done" ? "" : undefined}
                style={agentLook("PM")}
              >
                <BotRig role="PM" />
              </span>
              {waiting.length > 0 && <AskHand />}
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
              {ask.phase === "done" && (
                <>
                  <WorkSummary
                    steps={askSteps}
                    spent={duration((ask.finishedAt ?? now) - ask.startedAt)}
                    files={answer.files.length}
                  >
                    <StepTrail steps={askSteps} live={false} all />
                  </WorkSummary>
                  <ThinkingBlock text={reasoningOf(askSteps)} />
                </>
              )}
              {answer.body ? (
                <div className="composer-markdown">
                  <AgentMarkdown
                    text={answer.body}
                    onOption={ask.phase === "done" ? (option) => void startAsk(option, true) : undefined}
                    optionsDisabled={asking}
                  />
                </div>
              ) : (
                ask.phase === "running" &&
                waiting.length === 0 && (
                  <StepTrail
                    steps={askSteps}
                    live
                    label={askSteps.length === 0 ? "Reading the project…" : "Thinking…"}
                  />
                )
              )}
              {waiting.length > 0 && (
                <ApprovalAsk
                  agentName={ask.agentName}
                  approvals={waiting}
                  readOnly={role === "viewer"}
                  send={answerAsk}
                />
              )}
              <FilesRead files={answer.files} />
              {ask.phase === "done" && answer.body && (
                <ReplyMeta
                  at={new Date(ask.startedAt).toISOString()}
                  finishedAt={ask.finishedAt ? new Date(ask.finishedAt).toISOString() : null}
                  model={ask.model}
                  tokens={ask.tokens}
                  inputTokens={ask.inputTokens}
                  outputTokens={ask.outputTokens}
                  cacheReadTokens={ask.cacheReadTokens}
                  copyText={answer.body}
                />
              )}
              <div className="flex flex-wrap gap-2">
                {ask.phase === "running" ? (
                  <Button variant="outline" className="min-h-10" onClick={stopAsk}>
                    <Square className="size-3.5" />
                    Stop
                  </Button>
                ) : (
                  <>
                    {ask.phase === "failed" && (
                      <Button
                        variant="outline"
                        className="min-h-10"
                        disabled={startingAsk}
                        onClick={() => void startAsk(ask.question, false, true)}
                      >
                        <RotateCcw className="size-3.5" aria-hidden="true" />
                        Try again
                      </Button>
                    )}
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

/** While the Ask agent reads the project: its steps, Kiro Crew style. */

/** Earlier questions of this Ask thread, folded: each answer with its model, tokens and time. */
function EarlierTurns({ turns }: { turns: AskTurn[] }) {
  if (turns.length === 0) return null;
  return (
    <details className="ask-earlier">
      <summary>
        {turns.length} earlier {turns.length === 1 ? "question" : "questions"} in this thread
      </summary>
      {turns.map((t, i) => {
        const body = splitAnswerFiles(t.answer);
        return (
          <div key={t.runId ?? i} className="ask-earlier-turn">
            <p className="answer-you">{t.question}</p>
            <div className="composer-markdown">
              <AgentMarkdown text={body.body} />
            </div>
            <FilesRead files={body.files} />
            <ReplyMeta
              at={t.startedAt}
              finishedAt={t.finishedAt}
              model={t.model}
              tokens={t.tokens}
              inputTokens={t.inputTokens}
              outputTokens={t.outputTokens}
              cacheReadTokens={t.cacheReadTokens}
              copyText={body.body || undefined}
            />
          </div>
        );
      })}
    </details>
  );
}
