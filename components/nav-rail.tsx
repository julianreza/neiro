"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type { LucideIcon } from "lucide-react";
import { LogOut, Network } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type NavItem = { href: string; label: string; icon: LucideIcon };

type RailProps = {
  items: readonly NavItem[];
  pathname: string;
  onSignOut: () => void;
};

/*
 * The dashboard shell remounts on every route change (it is keyed by
 * pathname), so component state cannot remember where the active tab was.
 * These module values survive the remount and let the tab slide FROM the
 * previous item instead of appearing at the new one.
 */
let lastDesktopIndex: number | null = null;
let lastMobileX: number | null = null;

/** Icon leans a few pixels toward the mouse ("magnetic" hover). */
function magnet(event: ReactPointerEvent<HTMLElement>) {
  if (event.pointerType !== "mouse") return;
  const el = event.currentTarget;
  const box = el.getBoundingClientRect();
  const x = ((event.clientX - box.left) / box.width - 0.5) * 10;
  const y = ((event.clientY - box.top) / box.height - 0.5) * 10;
  el.style.setProperty("--mx", `${x.toFixed(1)}px`);
  el.style.setProperty("--my", `${y.toFixed(1)}px`);
}

function unmagnet(event: ReactPointerEvent<HTMLElement>) {
  event.currentTarget.style.removeProperty("--mx");
  event.currentTarget.style.removeProperty("--my");
}

/**
 * Desktop rail. Three moving parts:
 * - the carved notch slides to the new page and stretches like liquid
 *   in the direction it travels;
 * - a soft pill follows the mouse (or keyboard focus) between items;
 * - icons lean toward the cursor and the arriving icon sends out a ring.
 */
export function DesktopRail({ items, pathname, onSignOut }: RailProps) {
  const activeIndex = items.findIndex((item) => item.href === pathname);
  const [notchIndex, setNotchIndex] = useState(
    () => lastDesktopIndex ?? activeIndex,
  );
  const [hover, setHover] = useState({ index: 0, visible: false });
  const notchRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (activeIndex < 0) return;
    const from = lastDesktopIndex;
    lastDesktopIndex = activeIndex;

    const notch = notchRef.current;
    if (notch && from !== null && from !== activeIndex) {
      notch.dataset.dir = activeIndex > from ? "down" : "up";
      notch.removeAttribute("data-moving");
      void notch.offsetWidth; // restart the stretch animation
      notch.setAttribute("data-moving", "");
    }

    const frame = requestAnimationFrame(() => setNotchIndex(activeIndex));
    return () => cancelAnimationFrame(frame);
  }, [activeIndex]);

  const showHover = hover.visible && hover.index !== activeIndex;

  return (
    <nav aria-label="Main" className="nav-rail flex w-[72px] flex-col">
      <Link
        href="/"
        aria-label="Neiro home"
        className="nav-rail-logo mx-auto mt-5 mb-8 flex size-10 items-center justify-center rounded-xl"
      >
        <Network className="size-5" aria-hidden="true" />
      </Link>

      <ul
        className="nav-rail-list flex flex-1 flex-col gap-4"
        onPointerLeave={() => setHover((h) => ({ ...h, visible: false }))}
      >
        {activeIndex >= 0 && (
          <li
            ref={notchRef}
            aria-hidden="true"
            className="nav-rail-notch"
            style={{ "--rail-index": notchIndex } as CSSProperties}
          />
        )}
        <li
          aria-hidden="true"
          className="nav-rail-hover"
          data-visible={showHover || undefined}
          style={{ "--hover-index": hover.index } as CSSProperties}
        />

        {items.map(({ href, label, icon: Icon }, index) => {
          const active = index === activeIndex;
          return (
            <li
              key={href}
              className="nav-rail-item"
              data-active={active || undefined}
              onPointerEnter={() => setHover({ index, visible: true })}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    href={href}
                    aria-label={label}
                    aria-current={active ? "page" : undefined}
                    className="nav-rail-link"
                    onPointerMove={magnet}
                    onPointerLeave={unmagnet}
                    onFocus={() => setHover({ index, visible: true })}
                    onBlur={() => setHover((h) => ({ ...h, visible: false }))}
                  >
                    <Icon className="size-5" aria-hidden="true" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right">{label}</TooltipContent>
              </Tooltip>
            </li>
          );
        })}
      </ul>

      <div className="nav-rail-item mb-6">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Sign out"
              className="nav-rail-link"
              onPointerMove={magnet}
              onPointerLeave={unmagnet}
              onClick={onSignOut}
            >
              <LogOut className="size-5" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Sign out</TooltipContent>
        </Tooltip>
      </div>
    </nav>
  );
}

/**
 * Mobile bottom bar. Items are spread with flex, so their positions are
 * measured; the page-colored bubble slides from the last item to the new one.
 */
export function MobileRail({ items, pathname, onSignOut }: RailProps) {
  const navRef = useRef<HTMLElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const nav = navRef.current;
    const bubble = bubbleRef.current;
    if (!nav || !bubble) return;

    function place(animate: boolean) {
      if (!nav || !bubble) return;
      const link = nav.querySelector<HTMLElement>('[aria-current="page"]');
      if (!link) {
        bubble.style.opacity = "0";
        return;
      }
      bubble.style.transition = animate ? "" : "none";
      bubble.style.top = `${link.offsetTop}px`;
      bubble.style.transform = `translateX(${link.offsetLeft}px)`;
      bubble.style.opacity = "1";
      lastMobileX = link.offsetLeft;
    }

    const hadPrevious = lastMobileX !== null;
    if (hadPrevious) {
      // Start where the bubble was on the previous page, then slide.
      const link = nav.querySelector<HTMLElement>('[aria-current="page"]');
      bubble.style.transition = "none";
      bubble.style.top = `${link?.offsetTop ?? 0}px`;
      bubble.style.transform = `translateX(${lastMobileX}px)`;
      bubble.style.opacity = "1";
      void bubble.offsetWidth;
    }
    const frame = requestAnimationFrame(() => place(hadPrevious));
    const onResize = () => place(false);
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
    };
  }, [pathname]);

  return (
    <nav
      ref={navRef}
      aria-label="Main"
      className="nav-rail nav-rail-mobile fixed inset-x-4 bottom-4 z-40 flex items-center justify-around px-2 py-2 md:hidden"
    >
      <span ref={bubbleRef} aria-hidden="true" className="nav-rail-mobile-bubble" />
      {items.map(({ href, label, icon: Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-label={label}
            aria-current={active ? "page" : undefined}
            data-active={active || undefined}
            className="nav-rail-mobile-link"
          >
            <Icon className="size-5" aria-hidden="true" />
          </Link>
        );
      })}
      <button
        type="button"
        aria-label="Sign out"
        className="nav-rail-mobile-link"
        onClick={onSignOut}
      >
        <LogOut className="size-5" aria-hidden="true" />
      </button>
    </nav>
  );
}
