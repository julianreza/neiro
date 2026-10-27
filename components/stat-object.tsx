"use client";

import { useId, useState, type CSSProperties } from "react";

export type StatKind = "mission" | "tasks" | "team" | "tokens";

const palette: Record<StatKind, { from: string; to: string }> = {
  mission: { from: "#8b5cf6", to: "#3b0764" },
  tasks: { from: "#10b981", to: "#064e3b" },
  team: { from: "#0ea5e9", to: "#0c4a6e" },
  tokens: { from: "#ec4899", to: "#831843" },
};

/** Gradient variables for a `.stat-card`. */
export function statLook(kind: StatKind): CSSProperties {
  const { from, to } = palette[kind];
  return { "--stat-from": from, "--stat-to": to } as CSSProperties;
}

function Rocket({ id, active }: { id: string; active: boolean }) {
  return (
    <svg viewBox="0 0 100 110">
      <defs>
        <linearGradient id={`${id}b`} x1="0" x2="1">
          <stop offset="0" stopColor="#fff" />
          <stop offset=".45" stopColor="#ede9fe" />
          <stop offset="1" stopColor="#a78bfa" />
        </linearGradient>
        <radialGradient id={`${id}w`} cx=".35" cy=".3">
          <stop offset="0" stopColor="#e0f2fe" />
          <stop offset="1" stopColor="#1e3a8a" />
        </radialGradient>
      </defs>
      <g transform="rotate(25 50 55)">
        {active && (
          <>
            <ellipse className="stat-flame" cx="50" cy="96" rx="9" ry="14" fill="#fde047" />
            <ellipse className="stat-flame" cx="50" cy="94" rx="5" ry="8" fill="#fff" />
          </>
        )}
        <path d="M30 70 L18 88 L34 84Z M70 70 L82 88 L66 84Z" fill="#7c3aed" />
        <path d="M50 8 C70 24 72 60 66 84 H34 C28 60 30 24 50 8Z" fill={`url(#${id}b)`} />
        <path d="M50 8 C58 15 63 24 66 36 H34 C37 24 42 15 50 8Z" fill="#7c3aed" />
        <circle cx="50" cy="52" r="10" fill={`url(#${id}w)`} stroke="#6d28d9" strokeWidth="4" />
        <circle cx="46" cy="48" r="3" fill="#fff" opacity=".8" />
      </g>
    </svg>
  );
}

function CheckCube({ id, progress }: { id: string; progress: number }) {
  return (
    <svg viewBox="0 0 100 110">
      <defs>
        <linearGradient id={`${id}c`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a7f3d0" />
          <stop offset="1" stopColor="#059669" />
        </linearGradient>
      </defs>
      <g transform="rotate(-10 50 55)">
        <rect x="20" y="30" width="62" height="62" rx="18" fill="#047857" />
        <rect x="16" y="24" width="62" height="62" rx="18" fill={`url(#${id}c)`} />
        <rect x="22" y="28" width="30" height="10" rx="5" fill="#fff" opacity=".45" />
        <path
          d="M32 56 L44 68 L64 44"
          fill="none"
          stroke="#fff"
          strokeWidth="9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
      <circle cx="82" cy="22" r="14" fill="none" stroke="rgb(255 255 255 / .25)" strokeWidth="5" />
      <circle
        className="stat-ring"
        cx="82"
        cy="22"
        r="14"
        fill="none"
        stroke="#fff"
        strokeWidth="5"
        strokeLinecap="round"
        pathLength={100}
        strokeDasharray="100"
        strokeDashoffset={100 - Math.round(progress * 100)}
        transform="rotate(-90 82 22)"
      />
    </svg>
  );
}

function Slab({ y, top, side, className }: { y: number; top: string; side: string; className: string }) {
  return (
    <g className={className}>
      <path d={`M50 ${y} L86 ${y + 16} L50 ${y + 32} L14 ${y + 16}Z`} fill={top} />
      <path d={`M14 ${y + 16} L50 ${y + 32} L50 ${y + 40} L14 ${y + 24}Z`} fill={side} />
      <path d={`M86 ${y + 16} L50 ${y + 32} L50 ${y + 40} L86 ${y + 24}Z`} fill={side} opacity=".75" />
    </g>
  );
}

function Layers() {
  return (
    <svg viewBox="0 0 100 110">
      <Slab y={56} top="#7dd3fc" side="#0369a1" className="stat-layer" />
      <Slab y={36} top="#bae6fd" side="#0284c7" className="stat-layer" />
      <Slab y={16} top="#f0f9ff" side="#0ea5e9" className="stat-layer" />
      <circle cx="50" cy="32" r="5" fill="#0ea5e9" />
    </svg>
  );
}

function Coins({ id }: { id: string }) {
  const coin = (y: number) => (
    <g key={y}>
      <ellipse cx="48" cy={y + 8} rx="30" ry="11" fill="#b45309" />
      <rect x="18" y={y} width="60" height="8" fill="#d97706" />
      <ellipse cx="48" cy={y} rx="30" ry="11" fill="#fcd34d" />
    </g>
  );
  return (
    <svg viewBox="0 0 100 110">
      <defs>
        <radialGradient id={`${id}t`} cx=".35" cy=".3">
          <stop offset="0" stopColor="#fff7d6" />
          <stop offset=".5" stopColor="#fbbf24" />
          <stop offset="1" stopColor="#d97706" />
        </radialGradient>
      </defs>
      {[88, 76, 64].map(coin)}
      <g transform="rotate(-12 58 40)">
        <circle cx="58" cy="40" r="26" fill="#b45309" />
        <circle cx="55" cy="37" r="26" fill={`url(#${id}t)`} />
        <circle cx="55" cy="37" r="19" fill="none" stroke="#fde68a" strokeWidth="3" />
        <path
          d="M58 22 L46 40 H55 L51 54 L65 34 H56Z"
          fill="#fff"
          stroke="#f59e0b"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}

/** The 3D rocket on its own, e.g. as the "you are here" marker on a route. */
export function MiniRocket({ active = true }: { active?: boolean }) {
  const id = useId().replace(/:/g, "");
  return <Rocket id={id} active={active} />;
}

/** Interactive 3D object for a stat card: tilts with the pointer, hops on click. */
export function StatObject({
  kind,
  label,
  progress = 0,
  active = false,
}: {
  kind: StatKind;
  label: string;
  progress?: number;
  active?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  const [hop, setHop] = useState(false);
  return (
    <button
      type="button"
      className="stat-obj"
      data-hop={hop || undefined}
      aria-label={label}
      onClick={() => setHop(true)}
      onAnimationEnd={(event) => {
        if (event.animationName === "stat-hop") setHop(false);
      }}
    >
      {kind === "mission" && <Rocket id={id} active={active} />}
      {kind === "tasks" && <CheckCube id={id} progress={progress} />}
      {kind === "team" && <Layers />}
      {kind === "tokens" && <Coins id={id} />}
    </button>
  );
}
