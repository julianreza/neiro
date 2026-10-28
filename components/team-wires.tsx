"use client";

import { useLayoutEffect, useRef, useState } from "react";

export type Wire = { id: string; color: string; live: boolean };

type Geometry = {
  w: number;
  h: number;
  paths: string[];
  drops: { x: number; y1: number; y2: number }[];
};

/**
 * Desktop org-chart wiring for `.team-tree`: one gray path per lane
 * (root -> bus -> lane), with a spark in the lane's agent color running
 * down it while that lane has an enabled agent. Must be the tree's first
 * child so the cards paint above it.
 */
export function TeamWires({ wires }: { wires: Wire[] }) {
  const ref = useRef<SVGSVGElement>(null);
  const [geo, setGeo] = useState<Geometry | null>(null);
  const key = wires.map((wire) => wire.id).join("|");

  useLayoutEffect(() => {
    const tree = ref.current?.parentElement;
    if (!tree) return;
    let frame = 0;

    const measure = () => {
      const box = tree.getBoundingClientRect();
      const root = tree.querySelector(".team-root");
      const trunk = tree.querySelector(".team-trunk");
      if (!root || !trunk) return;
      const r = root.getBoundingClientRect();
      const startX = r.left + r.width / 2 - box.left;
      const startY = r.bottom - box.top;
      const busY = trunk.getBoundingClientRect().bottom - box.top;
      const drops = Array.from(
        tree.querySelectorAll<HTMLElement>(".team-branch"),
      ).map((branch) => {
        const b = branch.getBoundingClientRect();
        const lane = branch.querySelector("section")?.getBoundingClientRect();
        return {
          x: b.left + b.width / 2 - box.left,
          y1: busY,
          y2: (lane?.top ?? b.top) - box.top,
        };
      });
      const paths = drops.map(
        ({ x, y2 }) => `M${startX} ${startY}V${busY}H${x}V${y2}`,
      );
      setGeo({ w: box.width, h: box.height, paths, drops });
    };

    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    schedule();
    const observer = new ResizeObserver(schedule);
    observer.observe(tree);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [key]);

  return (
    <svg
      ref={ref}
      className="team-wires"
      aria-hidden="true"
      width={geo?.w ?? 0}
      height={geo?.h ?? 0}
      viewBox={`0 0 ${geo?.w ?? 0} ${geo?.h ?? 0}`}
    >
      {geo?.paths.map((d, i) => (
        <g key={wires[i]?.id ?? i}>
          <path d={d} className="wire-base" fill="none" />
          {wires[i]?.live && (
            <path
              d={d}
              pathLength={100}
              fill="none"
              className="wire-spark"
              style={{
                stroke: wires[i].color,
                color: wires[i].color,
                animationDelay: `${i * 0.2}s`,
              }}
            />
          )}
        </g>
      ))}
    </svg>
  );
}
