"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
} from "react";
import type { LucideIcon } from "lucide-react";
import { LogOut, MoreHorizontal, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type NavItem = { href: string; label: string; icon: LucideIcon };

/**
 * Where each rail's active tab was on the previous page. The dashboard
 * session remounts on every route change (it is keyed by pathname), so the
 * rails cannot keep this in their own state; the shell owns one of these
 * per shell instance and passes it down, so two shells never share it.
 */
export type RailMemory = {
  desktopIndex: number | null;
  mobileX: number | null;
};

/** Read/write access to a shell's RailMemory (keeps the ref in the shell). */
export type RailMemoryStore = {
  get: <K extends keyof RailMemory>(key: K) => RailMemory[K];
  set: <K extends keyof RailMemory>(key: K, value: RailMemory[K]) => void;
};

type RailProps = {
  items: readonly NavItem[];
  pathname: string;
  memory: RailMemoryStore;
  onSignOut: () => void;
};

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
export function DesktopRail({
  items,
  pathname,
  memory,
  onSignOut,
  expanded,
  onToggle,
}: RailProps & { expanded: boolean; onToggle: () => void }) {
  // Names are on screen when expanded, so tooltips would only repeat them.
  const tipOpen = expanded ? false : undefined;
  const activeIndex = items.findIndex((item) => item.href === pathname);
  const [hover, setHover] = useState({ index: 0, visible: false });
  const notchRef = useRef<HTMLLIElement>(null);

  // Before paint: put the notch back on the previous item without a
  // transition, then move it to the active one so the slide plays.
  useLayoutEffect(() => {
    if (activeIndex < 0) return;
    const from = memory.get("desktopIndex");
    memory.set("desktopIndex", activeIndex);

    const notch = notchRef.current;
    if (!notch || from === null || from === activeIndex) return;
    notch.style.transition = "none";
    notch.style.setProperty("--rail-index", String(from));
    void notch.offsetWidth; // commit the start position
    notch.style.transition = "";
    notch.style.setProperty("--rail-index", String(activeIndex));

    notch.dataset.dir = activeIndex > from ? "down" : "up";
    notch.removeAttribute("data-moving");
    void notch.offsetWidth; // restart the stretch animation
    notch.setAttribute("data-moving", "");
  }, [activeIndex, memory]);

  const showHover = hover.visible && hover.index !== activeIndex;

  return (
    <nav
      aria-label="Main"
      className="nav-rail flex flex-col"
      data-expanded={expanded || undefined}
    >
      <div className="nav-rail-head mt-7 mb-9">
        <Link href="/" aria-label="Neiro home" className="nav-rail-brand">
          <span className="nav-rail-logo nav-rail-neural flex size-10 shrink-0 items-center justify-center rounded-xl">
            <svg className="size-7" viewBox="0 0 34 34" aria-hidden="true">
              <path d="M9 26V8l16 18V8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              <circle className="neural-node" cx="9" cy="26" r="3" />
              <circle className="neural-node" cx="9" cy="8" r="3" />
              <circle className="neural-node" cx="25" cy="26" r="3" />
              <circle className="neural-node" cx="25" cy="8" r="3" />
            </svg>
          </span>
          <span className="nav-rail-label text-base font-semibold" aria-hidden="true">
            Neiro
          </span>
        </Link>
        {/* Expanded: sits at the end of the brand row. Collapsed: covers the logo, shown on hover. */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-expanded={expanded}
              aria-label={expanded ? "Collapse menu" : "Expand menu"}
              className="nav-rail-toggle"
              onClick={onToggle}
            >
              {expanded ? (
                <PanelLeftClose className="size-5" aria-hidden="true" />
              ) : (
                <PanelLeftOpen className="size-5" aria-hidden="true" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{expanded ? "Collapse menu" : "Expand menu"}</TooltipContent>
        </Tooltip>
      </div>

      <ul
        className="nav-rail-list flex flex-1 flex-col gap-4"
        onPointerLeave={() => setHover((h) => ({ ...h, visible: false }))}
      >
        {activeIndex >= 0 && (
          <li
            ref={notchRef}
            aria-hidden="true"
            className="nav-rail-notch"
            style={{ "--rail-index": activeIndex } as CSSProperties}
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
              <Tooltip open={tipOpen}>
                <TooltipTrigger asChild>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className="nav-rail-link"
                    onPointerMove={magnet}
                    onPointerLeave={unmagnet}
                    onFocus={() => setHover({ index, visible: true })}
                    onBlur={() => setHover((h) => ({ ...h, visible: false }))}
                  >
                    <Icon className="size-5 shrink-0" aria-hidden="true" />
                    <span className="nav-rail-label">{label}</span>
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right">{label}</TooltipContent>
              </Tooltip>
            </li>
          );
        })}
      </ul>

      <div className="nav-rail-item mb-6">
        <Tooltip open={tipOpen}>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="nav-rail-link"
              onPointerMove={magnet}
              onPointerLeave={unmagnet}
              onClick={onSignOut}
            >
              <LogOut className="size-5 shrink-0" aria-hidden="true" />
              <span className="nav-rail-label">Sign out</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Sign out</TooltipContent>
        </Tooltip>
      </div>
    </nav>
  );
}

/** Pages shown directly in the phone bar; the rest live under "More". */
const MOBILE_PRIMARY = 4;

/**
 * Mobile bottom bar: the first MOBILE_PRIMARY pages plus "More", each with a
 * short name. "More" opens a bottom sheet with the other pages and Sign out.
 * Items are spread with flex, so their positions are measured; the
 * page-colored bubble slides from the last item to the new one.
 */
export function MobileRail({
  items,
  pathname,
  memory,
  onSignOut,
  badges,
}: RailProps & { badges?: Readonly<Record<string, number>> }) {
  const navRef = useRef<HTMLElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const primary = items.slice(0, MOBILE_PRIMARY);
  const overflow = items.slice(MOBILE_PRIMARY);
  const overflowActive = overflow.some((item) => item.href === pathname);

  useEffect(() => {
    const nav = navRef.current;
    const bubble = bubbleRef.current;
    if (!nav || !bubble) return;
    const activeEl = () => nav.querySelector<HTMLElement>("[data-active]");

    function size(link: HTMLElement) {
      if (!bubble) return;
      bubble.style.width = `${link.offsetWidth}px`;
      bubble.style.height = `${link.offsetHeight}px`;
    }

    function place(animate: boolean) {
      if (!nav || !bubble) return;
      const link = activeEl();
      if (!link) {
        bubble.style.opacity = "0";
        return;
      }
      bubble.style.transition = animate ? "" : "none";
      size(link);
      bubble.style.top = `${link.offsetTop}px`;
      bubble.style.transform = `translateX(${link.offsetLeft}px)`;
      bubble.style.opacity = "1";
      memory.set("mobileX", link.offsetLeft);
    }

    const previousX = memory.get("mobileX");
    const hadPrevious = previousX !== null;
    if (hadPrevious) {
      // Start where the bubble was on the previous page, then slide.
      const link = activeEl();
      bubble.style.transition = "none";
      if (link) size(link);
      bubble.style.top = `${link?.offsetTop ?? 0}px`;
      bubble.style.transform = `translateX(${previousX}px)`;
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
  }, [pathname, memory]);

  const count = (href: string) => {
    const n = badges?.[href] ?? 0;
    return n > 0 ? (
      <span aria-hidden="true" className="nav-rail-mobile-badge">
        {n > 9 ? "9+" : n}
      </span>
    ) : null;
  };

  return (
    <>
      <nav
        ref={navRef}
        aria-label="Main"
        className="nav-rail nav-rail-mobile fixed inset-x-3 bottom-3 z-40 flex items-center justify-around px-1.5 py-1.5 md:hidden"
      >
        <span ref={bubbleRef} aria-hidden="true" className="nav-rail-mobile-bubble" />
        {primary.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          const n = badges?.[href] ?? 0;
          return (
            <Link
              key={href}
              href={href}
              aria-label={n > 0 ? `${label}, ${n} waiting` : undefined}
              aria-current={active ? "page" : undefined}
              data-active={active || undefined}
              className="nav-rail-mobile-link"
            >
              <span className="relative">
                <Icon className="size-5" aria-hidden="true" />
                {count(href)}
              </span>
              <span className="nav-rail-mobile-label">{shortLabel(label)}</span>
            </Link>
          );
        })}
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          data-active={overflowActive || undefined}
          className="nav-rail-mobile-link"
          onClick={() => setMoreOpen(true)}
        >
          <MoreHorizontal className="size-5" aria-hidden="true" />
          <span className="nav-rail-mobile-label">More</span>
        </button>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="rounded-t-3xl pb-[max(1.5rem,env(safe-area-inset-bottom))] md:hidden">
          <SheetHeader className="pb-0">
            <SheetTitle>More</SheetTitle>
          </SheetHeader>
          <ul className="px-2">
            {overflow.map(({ href, label, icon: Icon }) => {
              const active = pathname === href;
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setMoreOpen(false)}
                    className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-base hover:bg-secondary aria-[current=page]:font-medium aria-[current=page]:text-primary"
                  >
                    <Icon className="size-5" aria-hidden="true" />
                    {label}
                    {count(href)}
                  </Link>
                </li>
              );
            })}
            <li className="mt-1 border-t pt-1">
              <button
                type="button"
                onClick={() => {
                  setMoreOpen(false);
                  onSignOut();
                }}
                className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-base hover:bg-secondary"
              >
                <LogOut className="size-5" aria-hidden="true" />
                Sign out
              </button>
            </li>
          </ul>
        </SheetContent>
      </Sheet>
    </>
  );
}

/** One-word names that fit under a phone icon. */
function shortLabel(label: string): string {
  const short: Record<string, string> = { "Mission control": "Missions", "Live log": "Live" };
  return short[label] ?? label;
}
