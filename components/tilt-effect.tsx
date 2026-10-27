"use client";

import { useEffect } from "react";

const SELECTOR = ".card-trendy";
const MAX_TILT_DEG = 5;

/**
 * One delegated pointer listener that gives every `.card-trendy` a subtle
 * 3D tilt and a light spot that follows the cursor. It only writes CSS
 * variables (--rx, --ry, --mx, --my); all visuals live in globals.css.
 * Skipped for touch / coarse pointers and when reduced motion is requested.
 */
export function TiltEffect() {
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const fine = window.matchMedia("(pointer: fine)");
    if (reduced.matches || !fine.matches) return;

    let active: HTMLElement | null = null;
    let frame = 0;

    function reset(card: HTMLElement) {
      card.style.setProperty("--rx", "0deg");
      card.style.setProperty("--ry", "0deg");
    }

    function onMove(event: PointerEvent) {
      const target = event.target instanceof Element ? event.target : null;
      const card = target?.closest<HTMLElement>(SELECTOR) ?? null;
      if (active && active !== card) reset(active);
      active = card;
      if (!card) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = card.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width;
        const y = (event.clientY - rect.top) / rect.height;
        card.style.setProperty("--ry", `${((x - 0.5) * 2 * MAX_TILT_DEG).toFixed(2)}deg`);
        card.style.setProperty("--rx", `${((0.5 - y) * 2 * MAX_TILT_DEG).toFixed(2)}deg`);
        card.style.setProperty("--mx", `${(x * 100).toFixed(1)}%`);
        card.style.setProperty("--my", `${(y * 100).toFixed(1)}%`);
      });
    }

    function onLeave() {
      if (active) reset(active);
      active = null;
    }

    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return null;
}
