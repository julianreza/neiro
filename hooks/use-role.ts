"use client";

import { useSyncExternalStore } from "react";

export type ViewerRole = "admin" | "viewer" | null;

let role: ViewerRole = null;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded) return;
  loaded = true;
  fetch("/api/auth", { cache: "no-store" })
    .then((res) => (res.ok ? res.json() : null))
    .then((data: { role?: unknown } | null) => {
      role = data?.role === "admin" || data?.role === "viewer" ? data.role : null;
      listeners.forEach((l) => l());
    })
    .catch(() => {
      loaded = false; // retry on the next mount
    });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  load();
  return () => listeners.delete(listener);
}

/**
 * The signed-in role, read once per page load. `null` while loading or when
 * unknown; callers treat null like admin for layout and let the server's
 * 403 be the real guard.
 */
export function useRole(): ViewerRole {
  return useSyncExternalStore(subscribe, () => role, () => null);
}
