"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { Pause, Play, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { botLook, botRoles } from "@/components/agent-bot";

export type OfficeAgent = {
  id: string;
  name: string;
  role: string;
  stage: string;
  enabled: boolean;
  activeRun: boolean;
};

export type OfficeStatus = "work" | "on" | "off";

/** Something we can hand focus back to after a dialog closes. */
export type Focusable = Element & HTMLOrSVGElement;

export const officeStatus = {
  work: { label: "Working", color: "#facc15" },
  on: { label: "Online", color: "#22c55e" },
  off: { label: "Paused", color: "#94a3b8" },
} as const;

export function statusOf(agent: OfficeAgent): OfficeStatus {
  return !agent.enabled ? "off" : agent.activeRun ? "work" : "on";
}

const STAGE_COLOR: Record<string, string> = {
  orchestrator: "#14b8a6",
  spec: "#8b5cf6",
  workers: "#f97316",
  qa: "#3b82f6",
  reviewer: "#e11d48",
  scheduled: "#f59e0b",
  ask: "#06b6d4",
};

/* Isometric world. One unit is one desk-width; K is pixels per unit. */
const K = 21;
const CO = Math.cos(Math.PI / 6);
const DESK_Y = 0.3;
const ROW = 1.6;
const COL = 1.4;
const PER_ROW = 3;
const CORRIDOR = 2;
const WALL = 1.5;
const BACK_WALL = 2.4;

type Pt = [number, number];
const f = (n: number) => n.toFixed(1);
const P = (x: number, y: number, z = 0): Pt => [
  (x - y) * CO * K,
  (x + y) * 0.5 * K - z * K,
];
const pts = (list: Pt[]) => list.map((p) => `${f(p[0])},${f(p[1])}`).join(" ");

const STAR = Array.from({ length: 20 }, (_, i) => {
  const r = i % 2 ? 2.1 : 3.4;
  const t = (i / 20) * Math.PI * 2;
  return `${(Math.cos(t) * r * 1.3).toFixed(2)},${(Math.sin(t) * r).toFixed(2)}`;
}).join(" ");

/** Darken (m < 1) or lighten (m > 1) a #rrggbb colour. */
function shade(hex: string, m: number) {
  const n = Number.parseInt(hex.slice(1), 16);
  return `#${[n >> 16, (n >> 8) & 255, n & 255]
    .map((v) =>
      Math.round(m > 1 ? v + (255 - v) * Math.min(m - 1, 1) : v * m)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

type Faces = { t: string; l: string; r: string };
const FLOOR: Faces = {
  t: "var(--card)",
  l: "color-mix(in srgb, var(--border) 100%, var(--muted-foreground) 25%)",
  r: "var(--border)",
};
const WALLS: Faces = {
  t: "var(--border)",
  l: "color-mix(in srgb, var(--card) 90%, #64748b)",
  r: "color-mix(in srgb, var(--card) 80%, #64748b)",
};

function Box({
  x,
  y,
  z,
  w,
  d,
  h,
  fill,
  top,
}: {
  x: number;
  y: number;
  z: number;
  w: number;
  d: number;
  h: number;
  fill: string | Faces;
  top?: string;
}) {
  const solid = typeof fill === "string";
  return (
    <g>
      <polygon
        points={pts([P(x + w, y, z), P(x + w, y + d, z), P(x + w, y + d, z + h), P(x + w, y, z + h)])}
        style={{ fill: solid ? shade(fill, 0.62) : fill.r }}
      />
      <polygon
        points={pts([P(x, y + d, z), P(x + w, y + d, z), P(x + w, y + d, z + h), P(x, y + d, z + h)])}
        style={{ fill: solid ? shade(fill, 0.88) : fill.l }}
      />
      <polygon
        points={pts([P(x, y, z + h), P(x + w, y, z + h), P(x + w, y + d, z + h), P(x, y + d, z + h)])}
        style={{ fill: solid ? (top ?? fill) : fill.t }}
      />
    </g>
  );
}

/** Draw children on a flat plane: "y" = a wall facing the viewer, "z" = the floor. */
function Plane({
  axis,
  x,
  y,
  z,
  children,
}: {
  axis: "y" | "z";
  x: number;
  y: number;
  z: number;
  children: ReactNode;
}) {
  const p = P(x, y, z);
  const c = CO * K;
  const h = 0.5 * K;
  const m = axis === "y" ? [c, h, 0, K] : [c, h, -c, h];
  return (
    <g transform={`matrix(${m.map((v) => v.toFixed(3)).join(",")},${f(p[0])},${f(p[1])})`}>
      {children}
    </g>
  );
}

function Rug({ x, y, w, d, color, opacity }: { x: number; y: number; w: number; d: number; color: string; opacity: number }) {
  return (
    <polygon
      points={pts([P(x, y), P(x + w, y), P(x + w, y + d), P(x, y + d)])}
      style={{ fill: color, opacity }}
    />
  );
}

function Defs({ uid }: { uid: string }) {
  return (
    <defs>
      <radialGradient id={`${uid}-vz`} cx=".3" cy=".25" r=".8">
        <stop offset="0" stopColor="#3b4258" />
        <stop offset=".7" stopColor="#090b14" />
      </radialGradient>
      <radialGradient id={`${uid}-ht`} cx=".3" cy=".25" r=".85">
        <stop offset=".08" stopColor="#fef9c3" />
        <stop offset=".35" stopColor="#facc15" />
        <stop offset="1" stopColor="#ca8a04" />
      </radialGradient>
      <linearGradient id={`${uid}-sd`} x1=".15" y1="0" x2=".85" y2="1">
        <stop offset=".45" stopColor="#000" stopOpacity="0" />
        <stop offset="1" stopColor="#000" stopOpacity=".3" />
      </linearGradient>
      <clipPath id={`${uid}-vc`}>
        <rect x="1.375" y="2.25" width="4.25" height="2.25" rx="1.125" />
      </clipPath>
      {botRoles.map((role) => {
        const { c1, c2, c3, glow } = botLook(role);
        return (
          <g key={role}>
            <radialGradient id={`${uid}-h-${role}`} cx=".28" cy=".22" r=".9">
              <stop offset=".07" stopColor="#fff" />
              <stop offset=".32" stopColor={c1} />
              <stop offset=".7" stopColor={c2} />
              <stop offset="1" stopColor={c3} />
            </radialGradient>
            <radialGradient id={`${uid}-b-${role}`} cx=".3" cy=".2" r=".95">
              <stop offset=".06" stopColor="#fff" />
              <stop offset=".35" stopColor={c1} />
              <stop offset="1" stopColor={c3} />
            </radialGradient>
            <radialGradient id={`${uid}-a-${role}`} cx=".35" cy=".3" r=".75">
              <stop offset=".12" stopColor="#fff" />
              <stop offset=".4" stopColor={glow} />
              <stop offset="1" stopColor={c2} />
            </radialGradient>
          </g>
        );
      })}
    </defs>
  );
}

/** The same robot as the agent cards, drawn in SVG. 7 x 8 units, base at (3.5, 7.95). */
function Rig({ role, status, boss, uid }: { role: string; status: OfficeStatus; boss: boolean; uid: string }) {
  const { key, c1, c3, glow, accessory } = botLook(role);
  const off = status === "off";
  const url = (part: string) => `url(#${uid}-${part}-${key})`;
  return (
    <>
      {boss && !off && (
        <g className="office-whip">
          <path d="M5,6.4L6.7,5.5" stroke={c3} strokeWidth=".6" strokeLinecap="round" />
          <g transform="translate(6.7,5.5)">
            <g className="office-lash">
              <line x2="1.3" y2="-.4" stroke="#78350f" strokeWidth=".6" strokeLinecap="round" />
              <path d="M1.2,-.4C4,-3 8,-3.6 12.5,-1.2" fill="none" stroke="#451a03" strokeWidth=".32" strokeLinecap="round" />
            </g>
          </g>
          <g transform="translate(15,2.6)">
            <g className="office-crack">
              <polygon points={STAR} fill="#facc15" stroke="#f97316" strokeWidth=".2" />
              <g className="office-face">
                <text y=".75" textAnchor="middle" fontSize="2" fontWeight="900" fill="#7c2d12">
                  CTAR!
                </text>
              </g>
            </g>
          </g>
        </g>
      )}
      {accessory !== "hat" && (
        <>
          <rect x="3.3" y="0" width=".38" height="1.2" rx=".19" fill={c3} />
          {!off && <circle className="office-antenna" cx="3.49" cy="-.06" r="1.05" fill={glow} opacity=".4" />}
          <circle cx="3.49" cy="-.06" r=".56" fill={url("a")} />
        </>
      )}
      <g className="office-head">
        <rect x=".375" y=".875" width="6.25" height="5" rx="2.6" ry="2.1" fill={url("h")} />
        <rect x=".375" y=".875" width="6.25" height="5" rx="2.6" ry="2.1" fill={`url(#${uid}-sd)`} />
        <rect x="1.375" y="2.25" width="4.25" height="2.25" rx="1.125" fill={`url(#${uid}-vz)`} />
        <g clipPath={`url(#${uid}-vc)`}>
          {off ? (
            <>
              <rect x="2.33" y="3.48" width=".7" height=".16" rx=".08" fill="#94a3b8" />
              <rect x="3.97" y="3.48" width=".7" height=".16" rx=".08" fill="#94a3b8" />
            </>
          ) : (
            <g className="office-gaze">
              <g className="office-eyes">
                <ellipse cx="2.675" cy="3.39" rx=".7" ry=".8" fill={glow} opacity=".28" />
                <ellipse cx="4.325" cy="3.39" rx=".7" ry=".8" fill={glow} opacity=".28" />
                <ellipse className="office-eye" cx="2.675" cy="3.39" rx=".35" ry=".44" fill={glow} />
                <ellipse className="office-eye" cx="4.325" cy="3.39" rx=".35" ry=".44" fill={glow} />
              </g>
            </g>
          )}
        </g>
        {accessory === "hat" && (
          <>
            <path d="M.625,2.95V2.6A2.875,2.05 0 0 1 6.375,2.6V2.95Z" fill={`url(#${uid}-ht)`} />
            <rect x=".125" y="2.575" width="6.75" height=".625" rx=".31" fill="#eab308" />
          </>
        )}
      </g>
      <rect x="1.75" y="5.625" width="3.5" height="2.25" rx="1.1" fill={url("b")} />
      <rect x="1.75" y="5.625" width="3.5" height="2.25" rx="1.1" fill={`url(#${uid}-sd)`} />
      {!off && <circle cx="3.49" cy="6.69" r=".85" fill={glow} opacity=".35" />}
      <circle className="office-core" cx="3.49" cy="6.69" r=".44" fill={off ? "#64748b" : glow} />
      {accessory === "clip" && (
        <g transform="rotate(-14 0 5.75)">
          <rect x="-1.1" y="4.375" width="2.125" height="2.75" rx=".375" fill="#fff" stroke="#0002" strokeWidth=".08" />
          <rect x="-.475" y="4.08" width=".875" height=".5" rx=".2" fill={c3} />
          <rect x="-.725" y="5.13" width="1.375" height=".19" fill={c1} />
          <rect x="-.725" y="5.63" width="1.375" height=".19" fill={c1} />
        </g>
      )}
      {accessory === "check" && (
        <>
          <circle cx="6.75" cy="6.25" r="1" fill="#22c55e" />
          <path d="M6.3,6.25l.38,.38l.58,-.72" fill="none" stroke="#fff" strokeWidth=".26" strokeLinecap="round" />
        </>
      )}
      {accessory === "book" && (
        <g transform="rotate(-12 0 5.5)">
          <rect x="-1.2" y="4.6" width="2.4" height="1.8" rx=".3" fill={c3} />
          <rect x=".75" y="4.85" width=".25" height="1.3" rx=".1" fill="#fff" />
        </g>
      )}
      {accessory === "brush" && (
        <g transform="rotate(28 7.375 5.4)">
          <rect x="7.15" y="3.9" width=".45" height="3" rx=".22" fill="#92400e" />
          <path d="M7,4.1V3.55A.375,.55 0 0 1 7.75,3.55V4.1Z" fill={glow} />
        </g>
      )}
      {accessory === "mag" && (
        <>
          <rect x="7.475" y="5.45" width=".5" height="1.375" rx=".25" fill="#334155" transform="rotate(-45 7.725 6.14)" />
          <circle cx="6.94" cy="4.81" r=".87" fill="#bae6fd" fillOpacity=".45" stroke="#cbd5e1" strokeWidth=".375" />
        </>
      )}
      {accessory === "halo" && (
        <ellipse cx="3.5" cy=".12" rx="1.98" ry=".36" fill="none" stroke="#fde047" strokeWidth=".3" />
      )}
      {status === "work" && !boss && (
        <g className="office-sweat">
          <path style={{ "--sx": "-1.4px" } as CSSProperties} d="M0,1.6c.4,.5 .5,.9 0,1.3c-.5,-.4 -.4,-.8 0,-1.3z" fill="#38bdf8" />
          <path style={{ "--sx": "1.4px", animationDelay: ".4s" } as CSSProperties} d="M7.1,1.2c.4,.5 .5,.9 0,1.3c-.5,-.4 -.4,-.8 0,-1.3z" fill="#38bdf8" />
        </g>
      )}
      {off && (
        <>
          <text className="office-zz" x="6.3" y="1" fontSize="1.6" fontWeight="800">z</text>
          <text className="office-zz office-zz-late" x="7.3" y="0" fontSize="1.1" fontWeight="800">z</text>
        </>
      )}
    </>
  );
}

function Robot({
  agent,
  uid,
  at,
  scale = 1,
  boss = false,
  patrol = false,
  delay = 0,
  selected,
  onSelect,
}: {
  agent: OfficeAgent;
  uid: string;
  at: Pt;
  scale?: number;
  boss?: boolean;
  patrol?: boolean;
  delay?: number;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const status = statusOf(agent);
  const ring = officeStatus[status].color;

  function pick(target: SVGGElement) {
    onSelect(agent.id);
    if (status === "off") return;
    delete target.dataset.hop;
    void target.getBoundingClientRect();
    target.dataset.hop = "";
  }

  const body = (
    <>
      <ellipse className="office-ring" rx="3.4" ry="1.95" fill="none" stroke={ring} strokeWidth=".4" />
      {status === "work" && (
        <ellipse className="office-ripple" rx="3.4" ry="1.95" fill="none" stroke={ring} strokeWidth=".3" />
      )}
      <ellipse className="office-shadow" rx="2.4" ry="1.05" fill="#000" opacity=".2" />
      <g className="office-hover">
        <g className="office-float">
          <g transform="translate(-3.5,-7.95)">
            <Rig role={agent.role} status={status} boss={boss} uid={uid} />
          </g>
        </g>
      </g>
    </>
  );

  return (
    <g
      className="office-bot"
      data-status={status}
      data-boss={boss || undefined}
      data-selected={selected || undefined}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${agent.name}, ${officeStatus[status].label}`}
      transform={`translate(${f(at[0])},${f(at[1])}) scale(${((scale * K) / 5).toFixed(2)})`}
      style={{ "--d": `${delay.toFixed(2)}s` } as CSSProperties}
      onClick={(event: MouseEvent<SVGGElement>) => pick(event.currentTarget)}
      onKeyDown={(event: KeyboardEvent<SVGGElement>) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        pick(event.currentTarget);
      }}
      onAnimationEnd={(event) => {
        if (event.animationName === "office-hop") delete event.currentTarget.dataset.hop;
      }}
    >
      <title>{`${agent.name}: ${officeStatus[status].label}`}</title>
      {patrol ? <g className="office-face">{body}</g> : body}
    </g>
  );
}

function Sparks({ at }: { at: Pt }) {
  return (
    <g className="office-sparks" transform={`translate(${f(at[0])},${f(at[1])})`} aria-hidden="true">
      {[
        [-5, 0],
        [0, 0.4],
        [5, 0.8],
      ].map(([x, delay]) => (
        <rect
          key={x}
          x={x - 1.5}
          y="-1.5"
          width="3"
          height="3"
          rx=".6"
          fill="#facc15"
          style={{ "--sx": `${x}px`, animationDelay: `${delay}s` } as CSSProperties}
        />
      ))}
    </g>
  );
}

function AddPill({ at, label, onAdd }: { at: Pt; label: string; onAdd: (trigger: Focusable) => void }) {
  const w = label.length * 3.3 + 16;
  return (
    <g
      className="office-add"
      role="button"
      tabIndex={0}
      aria-label={label}
      transform={`translate(${f(at[0] - w / 2)},${f(at[1] - 7)})`}
      onClick={(event) => onAdd(event.currentTarget)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onAdd(event.currentTarget);
      }}
    >
      <rect width={w.toFixed(0)} height="14" rx="7" />
      <text x={(w / 2).toFixed(1)} y="9.4" textAnchor="middle">
        {label}
      </text>
    </g>
  );
}

const WHIP_KEY = "neiro.office.whip";
const whipListeners = new Set<() => void>();

function subscribeWhip(listener: () => void) {
  whipListeners.add(listener);
  return () => whipListeners.delete(listener);
}

/** On by default; only an explicit "off" is remembered. */
function readWhip() {
  try {
    return localStorage.getItem(WHIP_KEY) !== "off";
  } catch {
    return true;
  }
}

function writeWhip(on: boolean) {
  try {
    localStorage.setItem(WHIP_KEY, on ? "on" : "off");
  } catch {
    // Storage blocked: the toggle still works for this page view.
  }
  whipListeners.forEach((listener) => listener());
}

export function TeamOffice({
  rooms,
  agents,
  selectedId,
  onSelect,
  onAdd,
}: {
  /** First room is the corridor lead (orchestrator); the rest get glass rooms. */
  rooms: readonly { id: string; name: string }[];
  agents: OfficeAgent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: (stage: string, trigger: Focusable) => void;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9-]/g, "");
  const whip = useSyncExternalStore(subscribeWhip, readWhip, () => true);
  const [paused, setPaused] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const frame = useRef(0);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  /** Eyes follow the pointer. Writes CSS variables, no React render. */
  function look(event: PointerEvent<SVGSVGElement>) {
    if (event.pointerType === "touch" || frame.current) return;
    const { clientX, clientY } = event;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      svgRef.current
        ?.querySelectorAll<SVGGElement>('.office-bot:not([data-status="off"])')
        .forEach((bot) => {
          const r = bot.getBoundingClientRect();
          const clamp = (n: number) => Math.max(-1, Math.min(1, n));
          const dx = clamp((clientX - r.left - r.width / 2) / 150);
          const dy = clamp((clientY - r.top - r.height / 3) / 110);
          bot.style.setProperty("--ex", `${(dx * 0.35).toFixed(3)}px`);
          bot.style.setProperty("--ey", `${(dy * 0.22).toFixed(3)}px`);
        });
    });
  }

  function stopLooking() {
    svgRef.current?.querySelectorAll<SVGGElement>(".office-bot").forEach((bot) => {
      bot.style.removeProperty("--ex");
      bot.style.removeProperty("--ey");
    });
  }

  const [lead, ...glassRooms] = rooms;
  const leads = agents.filter((agent) => agent.stage === lead.id);
  const walkers = leads.filter((agent) => statusOf(agent) !== "off");
  const resting = agents.filter((agent) => statusOf(agent) === "off");
  const working = agents.filter((agent) => statusOf(agent) === "work");
  const counts = {
    work: working.length,
    on: agents.filter((agent) => statusOf(agent) === "on").length,
    off: resting.length,
  };
  const layout = glassRooms.map((room) => {
    const members = agents.filter((agent) => agent.stage === room.id);
    const cols = Math.min(Math.max(members.length, 1), PER_ROW);
    return { ...room, members, w: Math.max(2.4, cols * COL + 0.7) };
  });
  const rows = Math.max(1, ...layout.map((room) => Math.ceil(room.members.length / PER_ROW)));
  const depth = DESK_Y + rows * ROW + 0.7;
  const width = layout.reduce((sum, room) => sum + room.w, 0);
  const total = depth + CORRIDOR;
  const walkY = depth + 1;

  const left = P(0, total)[0] - 24;
  const right = P(width, 0)[0] + 24;
  const topY = P(0, 0, BACK_WALL)[1] - 24;
  const bottom = P(width, total)[1] + 16;

  /** Name tags go on top of everything, so collect them while placing robots. */
  const tags: { agent: OfficeAgent; at: Pt }[] = [];
  const deskBots: Pt[] = [];

  let x0 = 0;
  const roomNodes = layout.map((room, ri) => {
    const start = x0;
    x0 += room.w;
    const color = STAGE_COLOR[room.id] ?? "#64748b";
    const n = room.members.length;
    const seats = room.members.map((agent, i) => {
      const row = Math.floor(i / PER_ROW);
      const inRow = Math.min(PER_ROW, n - row * PER_ROW);
      const col = i % PER_ROW;
      const x = start + room.w / 2 + (col - (inRow - 1) / 2) * COL;
      return { agent, x, deskY: DESK_Y + row * ROW, row };
    });

    return (
      <g key={room.id} data-room={room.id}>
        {ri > 0 && <Box x={start - 0.06} y={0} z={0} w={0.12} d={depth} h={WALL} fill={WALLS} />}
        {Array.from({ length: rows }, (_, row) =>
          seats
            .filter((seat) => seat.row === row)
            .map(({ agent, x, deskY }, i) => {
              const status = statusOf(agent);
              const at = P(x, deskY + 1.25);
              if (status !== "off") {
                tags.push({ agent, at });
                if (status === "work") deskBots.push(at);
              }
              return (
                <g key={agent.id}>
                  <Box x={x - 0.45} y={deskY} z={0} w={0.9} d={0.55} h={0.6} fill="#475569" top="#64748b" />
                  <Plane axis="z" x={x - 0.35} y={deskY + 0.12} z={0.61}>
                    <rect
                      className="office-screen"
                      data-status={status}
                      width=".7"
                      height=".3"
                      rx=".04"
                      fill={status === "off" ? "#334155" : botLook(agent.role).from}
                    />
                  </Plane>
                  {status === "work" && <Sparks at={P(x, deskY + 0.3, 1)} />}
                  {status !== "off" && (
                    <Robot
                      agent={agent}
                      uid={uid}
                      at={at}
                      delay={-(ri * 3 + i) * 0.37}
                      selected={agent.id === selectedId}
                      onSelect={onSelect}
                    />
                  )}
                </g>
              );
            }),
        )}
        {n === 0 && (
          <AddPill
            at={P(start + room.w / 2, depth / 2)}
            label={`Add to ${room.name}`}
            onAdd={(trigger) => onAdd(room.id, trigger)}
          />
        )}
        <Plane axis="y" x={start + 0.08} y={depth} z={WALL}>
          <rect width={room.w - 0.16} height={WALL} fill="#bae6fd" fillOpacity=".16" stroke="#94a3b8" strokeWidth=".04" />
          <rect x={room.w - 0.75} y=".38" width=".5" height={WALL - 0.38} fill="#0f172a" fillOpacity=".08" stroke="#94a3b8" strokeWidth=".03" />
          <rect x=".12" y=".07" width={(room.name.length * 0.115 + 0.3).toFixed(2)} height=".24" rx=".06" fill={color} />
          <text className="office-room-name" x=".27" y=".24" fontSize=".16">
            {room.name}
          </text>
        </Plane>
      </g>
    );
  });

  // Lounge: paused agents rest on the sofa in the corridor.
  const sofaLen = Math.max(2.2, resting.length * 1.1 + 0.5);
  const sofaX = Math.max(3, width - 1.3 - sofaLen);
  const sofaY = depth + 0.15;
  const sofaSeats = resting.map((agent, i) => ({ agent, at: P(sofaX + 0.6 + i * 1.1, sofaY + 0.42, 0.35) }));
  sofaSeats.forEach((seat) => tags.push(seat));

  const sweep = width - 2.6;
  const taskFrom = P(width / 2, walkY, 1.8);
  const hourRef = useRef<SVGGElement>(null);
  const minuteRef = useRef<SVGGElement>(null);

  // The wall clock shows the real time; CSS keeps the hands turning.
  useEffect(() => {
    const now = new Date();
    const minutes = now.getMinutes() + now.getSeconds() / 60;
    hourRef.current?.setAttribute("transform", `rotate(${(((now.getHours() % 12) + minutes / 60) * 30).toFixed(1)})`);
    minuteRef.current?.setAttribute("transform", `rotate(${(minutes * 6).toFixed(1)})`);
  }, [whip]);

  return (
    <section className="office" aria-label="Virtual office" data-whip={whip || undefined} data-paused={paused || undefined}>
      <svg
        key={whip ? "whip" : "calm"}
        ref={svgRef}
        className="office-scene"
        viewBox={`${f(left)} ${f(topY)} ${f(right - left)} ${f(bottom - topY)}`}
        role="group"
        aria-label="AI team office. Each glass room is a stage; the orchestrator walks the corridor."
        onPointerMove={look}
        onPointerLeave={stopLooking}
      >
        <Defs uid={uid} />
        <Box x={0} y={0} z={-0.3} w={width} d={total} h={0.3} fill={FLOOR} />
        <Box x={-0.2} y={-0.2} z={0} w={width + 0.2} d={0.2} h={BACK_WALL} fill={WALLS} />
        <Box x={-0.2} y={0} z={0} w={0.2} d={total} h={BACK_WALL} fill={WALLS} />

        <Plane axis="y" x={0.5} y={0.01} z={2.15}>
          <g aria-hidden="true">
            <circle cx=".45" cy=".45" r=".4" style={{ fill: "var(--card)" }} stroke="#94a3b8" strokeWidth=".06" />
            <g transform="translate(.45,.45)">
              <g ref={hourRef}>
                <line className="office-hand office-hand-hour" y2="-.2" stroke="#334155" strokeWidth=".08" strokeLinecap="round" />
              </g>
              <g ref={minuteRef}>
                <line className="office-hand office-hand-minute" y2="-.3" stroke="#334155" strokeWidth=".05" strokeLinecap="round" />
              </g>
              <circle r=".04" fill="#334155" />
            </g>
          </g>
        </Plane>
        <WallScreen x={2.8} rooms={glassRooms} agents={agents} counts={counts} />
        {[6, 4.1, 2.2].map((back, i) => (
          <Plane key={back} axis="y" x={width - back} y={0.01} z={2.15}>
            <g aria-hidden="true">
              <rect width="1.5" height=".85" rx=".06" fill="#bae6fd" />
              <g className="office-cloud" style={{ animationDelay: `${-i * 3}s` }}>
                <ellipse cx=".5" cy=".35" rx=".3" ry=".1" fill="#fff" />
                <ellipse cx=".7" cy=".3" rx=".2" ry=".12" fill="#fff" />
              </g>
              <rect width="1.5" height=".85" rx=".06" fill="none" stroke="#94a3b8" strokeWidth=".06" />
              <line x1=".75" x2=".75" y2=".85" stroke="#94a3b8" strokeWidth=".05" />
            </g>
          </Plane>
        ))}

        <Rug x={0} y={depth + 0.15} w={width} d={CORRIDOR - 0.3} color={STAGE_COLOR.orchestrator} opacity={0.08} />
        {(() => {
          let x = 0;
          return layout.map((room) => {
            const node = (
              <Rug key={room.id} x={x + 0.05} y={0} w={room.w - 0.1} d={depth} color={STAGE_COLOR[room.id] ?? "#64748b"} opacity={0.14} />
            );
            x += room.w;
            return node;
          });
        })()}
        {roomNodes}

        <g aria-hidden="true">
          <Box x={sofaX - 2.1} y={depth + 0.2} z={0} w={0.4} d={0.4} h={0.9} fill="#e2e8f0" top="#f8fafc" />
          <Box x={sofaX - 2.02} y={depth + 0.28} z={0.9} w={0.24} d={0.24} h={0.35} fill="#7dd3fc" top="#bae6fd" />
          <Box x={sofaX - 1.1} y={depth + 0.18} z={0} w={0.6} d={0.45} h={0.85} fill="#334155" top="#475569" />
          <Steam at={P(sofaX - 0.8, depth + 0.4, 0.9)} />
          <Box x={sofaX} y={sofaY} z={0} w={sofaLen} d={0.6} h={0.35} fill="#0f766e" top="#14b8a6" />
          <Box x={sofaX} y={sofaY} z={0.35} w={sofaLen} d={0.18} h={0.5} fill="#0f766e" top="#2dd4bf" />
        </g>
        {sofaSeats.map(({ agent, at }, i) => (
          <Robot
            key={agent.id}
            agent={agent}
            uid={uid}
            at={at}
            delay={-i * 0.5}
            selected={agent.id === selectedId}
            onSelect={onSelect}
          />
        ))}

        {leads.length === 0 ? (
          <AddPill at={P(width / 2, walkY)} label={`Add ${lead.name.toLowerCase()}`} onAdd={(trigger) => onAdd(lead.id, trigger)} />
        ) : (
          walkers.map((agent, i) => {
            const at = P(1, walkY + (i % 2) * 0.5);
            return (
              <g
                key={agent.id}
                className="office-patrol"
                style={
                  {
                    "--px": `${f(sweep * CO * K)}px`,
                    "--py": `${f(sweep * 0.5 * K)}px`,
                    animationDelay: `${-i * 4}s`,
                  } as CSSProperties
                }
              >
                <Robot
                  agent={agent}
                  uid={uid}
                  at={at}
                  scale={1.1}
                  boss
                  patrol
                  selected={agent.id === selectedId}
                  onSelect={onSelect}
                />
                <NameTag agent={agent} at={at} lift={4} />
              </g>
            );
          })
        )}
        <Plant at={P(width - 0.5, total - 0.5)} />

        {walkers.length > 0 &&
          deskBots.map((to, i) => (
            <rect
              key={i}
              className="office-fly"
              x={f(taskFrom[0] - 3)}
              y={f(taskFrom[1] - 2)}
              width="6"
              height="4"
              rx=".6"
              fill="#fef9c3"
              stroke="#ca8a04"
              strokeWidth=".6"
              aria-hidden="true"
              style={
                {
                  "--dx": `${f(to[0] - taskFrom[0])}px`,
                  "--dy": `${f(to[1] - 36 - taskFrom[1])}px`,
                  animationDelay: `${i * 0.8}s`,
                } as CSSProperties
              }
            />
          ))}
        {tags.map(({ agent, at }) => (
          <NameTag key={agent.id} agent={agent} at={at} />
        ))}
      </svg>

      <div className="office-stats office-stats-left" aria-hidden="true">
        <div>
          <b>{counts.work}</b>
          <span>on a run</span>
        </div>
        <div>
          <b>
            {counts.on} <span>online</span> · {counts.off} <span>paused</span>
          </b>
        </div>
      </div>
      <div className="office-stats office-stats-right">
        <div>
          <p className="font-semibold">Working now</p>
          {working.length === 0 ? (
            <p className="text-muted-foreground">Nobody is on a run.</p>
          ) : (
            <ul>
              {working.slice(0, 4).map((agent) => (
                <li key={agent.id}>
                  <i style={{ background: STAGE_COLOR[agent.stage] ?? "#64748b" }} aria-hidden="true" />
                  {agent.name}
                </li>
              ))}
              {working.length > 4 && <li className="text-muted-foreground">+{working.length - 4} more</li>}
            </ul>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
        <ul className="flex flex-wrap gap-4 text-xs text-muted-foreground" aria-label="Status legend">
          {(Object.keys(officeStatus) as OfficeStatus[]).map((status) => (
            <li key={status} className="flex items-center gap-1.5">
              <i className="size-2 rounded-full" style={{ background: officeStatus[status].color }} aria-hidden="true" />
              {officeStatus[status].label}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="min-h-10" aria-pressed={whip} onClick={() => writeWhip(!whip)}>
            <Zap />
            Whip mode: {whip ? "on" : "off"}
          </Button>
          <Button variant="outline" className="min-h-10" aria-pressed={paused} onClick={() => setPaused(!paused)}>
            {paused ? <Play /> : <Pause />}
            {paused ? "Resume motion" : "Pause motion"}
          </Button>
        </div>
      </div>
    </section>
  );
}

/** Name above a robot. Working robots get a yellow tag with typing dots. */
function NameTag({ agent, at, lift = 0 }: { agent: OfficeAgent; at: Pt; lift?: number }) {
  const status = statusOf(agent);
  const name = agent.name.length > 14 ? `${agent.name.slice(0, 13)}…` : agent.name;
  const w = name.length * 3.1 + (status === "work" ? 22 : 15);
  return (
    <g
      className="office-tag"
      data-status={status}
      transform={`translate(${f(at[0] - w / 2)},${f(at[1] - 47 - lift)})`}
      aria-hidden="true"
    >
      <rect width={w.toFixed(1)} height="11" rx="5.5" />
      <circle cx="6" cy="5.5" r="2" fill={officeStatus[status].color} />
      <text x="10.5" y="7.6">
        {name}
      </text>
      {status === "work" && (
        <g className="office-typing">
          {[0, 1, 2].map((i) => (
            <circle key={i} cx={f(w - 10 + i * 2.6)} cy="5.5" r=".8" style={{ animationDelay: `${i * 0.2}s` }} />
          ))}
        </g>
      )}
    </g>
  );
}

/** Back-wall screen: who is on a run, and which stages are busy. */
function WallScreen({
  x,
  rooms,
  agents,
  counts,
}: {
  x: number;
  rooms: readonly { id: string; name: string }[];
  agents: OfficeAgent[];
  counts: Record<OfficeStatus, number>;
}) {
  const awake = counts.work + counts.on;
  const share = awake ? counts.work / awake : 0;
  const gap = 2.9 / Math.max(rooms.length - 1, 1);
  return (
    <Plane axis="y" x={x} y={0.01} z={2.25}>
      <g aria-hidden="true">
        <rect x="-.06" y="-.06" width="3.72" height="1.12" rx=".08" fill="#1e293b" />
        <rect width="3.6" height="1" rx=".05" fill="#0b1222" />
        <text x=".18" y=".24" fontSize=".16" fontWeight="700" fill="#e2e8f0">
          Team right now
        </text>
        <text x="3.42" y=".24" fontSize=".12" fill="#94a3b8" textAnchor="end">
          {counts.work} on a run
        </text>
        <rect x=".18" y=".36" width="3.24" height=".08" rx=".04" fill="#334155" />
        <rect className="office-meter" x=".18" y=".36" width={(3.24 * share).toFixed(2)} height=".08" rx=".04" fill="#2dd4bf" />
        <line x1=".35" y1=".68" x2={(0.35 + gap * (rooms.length - 1)).toFixed(2)} y2=".68" stroke="#334155" strokeWidth=".03" />
        {rooms.map((room, i) => {
          const busy = agents.some((agent) => agent.stage === room.id && statusOf(agent) === "work");
          const color = STAGE_COLOR[room.id] ?? "#64748b";
          const cx = (0.35 + i * gap).toFixed(2);
          return (
            <g key={room.id}>
              {busy && <circle className="office-busy" cx={cx} cy=".68" r=".13" fill="none" stroke={color} strokeWidth=".03" />}
              <circle cx={cx} cy=".68" r=".09" fill={busy ? color : "#0b1222"} stroke={color} strokeWidth=".03" />
              <text x={cx} y=".9" fontSize=".1" fill="#cbd5e1" textAnchor="middle">
                {room.name}
              </text>
            </g>
          );
        })}
      </g>
    </Plane>
  );
}

function Steam({ at }: { at: Pt }) {
  return (
    <g transform={`translate(${f(at[0])},${f(at[1])})`}>
      {[0, 0.7].map((delay, i) => (
        <path
          key={delay}
          className="office-steam"
          style={{ animationDelay: `${delay}s` }}
          d={`M${i * 3 - 1.5},0c-3,-4 3,-6 0,-10`}
          fill="none"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      ))}
    </g>
  );
}

function Plant({ at }: { at: Pt }) {
  return (
    <g transform={`translate(${f(at[0])},${f(at[1])})`} aria-hidden="true">
      <ellipse rx="7" ry="3.5" fill="#000" opacity=".15" />
      <path d="M-6,0L-5,-9H5L6,0Z" fill="#b45309" />
      <g className="office-sway">
        <ellipse cx="-5" cy="-20" rx="4" ry="11" fill="#16a34a" transform="rotate(-25 -5 -20)" />
        <ellipse cx="5" cy="-21" rx="4" ry="12" fill="#22c55e" transform="rotate(22 5 -21)" />
        <ellipse cy="-25" rx="3.6" ry="13" fill="#15803d" />
      </g>
    </g>
  );
}
