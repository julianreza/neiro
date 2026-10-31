"use client";

import { useState } from "react";
import { BotMessageSquare } from "lucide-react";
import { BotRig, agentLook } from "@/components/agent-bot";
import {
  BotChatPane,
  BotRail,
  RoomList,
  RoomPane,
  lookRole,
  useBots,
  useRooms,
  type ChatTarget,
} from "@/components/bot-mode";
import { useRole } from "@/hooks/use-role";
import { missionHref, timeAgo } from "@/lib/client-api";

/**
 * The Bots page (Hermes Bot Mode), layout 2: every bot on a robot rail,
 * then Group rooms and each bot's own chat in the list, and the open chat or
 * room on the right. Separate from /chat, which keeps the project threads.
 */
export function BotsView() {
  const role = useRole();
  const canSend = role === "admin";
  const { bots } = useBots();
  const rooms = useRooms();
  // `?room=<id>` (from Needs you) or `?bot=<agentId>` opens that one.
  const [target, setTarget] = useState<ChatTarget | null>(() => {
    if (typeof window === "undefined") return null;
    const q = new URLSearchParams(window.location.search);
    const room = q.get("room");
    const bot = q.get("bot");
    return room ? { kind: "room", id: room } : bot ? { kind: "bot", id: bot } : null;
  });
  // Nothing picked yet: the first bot.
  const open: ChatTarget | null = target ?? (bots[0] ? { kind: "bot", id: bots[0].id } : null);
  const openBot = open?.kind === "bot" ? bots.find((b) => b.id === open.id) : undefined;
  const pick = (next: ChatTarget) => {
    setTarget(next);
    const url = new URL(window.location.href);
    url.search = next.kind === "room" ? `?room=${encodeURIComponent(next.id)}` : next.kind === "bot" ? `?bot=${encodeURIComponent(next.id)}` : "";
    window.history.replaceState(null, "", url);
  };

  return (
    <div className="w-full p-4 md:p-8">
      <div className="history-head">
        <span className="history-mark" aria-hidden="true">
          <BotMessageSquare className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Bots</h1>
          <p className="text-sm text-muted-foreground">
            Talk to each bot in its own chat that remembers you, or put several in a room to work it out together.
          </p>
        </div>
      </div>

      <div className="chat-layout chat-layout-bots">
        <BotRail bots={bots} target={open ?? { kind: "thread" }} onPick={(id) => pick({ kind: "bot", id })} />
        <nav className="chat-list" aria-label="Rooms and bots">
          <RoomList
            rooms={rooms.rooms}
            bots={bots}
            target={open ?? { kind: "thread" }}
            canEdit={canSend}
            error={rooms.error}
            onPick={(id) => pick({ kind: "room", id })}
            onCreated={(room) => {
              rooms.reload();
              pick({ kind: "room", id: room.id });
            }}
          />
          <section className="room-list" aria-labelledby="bot-list-head">
            <h2 id="bot-list-head" className="eyebrow">Direct chats</h2>
            {bots.length === 0 && <p className="text-xs text-muted-foreground">Turn bots on in AI team first.</p>}
            <ul>
              {bots.map((b) => {
                const look = lookRole(b);
                return (
                  <li key={b.id}>
                    <button
                      type="button"
                      className="chat-item bot-item"
                      style={agentLook(look)}
                      aria-current={open?.kind === "bot" && open.id === b.id ? "true" : undefined}
                      onClick={() => pick({ kind: "bot", id: b.id })}
                    >
                      <span className="bot-item-avatar" aria-hidden="true">
                        <span className="agent-bot block" data-state={b.activeRun ? "working" : "idle"}>
                          <BotRig role={look} />
                        </span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{b.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {b.lastMessage ?? `@${b.handle} · ${b.role}`}
                        </span>
                      </span>
                      {b.lastAt && <span className="text-[10px] text-muted-foreground">{timeAgo(b.lastAt)}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        </nav>

        {open?.kind === "room" ? (
          <RoomPane
            key={open.id}
            roomId={open.id}
            bots={bots}
            canSend={canSend}
            onChanged={rooms.reload}
            onMission={(id) => window.location.assign(missionHref(id))}
          />
        ) : openBot ? (
          <BotChatPane key={openBot.id} bot={openBot} bots={bots} canSend={canSend} />
        ) : (
          <section className="chat-pane">
            <p className="chat-empty">Pick a bot on the left.</p>
          </section>
        )}
      </div>
    </div>
  );
}
