"use client";

import { useEffect } from "react";

const SELECTOR = ".card-trendy";

/**
 * One delegated pointer listener that tells every `.card-trendy` where the
 * cursor is, for the flat spotlight border. It only writes CSS variables
 * (--mx, --my); there is no tilt. All visuals live in globals.css.
 * Skipped for touch / coarse pointers and when reduced motion is requested.
 */
export function TiltEffect() {
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const fine = window.matchMedia("(pointer: fine)");
    if (reduced.matches || !fine.matches) return;

    let frame = 0;

    function onMove(event: PointerEvent) {
      const target = event.target instanceof Element ? event.target : null;
      const card = target?.closest<HTMLElement>(SELECTOR) ?? null;
      if (!card) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = card.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width;
        const y = (event.clientY - rect.top) / rect.height;
        card.style.setProperty("--mx", `${(x * 100).toFixed(1)}%`);
        card.style.setProperty("--my", `${(y * 100).toFixed(1)}%`);
      });
    }

    document.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointermove", onMove);
    };
  }, []);

  return null;
}
