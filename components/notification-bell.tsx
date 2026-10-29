"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useRole } from "@/hooks/use-role";
import { missionHref, sendJson, timeAgo } from "@/lib/client-api";
import type { NotificationKind } from "@/lib/notifications";
import type { NotificationDTO } from "@/lib/notifications-store";

const POLL_MS = 30_000;

const DOT: Record<NotificationKind, string> = {
  mission_completed: "bg-emerald-500",
  plan_ready: "bg-amber-400",
  task_needs_you: "bg-red-500",
  routing_needs_you: "bg-sky-500",
  budget_reached: "bg-orange-500",
  mission_error: "bg-red-500",
};

export function NotificationBell() {
  const [items, setItems] = useState<NotificationDTO[]>([]);
  const [unread, setUnread] = useState(0);
  const [available, setAvailable] = useState(true);
  const role = useRole();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?limit=20", { cache: "no-store" });
      if (!res.ok) {
        // Not set up yet (no Supabase / no migration): hide quietly, the
        // Gateway page explains setup.
        setAvailable(res.status !== 503);
        return;
      }
      const data = await res.json();
      setAvailable(true);
      setItems(Array.isArray(data.items) ? data.items : []);
      setUnread(Number(data.unread) || 0);
    } catch {
      // Offline: keep the last list.
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  async function markAllRead() {
    const result = await sendJson("/api/notifications", "POST", {});
    if (result.ok) {
      setUnread(0);
      setItems((list) => list.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
    }
  }

  if (!available) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="relative"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        >
          <Bell className="size-4" />
          {unread > 0 && (
            <span
              aria-hidden="true"
              className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground"
            >
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="font-semibold">Notifications</span>
          {unread > 0 && role !== "viewer" && (
            <button type="button" className="text-xs text-primary hover:underline" onClick={() => void markAllRead()}>
              Mark all read
            </button>
          )}
        </div>
        {items.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            Nothing yet. You&apos;ll hear here when a mission finishes or gets stuck.
          </p>
        ) : (
          <ul className="max-h-96 divide-y overflow-y-auto">
            {items.map((n) => (
              <li key={n.id}>
                <a
                  href={n.missionId ? missionHref(n.missionId) : "/needs-you"}
                  className="flex gap-2.5 px-3 py-2.5 hover:bg-secondary/50"
                >
                  <span
                    aria-hidden="true"
                    className={`mt-1.5 size-2 shrink-0 rounded-full ${n.readAt ? "border border-muted-foreground/50 bg-transparent" : DOT[n.kind] ?? "bg-primary"}`}
                  />
                  <span className="min-w-0">
                    <span className={`block text-sm ${n.readAt ? "" : "font-medium"}`}>{n.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {n.body} · {timeAgo(n.createdAt)}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t px-3 py-2 text-right">
          <Link href="/needs-you" className="text-xs text-primary hover:underline">
            Open Needs you
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
