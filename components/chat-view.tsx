"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronRight, FolderGit2, Loader2, MessagesSquare, Plus, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Picker } from "@/components/ui/picker";
import { Textarea } from "@/components/ui/textarea";
import { AgentBot, agentLook, roleForAgent } from "@/components/agent-bot";
import { useRole } from "@/hooks/use-role";
import { timeAgo } from "@/lib/client-api";
import { splitAnswerFiles } from "@/lib/ask-history";
import type { AskQuestionDTO } from "@/lib/ask-history";
import { groupByProject } from "@/lib/chats";
import type { ChatThread } from "@/lib/chats";
import type { SavedProject } from "@/lib/projects";

/** How often a chat re-reads an answer that is still being written. */
const POLL_MS = 3000;
const NEW = "new";

async function getJson(url: string) {
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : `Couldn't load (${res.status})`);
  return data;
}

export function ChatView() {
  const role = useRole();
  const canSend = role === "admin";
  const [chats, setChats] = useState<ChatThread[] | null>(null);
  const [projects, setProjects] = useState<SavedProject[]>([]);
  const [error, setError] = useState("");
  // `?chat=<id>` (from a project's Questions tab) opens that chat.
  const [selected, setSelected] = useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("chat"),
  );
  const [newProject, setNewProject] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const input = useRef<HTMLTextAreaElement>(null);

  function toggleGroup(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const load = useCallback(async () => {
    try {
      const data = await getJson("/api/chats");
      setChats(Array.isArray(data.chats) ? data.chats : []);
      setError("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Couldn't load chats");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    getJson("/api/chats")
      .then((d) => !cancelled && setChats(Array.isArray(d.chats) ? d.chats : []))
      .catch((e: Error) => !cancelled && setError(e.message));
    getJson("/api/projects")
      .then((d) => !cancelled && setProjects(Array.isArray(d.projects) ? d.projects : []))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const groups = useMemo(() => groupByProject(chats ?? []), [chats]);
  const isNew = selected === NEW || (chats !== null && chats.length === 0);
  // A link may name any message in the chat, not only the first one.
  const chat = isNew
    ? null
    : ((chats ?? []).find((c) => c.id === selected || c.messages.some((m) => m.id === selected)) ?? chats?.[0] ?? null);
  const running = chat?.messages.find((m) => m.status === "running") ?? null;

  // A running answer is read through /api/ask/<id>, which also saves it; then the list reloads.
  useEffect(() => {
    if (!running?.agentId) return;
    const url = `/api/ask/${encodeURIComponent(running.id)}?agentId=${encodeURIComponent(running.agentId)}`;
    const timer = setInterval(() => {
      fetch(url, { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { status?: string } | null) => {
          if (data?.status && data.status !== "running" && data.status !== "queued") void load();
        })
        .catch(() => undefined);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [running?.id, running?.agentId, load]);

  async function send() {
    const question = draft.trim();
    if (!question) {
      input.current?.focus();
      return;
    }
    const projectId = chat ? chat.projectId : newProject || null;
    const path = projectId ? (projectById.get(projectId)?.path ?? "") : "";
    const last = chat?.messages[chat.messages.length - 1];
    setSending(true);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, workspace_path: path || undefined, session_id: last?.id }),
      });
      const data = (await res.json().catch(() => ({}))) as { runId?: string; error?: string };
      if (!res.ok || !data.runId) {
        toast.error(data.error ?? `Couldn't send (${res.status})`);
        return;
      }
      setDraft("");
      await load();
      setSelected(chat ? chat.id : data.runId);
    } catch {
      toast.error("Network error");
    } finally {
      setSending(false);
    }
  }

  function startNew() {
    setSelected(NEW);
    setDraft("");
    requestAnimationFrame(() => input.current?.focus());
  }

  const chatProject = chat?.projectId ? projectById.get(chat.projectId) : undefined;

  return (
    <div className="w-full p-4 md:p-8">
      <div className="history-head">
        <span className="history-mark" aria-hidden="true">
          <MessagesSquare className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Chat</h1>
          <p className="text-sm text-muted-foreground">Ask the team about a project, or about anything.</p>
        </div>
      </div>

      {error && (
        <p className="project-note" role="alert">
          {error}
        </p>
      )}

      <div className="chat-layout">
        <nav className="chat-list" aria-label="Chats">
          {canSend && (
            <Button className="w-full" onClick={startNew}>
              <Plus aria-hidden="true" />
              New chat
            </Button>
          )}
          {chats === null && !error && (
            <p className="flex items-center gap-2 p-3 text-sm text-muted-foreground" role="status">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading chats…
            </p>
          )}
          {groups.map((group) => {
            const key = group.projectId ?? "loose";
            const name = group.projectId ? (projectById.get(group.projectId)?.name ?? "Project") : null;
            const open = !collapsed.has(key);
            const items = (
              <ul id={`chat-group-${key}`} className={name ? "chat-group-items" : undefined}>
                {group.threads.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      className="chat-item"
                      aria-current={!isNew && chat?.id === t.id ? "true" : undefined}
                      onClick={() => setSelected(t.id)}
                    >
                      <span className="block truncate font-medium">{t.title}</span>
                      <span className="block text-xs text-muted-foreground">
                        {t.status === "running" ? "Answering…" : timeAgo(t.lastAt)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            );
            // Chats with no project: a plain list, no heading.
            if (!name) return <div key={key}>{items}</div>;
            return (
              <section key={key} className="chat-group" data-open={open || undefined}>
                <button
                  type="button"
                  className="chat-group-head"
                  aria-expanded={open}
                  aria-controls={`chat-group-${key}`}
                  onClick={() => toggleGroup(key)}
                >
                  <ChevronRight className="chat-group-chevron size-4" aria-hidden="true" />
                  <FolderGit2 className="size-4 text-primary" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{name}</span>
                  <span className="project-count">{group.threads.length}</span>
                </button>
                {open && items}
              </section>
            );
          })}
        </nav>

        <section className="chat-pane" aria-label={chat ? chat.title : "New chat"}>
          <header className="chat-pane-head">
            <h2 className="min-w-0 truncate text-base font-semibold">{chat ? chat.title : "New chat"}</h2>
            {chatProject && <span className="project-git">{chatProject.name}</span>}
          </header>

          <div className="chat-messages" aria-live="polite">
            {isNew && (
              <p className="chat-empty">Pick a project to ask about its files, or leave it empty to just chat.</p>
            )}
            {chat?.messages.map((m) => <ChatTurn key={m.id} row={m} />)}
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
                placeholder={chat ? "Ask a follow-up…" : "Ask anything…"}
                aria-label="Message"
                rows={2}
                maxLength={20000}
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                {isNew ? (
                  <Picker
                    size="sm"
                    value={newProject}
                    onChange={setNewProject}
                    aria-label="Project"
                    options={[{ value: "", label: "No folder" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">⌘ / Ctrl + Enter</span>
                )}
                <Button type="submit" disabled={sending || !draft.trim() || running !== null}>
                  {sending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Send aria-hidden="true" />}
                  Send
                </Button>
              </div>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}

/** One question and its answer: the question on the right, the robot's reply on the left. */
function ChatTurn({ row }: { row: AskQuestionDTO }) {
  const botRole = roleForAgent(row.agentName || "Q&A");
  const answer = splitAnswerFiles(row.answer);
  const asleep = row.status === "failed" || row.status === "stopped";
  return (
    <>
      <p className="chat-you">{row.question}</p>
      <div className="chat-reply" style={agentLook(botRole)}>
        <span className="chat-bot">
          <AgentBot name={row.agentName || "Q&A"} role={botRole} asleep={asleep} working={row.status === "running"} />
        </span>
        <div className="min-w-0">
          <p className="chat-name">{row.agentName || "Q&A"}</p>
          <div className="chat-bubble">
            {row.status === "running" ? (
              <span className="chat-dots" aria-label="Answering">
                <i />
                <i />
                <i />
              </span>
            ) : asleep ? (
              <p className="text-sm text-muted-foreground">{row.error || "No answer: the question was stopped."}</p>
            ) : (
              <div className="composer-markdown">
                <Markdown remarkPlugins={[remarkGfm]}>{answer.body}</Markdown>
              </div>
            )}
            {answer.files.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">Read: {answer.files.join(", ")}</p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
