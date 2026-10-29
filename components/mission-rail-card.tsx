"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { AgentBot, agentLook } from "@/components/agent-bot";
import { STORY_ROLE, StoryPill, compactTokens } from "@/components/history-story";
import type { StoryTone } from "@/components/history-story";
import { projectHref, timeAgo } from "@/lib/client-api";
import { STATIONS, railStops } from "@/lib/mission-rail";
import type { MissionStatus, MissionSummaryDTO } from "@/lib/types";

const STATUS_PILL: Record<MissionStatus, { tone: StoryTone; label: string }> = {
  completed: { tone: "done", label: "Completed" },
  running: { tone: "live", label: "Running" },
  awaiting_plan_approval: { tone: "wait", label: "Needs you" },
  cancelled: { tone: "off", label: "Cancelled" },
};

/** Station names, lined up above the rails on wide screens. */
export function RailLegend() {
  return (
    <div className="rail-legend" aria-hidden="true">
      <span />
      <span className="rail-legend-stops">
        {STATIONS.map((s) => (
          <span key={s.phase}>{s.label}</span>
        ))}
      </span>
      <span />
    </div>
  );
}

/** One mission as a card: its robot walks the Plan -> Done track. */
export function MissionRail({ mission: m }: { mission: MissionSummaryDTO }) {
  const { at, states, note } = railStops(m);
  const pill = STATUS_PILL[m.status] ?? { tone: "live" as StoryTone, label: m.status };
  const over = m.tokenBudget ? m.totalTokens >= m.tokenBudget : false;
  const meta = [
    `${m.completedTasks}/${m.totalTasks} tasks`,
    m.totalTokens ? `${compactTokens(m.totalTokens)} tokens` : null,
    timeAgo(m.createdAt),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="rail-card" data-status={m.status} style={agentLook(STORY_ROLE)}>
      <div className="rail-title">
        <Link href={m.projectId ? projectHref(m.projectId, { mission: m.id }) : "/projects"} className="rail-link">
          {m.title}
        </Link>
        <span className="story-meta" title={m.createdAt}>
          {meta}
        </span>
        {over && <span className="story-warn">Used its whole token budget.</span>}
      </div>

      <div className="rail-track" style={{ "--at": at / (STATIONS.length - 1) } as CSSProperties}>
        <span className="rail-line" />
        <span className="rail-fill" />
        {STATIONS.map((s, i) => (
          <span key={s.phase} className="rail-stop" data-state={states[i]}>
            <i />
            <small>{s.label}</small>
          </span>
        ))}
        <span className="rail-bot">
          <AgentBot name="PM" role={STORY_ROLE} asleep={m.status === "cancelled"} working={m.status === "running"} />
        </span>
        <span className="sr-only">{note}.</span>
      </div>

      <StoryPill tone={pill.tone}>{pill.label}</StoryPill>
    </li>
  );
}
