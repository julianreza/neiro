"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { ChatTurn } from "@/components/chat-view";
import { DeleteButton } from "@/components/delete-button";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { normalizeApprovals, type PendingApproval } from "@/lib/approvals";
import type { AskQuestionDTO } from "@/lib/ask-history";
import type { ChatThread } from "@/lib/chats";

/** How often a running answer is re-read. */
const POLL_MS = 3000;

/** One chat of a project on the Projects page: its turns and a follow-up box. */
export function ProjectQuestionPanel({
  thread,
  projectPath,
  canSend,
  onReload,
  onDeleted,
}: {
  thread: ChatThread;
  projectPath: string;
  canSend: boolean;
  /** Re-read the project's questions (after a send, or when an answer ends). */
  onReload: () => void;
  onDeleted: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [approvals, setApprovals] = useState<{ runId: string; list: PendingApproval[] } | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const reload = useRef(onReload);
  useEffect(() => {
    reload.current = onReload;
  }, [onReload]);

  const running = thread.messages.find((m) => m.status === "running") ?? null;

  // A running answer is read through /api/ask/<id>, which also saves it; then the list reloads.
  useEffect(() => {
    if (!running?.agentId) return;
    const url = `/api/ask/${encodeURIComponent(running.id)}?agentId=${encodeURIComponent(running.agentId)}`;
    const id = running.id;
    const timer = setInterval(() => {
      fetch(url, { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { status?: string; approvals?: unknown } | null) => {
          if (!data) return;
          setApprovals({ runId: id, list: normalizeApprovals(data.approvals) });
          reload.current();
        })
        .catch(() => undefined);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [running?.id, running?.agentId]);

  async function answerApproval(row: AskQuestionDTO, approval: PendingApproval, approve: boolean) {
    if (!row.agentId) return "This answer has no agent to reply to.";
    try {
      const res = await fetch(`/api/ask/${encodeURIComponent(row.id)}?agentId=${encodeURIComponent(row.agentId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approve, requestId: approval.requestId }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        return data.error ?? `Request failed (${res.status})`;
      }
      setApprovals((cur) => (cur ? { ...cur, list: cur.list.filter((a) => a !== approval) } : cur));
      return null;
    } catch {
      return "Network error";
    }
  }

  async function ask(question: string): Promise<boolean> {
    const last = thread.messages[thread.messages.length - 1];
    setSending(true);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, workspace_path: projectPath, session_id: last?.id }),
      });
      const data = (await res.json().catch(() => ({}))) as { runId?: string; error?: string };
      if (!res.ok || !data.runId) {
        toast.error(data.error ?? `Couldn't send (${res.status})`);
        return false;
      }
      reload.current();
      return true;
    } catch {
      toast.error("Network error");
      return false;
    } finally {
      setSending(false);
    }
  }

  async function send() {
    const question = draft.trim();
    if (!question) {
      input.current?.focus();
      return;
    }
    if (await ask(question)) setDraft("");
  }

  return (
    <section className="chat-pane project-chat" aria-label={thread.title}>
      <header className="chat-pane-head">
        <h2 className="min-w-0 truncate text-base font-semibold">{thread.title}</h2>
        {canSend && (
          <DeleteButton
            url={`/api/chats/${encodeURIComponent(thread.id)}`}
            what="Chat"
            title="Delete this chat?"
            disabledReason={running ? "The robot is still answering. Wait for it, or stop it, then delete." : undefined}
            body={
              <p>
                All {thread.messages.length} message{thread.messages.length === 1 ? "" : "s"} of this chat are deleted.
                This can&apos;t be undone.
              </p>
            }
            onDeleted={onDeleted}
          />
        )}
      </header>

      <div className="chat-messages" aria-live="polite">
        {thread.messages.map((m) => (
          <ChatTurn
            key={m.id}
            row={m}
            approvals={m.status === "running" && approvals?.runId === m.id ? approvals.list : []}
            canAnswer={canSend}
            answer={(approval, approve) => answerApproval(m, approval, approve)}
            retry={running || sending ? undefined : () => void ask(m.question)}
          />
        ))}
      </div>

      {canSend && (
        <form
          className="chat-compose"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <Textarea
            ref={input}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void send();
              }
            }}
            placeholder="Ask a follow-up…"
            aria-label="Follow-up question"
            rows={2}
            maxLength={20000}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">⌘ / Ctrl + Enter</span>
            <Button type="submit" disabled={sending || !draft.trim() || running !== null}>
              {sending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Send aria-hidden="true" />}
              Send
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
