"use client";

import type { ReactNode } from "react";
import { AgentBot, agentLook } from "@/components/agent-bot";

/** Missions and questions are run by the PM, so the PM robot tells their story. */
export const STORY_ROLE = "PM";

/** "Today", "Yesterday", or a date like "26 Oct", in the viewer's time zone. */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Earlier";
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(now) - start(d)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** Splits a newest-first list into day groups, keeping the order. */
export function groupByDay<T>(rows: T[], dateOf: (row: T) => string): { day: string; rows: T[] }[] {
  const groups: { day: string; rows: T[] }[] = [];
  for (const row of rows) {
    const day = dayLabel(dateOf(row));
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.rows.push(row);
    else groups.push({ day, rows: [row] });
  }
  return groups;
}

/** A day heading with how many items it holds. */
export function StoryDay({ day, count, noun }: { day: string; count: number; noun: [string, string] }) {
  return (
    <h2 className="story-day">
      <span>{day}</span>
      <span className="story-day-count">
        {count} {count === 1 ? noun[0] : noun[1]}
      </span>
    </h2>
  );
}

export type StoryTone = "done" | "live" | "wait" | "off" | "bad";

/** The coloured word in the top corner of a story bubble. */
export function StoryPill({ tone, children }: { tone: StoryTone; children: ReactNode }) {
  return (
    <span className="story-pill" data-tone={tone}>
      {children}
    </span>
  );
}

/** The raised bar above a feed: search on the left, filters on the right. */
export function StoryToolbar({ children }: { children: ReactNode }) {
  return <div className="story-toolbar">{children}</div>;
}

/** "1.8M", "38k", "512". */
export function compactTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

/** An empty History list: the PM robot says what to do next. */
export function StoryEmpty({ title, body }: { title: string; body: ReactNode }) {
  return (
    <div className="story-empty">
      <span className="story-bot" style={agentLook(STORY_ROLE)}>
        <AgentBot name="PM" role={STORY_ROLE} asleep={false} working={false} />
      </span>
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}
