"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Archive, Loader2, Minimize2, Plus, Rocket, Send, Square, Users } from "lucide-react";
import { toast } from "sonner";
import { AgentBot, BotRig, agentLook, botRoles, roleForAgent } from "@/components/agent-bot";
import { AgentMarkdown } from "@/components/agent-markdown";
import { AttachImages, useImageDrop } from "@/components/attach-images";
import { MentionInput, type MentionBot } from "@/components/mention-input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { timeAgo } from "@/lib/client-api";
import type { AskQuestionDTO } from "@/lib/ask-history";
import type { BotDTO } from "@/lib/bots";
import type { BotRoom, BotRoomMessage, ImageAttachment } from "@/lib/types";

/**
 * Hermes Bot Mode on /chat (layout 2, "robot rail + list"): every bot on a
 * rail at the left, Group rooms above the project threads, and the open bot
 * chat or room on the right.
 */

export type ChatTarget = { kind: "thread" } | { kind: "bot"; id: string } | { kind: "room"; id: string };

export const lookRole = (b: { role: string; name: string }) =>
  botRoles.includes(b.role) ? b.role : roleForAgent(`${b.role} ${b.name}`);

async function api<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; data: T & { error?: string } }> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    return { ok: res.ok, data };
  } catch {
    return { ok: false, data: { error: "Network error" } as T & { error?: string } };
  }
}

/** The /api/bots roster, refreshed every 15 s (who is working changes). */
export function useBots(): { bots: BotDTO[]; reload: () => void } {
  const [bots, setBots] = useState<BotDTO[]>([]);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api<{ bots?: BotDTO[] }>("/api/bots").then(({ ok, data }) => alive && ok && setBots(data.bots ?? []));
    void load();
    const timer = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [nonce]);
  return { bots, reload: () => setNonce((n) => n + 1) };
}

export function useRooms(): { rooms: BotRoom[] | null; error: string; reload: () => void } {
  const [rooms, setRooms] = useState<BotRoom[] | null>(null);
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api<{ rooms?: BotRoom[] }>("/api/rooms").then(({ ok, data }) => {
        if (!alive) return;
        if (ok) {
          setRooms(data.rooms ?? []);
          setError("");
        } else {
          setRooms([]);
          setError(data.error ?? "Could not load rooms");
        }
      });
    void load();
    const timer = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [nonce]);
  return { rooms, error, reload: () => setNonce((n) => n + 1) };
}

export const mentionList = (bots: BotDTO[]): MentionBot[] =>
  bots.map((b) => ({ handle: b.handle, name: b.name, role: b.role }));

/* ------------------------------------------------------------------ */
/* Rail                                                                */
/* ------------------------------------------------------------------ */

export function BotRail({ bots, target, onPick }: { bots: BotDTO[]; target: ChatTarget; onPick: (id: string) => void }) {
  const sections = [...new Set(bots.map((b) => b.section))];
  return (
    <nav className="bot-rail" aria-label="Bots">
      {sections.map((section) => (
        <div key={section} className="bot-rail-group" role="group" aria-label={section}>
          {sections.length > 1 && <span className="bot-rail-section">{section}</span>}
          {bots
            .filter((b) => b.section === section)
            .map((b) => {
              const role = lookRole(b);
              const on = target.kind === "bot" && target.id === b.id;
              return (
                <button
                  key={b.id}
                  type="button"
                  className="bot-rail-item"
                  style={agentLook(role)}
                  aria-current={on ? "true" : undefined}
                  aria-label={`${b.name}, @${b.handle}${b.activeRun ? ", working" : ""}`}
                  title={`${b.name} · @${b.handle}${b.lastMessage ? `\n${b.lastMessage}` : ""}`}
                  onClick={() => onPick(b.id)}
                >
                  <span className="agent-bot block" data-state={b.activeRun ? "working" : "idle"} aria-hidden="true">
                    <BotRig role={role} />
                  </span>
                  {b.activeRun && <span className="bot-rail-live" aria-hidden="true" />}
                </button>
              );
            })}
        </div>
      ))}
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* Room list (above the project threads)                               */
/* ------------------------------------------------------------------ */

export function RoomList({
  rooms,
  bots,
  target,
  canEdit,
  onPick,
  onCreated,
  error,
}: {
  rooms: BotRoom[] | null;
  bots: BotDTO[];
  target: ChatTarget;
  canEdit: boolean;
  onPick: (id: string) => void;
  onCreated: (room: BotRoom) => void;
  error: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="room-list" aria-labelledby="room-list-head">
      <div className="flex items-center justify-between gap-2">
        <h2 id="room-list-head" className="eyebrow">Group rooms</h2>
        {canEdit && (
          <Button variant="ghost" size="sm" onClick={() => setOpen(true)} disabled={bots.length < 2}>
            <Plus aria-hidden="true" /> Room
          </Button>
        )}
      </div>
      {error && <p className="text-xs text-muted-foreground">{error}</p>}
      {rooms && rooms.length === 0 && !error && (
        <p className="text-xs text-muted-foreground">No rooms yet. A room lets 2 to 6 bots talk it through.</p>
      )}
      <ul>
        {(rooms ?? []).map((r) => {
          const members = r.memberAgentIds.map((id) => bots.find((b) => b.id === id)).filter(Boolean) as BotDTO[];
          return (
            <li key={r.id}>
              <button
                type="button"
                className="chat-item room-item"
                aria-current={target.kind === "room" && target.id === r.id ? "true" : undefined}
                onClick={() => onPick(r.id)}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
                  {r.needsYou && <span className="room-badge">Needs you</span>}
                  {!r.needsYou && r.driver && <span className="room-live" aria-label="Talking" />}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {members.map((m) => m.name).join(", ") || `${r.memberAgentIds.length} bots`}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {open && (
        <NewRoomDialog
          bots={bots}
          onClose={() => setOpen(false)}
          onCreated={(room) => {
            setOpen(false);
            onCreated(room);
          }}
        />
      )}
    </section>
  );
}

function NewRoomDialog({ bots, onClose, onCreated }: { bots: BotDTO[]; onClose: () => void; onCreated: (room: BotRoom) => void }) {
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const valid = name.trim().length > 0 && picked.length >= 2 && picked.length <= 6;

  async function create() {
    setBusy(true);
    setError("");
    const { ok, data } = await api<{ room?: BotRoom }>("/api/rooms", {
      method: "POST",
      body: JSON.stringify({ name: name.trim(), memberAgentIds: picked }),
    });
    setBusy(false);
    if (!ok || !data.room) return setError(data.error ?? "Could not create the room");
    toast.success(`${data.room.name} created`);
    onCreated(data.room);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New group room</DialogTitle>
          <DialogDescription>Pick 2 to 6 bots. Each message gets up to 3 rounds of replies.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="room-name">Name</Label>
            <Input id="room-name" maxLength={80} value={name} placeholder="Architecture war room" onChange={(e) => setName(e.target.value)} />
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Bots · {picked.length} of 6</legend>
            <div className="room-picker">
              {bots.map((b) => {
                const on = picked.includes(b.id);
                const role = lookRole(b);
                return (
                  <button
                    key={b.id}
                    type="button"
                    className="room-pick"
                    style={agentLook(role)}
                    aria-pressed={on}
                    disabled={!on && picked.length >= 6}
                    onClick={() => setPicked(on ? picked.filter((id) => id !== b.id) : [...picked, b.id])}
                  >
                    <span className="agent-bot block" data-state={on ? "idle" : "asleep"} aria-hidden="true">
                      <BotRig role={role} asleep={!on} />
                    </span>
                    <span>{b.name}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>
          {error && <p role="alert" className="text-sm text-[var(--status-danger)]">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void create()} disabled={!valid || busy}>
            {busy && <Loader2 className="animate-spin" aria-hidden="true" />} Create room
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Composer shared by bot chat and room                                */
/* ------------------------------------------------------------------ */

function Composer({
  bots,
  placeholder,
  busy,
  withImages,
  onSend,
}: {
  bots: MentionBot[];
  placeholder: string;
  busy: boolean;
  withImages: boolean;
  onSend: (text: string, images: ImageAttachment[]) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState("");
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const drop = useImageDrop(images, setImages);
  const send = async () => {
    if (!draft.trim() || busy) return;
    if (await onSend(draft.trim(), images)) {
      setDraft("");
      setImages([]);
    }
  };
  return (
    <form
      className="chat-compose"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <MentionInput
        value={draft}
        onValueChange={setDraft}
        bots={bots}
        {...(withImages ? drop : {})}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void send();
          }
        }}
        placeholder={placeholder}
        aria-label="Message"
        rows={2}
        maxLength={20000}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          {withImages && <AttachImages images={images} onChange={setImages} disabled={busy} />}
          ⌘ / Ctrl + Enter · @ to mention
        </span>
        <Button type="submit" disabled={busy || !draft.trim()}>
          {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Send aria-hidden="true" />}
          Send
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Bot chat (forever-chat)                                             */
/* ------------------------------------------------------------------ */

export function BotChatPane({ bot, bots, canSend }: { bot: BotDTO; bots: BotDTO[]; canSend: boolean }) {
  const [messages, setMessages] = useState<AskQuestionDTO[] | null>(null);
  const [sending, setSending] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<"compact" | "archive" | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const role = lookRole(bot);

  const load = useCallback(async () => {
    const { ok, data } = await api<{ messages?: AskQuestionDTO[] }>(`/api/bots/${encodeURIComponent(bot.id)}`);
    if (ok) setMessages(data.messages ?? []);
    else setMessages((m) => m ?? []);
  }, [bot.id]);

  const running = messages?.find((m) => m.status === "running") ?? null;

  useEffect(() => {
    // Next task, not inside the effect: load() sets state.
    const first = setTimeout(() => void load(), 0);
    return () => clearTimeout(first);
  }, [load]);

  // While a reply is coming, ask its run (that also saves the answer).
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(async () => {
      await api(`/api/ask/${encodeURIComponent(running.id)}?agentId=${encodeURIComponent(bot.id)}`);
      await load();
    }, 3000);
    return () => clearInterval(timer);
  }, [running, bot.id, load]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [messages?.length, running?.answer]);

  async function send(text: string, images: ImageAttachment[]) {
    setSending(true);
    const { ok, data } = await api<{ runId?: string; skippedImages?: boolean }>(`/api/bots/${encodeURIComponent(bot.id)}`, {
      method: "POST",
      body: JSON.stringify({ message: text, images: images.length ? images : undefined }),
    });
    setSending(false);
    if (!ok) {
      toast.error(data.error ?? "Could not send");
      return false;
    }
    if (data.skippedImages) toast.message(`${bot.name}'s model cannot read images; sent the text only.`);
    await load();
    return true;
  }

  async function session(action: "compact" | "archive") {
    setBusyAction(action);
    const { ok, data } = await api(`/api/bots/${encodeURIComponent(bot.id)}/session`, {
      method: "POST",
      body: JSON.stringify({ action }),
    });
    setBusyAction(null);
    setArchiveOpen(false);
    if (!ok) return toast.error(data.error ?? "Could not do it");
    toast.success(action === "compact" ? "Context compacted. The history stays." : "New chat started. The old one is kept in Hermes.");
    await load();
  }

  return (
    <section className="chat-pane" aria-label={`Chat with ${bot.name}`}>
      <header className="chat-pane-head bot-pane-head" style={agentLook(role)}>
        <span className="bot-pane-avatar" aria-hidden="true">
          <AgentBot name={bot.name} role={role} asleep={false} working={Boolean(running) || bot.activeRun} />
        </span>
        <h2>
          {bot.name} <span className="text-sm font-normal text-muted-foreground">@{bot.handle} · {bot.role}</span>
        </h2>
        {canSend && (
          <span className="flex gap-1">
            <Button variant="ghost" size="sm" disabled={!bot.canonicalSessionId || busyAction !== null || bot.runtime !== "hermes"} onClick={() => void session("compact")} title="Shrink what the bot carries, keep the history">
              {busyAction === "compact" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Minimize2 aria-hidden="true" />} Compact
            </Button>
            <Button variant="ghost" size="sm" disabled={busyAction !== null} onClick={() => setArchiveOpen(true)}>
              <Archive aria-hidden="true" /> Start fresh
            </Button>
          </span>
        )}
      </header>
      <div className="chat-messages" aria-live="polite">
        {messages === null && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading…
          </p>
        )}
        {messages?.length === 0 && (
          <p className="chat-empty">This is {bot.name}&apos;s own chat. It remembers what you tell it here.</p>
        )}
        {messages?.map((m) => (
          <div key={m.id} className="chat-turn">
            <p className="chat-you">{m.question}</p>
            <div className="chat-reply" style={agentLook(role)}>
              <div className="chat-bubble" data-failed={m.status === "failed" ? "" : undefined}>
                {m.status === "running" && !m.answer ? (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" /> {bot.name} is thinking…
                  </p>
                ) : m.status === "failed" ? (
                  <p className="text-sm">{m.error ?? "The bot could not answer."}</p>
                ) : (
                  <AgentMarkdown text={m.answer} />
                )}
              </div>
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      {canSend && (
        <Composer
          bots={mentionList(bots)}
          placeholder={`Message ${bot.name}…`}
          busy={sending || Boolean(running)}
          withImages
          onSend={send}
        />
      )}
      {archiveOpen && (
        <Dialog open onOpenChange={(o) => !o && setArchiveOpen(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Start a fresh chat with {bot.name}?</DialogTitle>
              <DialogDescription>
                The bot stops carrying this conversation. Nothing is deleted: the old chat stays in Hermes.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setArchiveOpen(false)}>Keep this chat</Button>
              <Button onClick={() => void session("archive")} disabled={busyAction !== null}>
                {busyAction === "archive" && <Loader2 className="animate-spin" aria-hidden="true" />} Start fresh
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Group room                                                          */
/* ------------------------------------------------------------------ */

export function RoomPane({
  roomId,
  bots,
  canSend,
  onChanged,
  onMission,
}: {
  roomId: string;
  bots: BotDTO[];
  canSend: boolean;
  onChanged: () => void;
  onMission: (missionId: string) => void;
}) {
  const [room, setRoom] = useState<BotRoom | null>(null);
  const [messages, setMessages] = useState<BotRoomMessage[]>([]);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const { ok, data } = await api<{ room?: BotRoom; messages?: BotRoomMessage[] }>(`/api/rooms/${encodeURIComponent(roomId)}`);
    if (!ok || !data.room) return setError(data.error ?? "Could not load the room");
    setError("");
    setRoom(data.room);
    setMessages(data.messages ?? []);
  }, [roomId]);

  useEffect(() => {
    // Next task, not inside the effect: load() sets state.
    const first = setTimeout(() => void load(), 0);
    return () => clearTimeout(first);
  }, [load]);

  // Fast while bots are talking, slow while idle.
  const talking = Boolean(room?.driver) && !room?.needsYou;
  useEffect(() => {
    const timer = setInterval(() => void load(), talking ? 3000 : 15000);
    return () => clearInterval(timer);
  }, [talking, load]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);

  const byId = new Map(bots.map((b) => [b.id, b]));
  const members = (room?.memberAgentIds ?? []).map((id) => byId.get(id)).filter(Boolean) as BotDTO[];
  const speaking = room?.driver?.claim ? byId.get(room.driver.claim.agentId) : undefined;

  async function send(text: string) {
    setSending(true);
    const { ok, data } = await api(`/api/rooms/${encodeURIComponent(roomId)}/messages`, {
      method: "POST",
      body: JSON.stringify({ message: text }),
    });
    setSending(false);
    if (!ok) {
      toast.error(data.error ?? "Could not send");
      return false;
    }
    await load();
    onChanged();
    return true;
  }

  async function control(action: "stop" | "resume" | "to_mission") {
    setActing(action);
    const { ok, data } = await api<{ missionId?: string }>(`/api/rooms/${encodeURIComponent(roomId)}/control`, {
      method: "POST",
      body: JSON.stringify({ action }),
    });
    setActing(null);
    if (!ok) return toast.error(data.error ?? "Could not do it");
    if (action === "to_mission" && data.missionId) {
      toast.success("Mission created. It pauses for your plan approval.");
      onMission(data.missionId);
      return;
    }
    toast.success(action === "stop" ? "Room stopped" : "Room resumed");
    await load();
    onChanged();
  }

  if (error && !room) {
    return (
      <section className="chat-pane">
        <p className="chat-empty" role="alert">{error}</p>
      </section>
    );
  }

  return (
    <section className="chat-pane" aria-label={room ? `Room ${room.name}` : "Room"}>
      <header className="chat-pane-head room-pane-head">
        <Users className="size-4 shrink-0 text-primary" aria-hidden="true" />
        <h2>
          {room?.name ?? "…"}
          {room?.driver && <span className="ml-2 text-sm font-normal text-muted-foreground">round {room.driver.round} of 3</span>}
        </h2>
        <span className="room-members" aria-label="Members">
          {members.map((m) => {
            const role = lookRole(m);
            return (
              <span key={m.id} className="room-member" style={agentLook(role)} title={`${m.name} · @${m.handle}`}>
                <AgentBot name={m.name} role={role} asleep={room?.driver?.paused.includes(m.id) ?? false} working={speaking?.id === m.id} />
              </span>
            );
          })}
        </span>
        {canSend && room && (
          <span className="flex gap-1">
            {room.needsYou ? (
              <Button variant="ghost" size="sm" disabled={acting !== null} onClick={() => void control("resume")}>Resume</Button>
            ) : room.driver ? (
              <Button variant="ghost" size="sm" disabled={acting !== null} onClick={() => void control("stop")}>
                <Square aria-hidden="true" /> Stop room
              </Button>
            ) : null}
            <Button size="sm" className="console-launch" disabled={acting !== null || messages.length === 0} onClick={() => void control("to_mission")}>
              {acting === "to_mission" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Rocket aria-hidden="true" />} To mission
            </Button>
          </span>
        )}
      </header>
      <div className="chat-messages room-feed" aria-live="polite">
        {messages.length === 0 && (
          <p className="chat-empty">Say something. Mention @a-bot to ask one first, or @all for everyone.</p>
        )}
        {messages.map((m) => {
          if (m.senderKind === "system") return <p key={m.id} className="room-system">{m.content}</p>;
          if (m.senderKind === "user") return <p key={m.id} className="chat-you">{m.content}</p>;
          const b = m.senderAgentId ? byId.get(m.senderAgentId) : undefined;
          const role = b ? lookRole(b) : roleForAgent(m.senderName);
          return (
            <div key={m.id} className="room-msg" style={agentLook(role)}>
              <span className="room-msg-bot" aria-hidden="true">
                <AgentBot name={m.senderName} role={role} asleep={false} working={false} />
              </span>
              <div className="chat-bubble">
                <p className="room-msg-who">
                  {m.senderName}
                  {b && <span className="text-muted-foreground"> @{b.handle}</span>}
                  <span className="text-muted-foreground"> · {timeAgo(m.createdAt)}</span>
                </p>
                <AgentMarkdown text={m.content} />
              </div>
            </div>
          );
        })}
        {speaking && !room?.needsYou && (
          <p className="room-system" role="status">
            <Loader2 className="mr-1 inline size-3 animate-spin" aria-hidden="true" /> {speaking.name} is thinking…
          </p>
        )}
        <div ref={end} />
      </div>
      {canSend && (
        <Composer
          bots={mentionList(members.length ? members : bots)}
          placeholder={room?.needsYou ? "Reply to go on…" : "Message the room…"}
          busy={sending}
          withImages={false}
          onSend={(text) => send(text)}
        />
      )}
    </section>
  );
}
