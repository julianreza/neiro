"use client";

import { useState, type CSSProperties, type PointerEvent } from "react";

type Accessory = "halo" | "clip" | "hat" | "brush" | "book" | "mag" | "check";

type Look = {
  /** Card gradient: top-left -> bottom-right. Dark enough for white text. */
  from: string;
  to: string;
  /** Bot body: light, mid, dark, and the glow of eyes/core. */
  c1: string;
  c2: string;
  c3: string;
  glow: string;
  accessory: Accessory;
};

const looks: Record<string, Look> = {
  PM: { from: "#14b8a6", to: "#134e4a", c1: "#99f6e4", c2: "#2dd4bf", c3: "#0f766e", glow: "#ccfbf1", accessory: "halo" },
  PRD: { from: "#8b5cf6", to: "#3b0764", c1: "#ddd6fe", c2: "#a78bfa", c3: "#6d28d9", glow: "#f5d0fe", accessory: "clip" },
  Backend: { from: "#f97316", to: "#7c2d12", c1: "#fed7aa", c2: "#fb923c", c3: "#c2410c", glow: "#fef08a", accessory: "hat" },
  Frontend: { from: "#ec4899", to: "#831843", c1: "#fbcfe8", c2: "#f472b6", c3: "#be185d", glow: "#fce7f3", accessory: "brush" },
  DevOps: { from: "#0ea5e9", to: "#0c4a6e", c1: "#bae6fd", c2: "#38bdf8", c3: "#0369a1", glow: "#e0f2fe", accessory: "hat" },
  Research: { from: "#10b981", to: "#064e3b", c1: "#a7f3d0", c2: "#34d399", c3: "#047857", glow: "#d1fae5", accessory: "book" },
  Content: { from: "#f59e0b", to: "#78350f", c1: "#fde68a", c2: "#fbbf24", c3: "#b45309", glow: "#fef9c3", accessory: "brush" },
  QA: { from: "#3b82f6", to: "#1e3a8a", c1: "#bfdbfe", c2: "#60a5fa", c3: "#1d4ed8", glow: "#dbeafe", accessory: "mag" },
  Security: { from: "#334155", to: "#020617", c1: "#fecdd3", c2: "#fb7185", c3: "#be123c", glow: "#ffe4e6", accessory: "check" },
};

const fallback = looks.PM;

/** Best-guess role for a free-text agent name ("Backend worker" -> Backend). */
export function roleForAgent(name: string): string {
  const n = name.toLowerCase();
  const hits: [RegExp, string][] = [
    [/orchestr|\bpm\b|lead|plan/, "PM"],
    [/spec|prd|require/, "PRD"],
    [/backend|api|server/, "Backend"],
    [/frontend|\bui\b|interface/, "Frontend"],
    [/devops|infra|deploy|relay/, "DevOps"],
    [/research|atlas/, "Research"],
    [/content|writer|muse/, "Content"],
    [/\bqa\b|test|inspect|sentinel/, "QA"],
    [/review|security|lens/, "Security"],
  ];
  const hit = hits.find(([re]) => re.test(n));
  if (hit) return hit[1];
  const roles = Object.keys(looks);
  let h = 0;
  for (const ch of n) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return roles[h % roles.length];
}

/** Main gradient color of a role, for things drawn outside the card. */
export function agentColor(role: string): string {
  return (looks[role] ?? fallback).from;
}

/** CSS variables that colour an `.agent-card` and the bot inside it. */
export function agentLook(role: string): CSSProperties {
  const look = looks[role] ?? fallback;
  return {
    "--agent-from": look.from,
    "--agent-to": look.to,
    "--bot-c1": look.c1,
    "--bot-c2": look.c2,
    "--bot-c3": look.c3,
    "--bot-glow": look.glow,
  } as CSSProperties;
}

/** Eyes and head follow the pointer across the card. No React re-render. */
export function followPointer(event: PointerEvent<HTMLElement>) {
  if (event.pointerType === "touch") return;
  const card = event.currentTarget;
  const rect = card.getBoundingClientRect();
  const clamp = (n: number) => Math.max(-1, Math.min(1, n));
  const dx = clamp((event.clientX - rect.left - rect.width / 2) / (rect.width / 2));
  const dy = clamp((event.clientY - rect.top - rect.height / 3) / (rect.height / 2));
  card.style.setProperty("--ex", `${(dx * 0.35).toFixed(3)}em`);
  card.style.setProperty("--ey", `${(dy * 0.2).toFixed(3)}em`);
  card.style.setProperty("--tilt", `${(dx * 8).toFixed(2)}deg`);
}

export function resetPointer(event: PointerEvent<HTMLElement>) {
  const card = event.currentTarget;
  card.style.removeProperty("--ex");
  card.style.removeProperty("--ey");
  card.style.removeProperty("--tilt");
}

export function AgentBot({
  name,
  role,
  asleep,
  working,
}: {
  name: string;
  role: string;
  asleep: boolean;
  working: boolean;
}) {
  const [hop, setHop] = useState(false);
  const accessory = (looks[role] ?? fallback).accessory;
  const state = asleep ? "asleep" : working ? "working" : "idle";

  return (
    <button
      type="button"
      className="agent-bot"
      data-state={state}
      data-hop={hop || undefined}
      aria-label={asleep ? `${name} is paused` : `Say hi to ${name}`}
      onClick={() => !asleep && setHop(true)}
      onAnimationEnd={(event) => {
        if (event.animationName === "bot-hop") setHop(false);
      }}
    >
      <span className="bot-rig" aria-hidden="true">
        {accessory === "halo" && <i className="bot-halo" />}
        {accessory !== "hat" && <i className="bot-ant" />}
        <i className="bot-head">
          <i className="bot-visor">
            <i className="bot-eyes">
              <i className="bot-eye" />
              <i className="bot-eye" />
            </i>
          </i>
        </i>
        {accessory === "hat" && <i className="bot-hat" />}
        <i className="bot-body">
          <i className="bot-core" />
        </i>
        {accessory !== "halo" && accessory !== "hat" && (
          <i className={`bot-${accessory}`} />
        )}
        {asleep && <i className="bot-zz">z</i>}
      </span>
    </button>
  );
}
