"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Where a surface's data came from. Surfaces must never present sample data
 * as live: `demo` always carries the reason the live source was unavailable.
 */
export type LiveState<T> =
  | { source: "loading" }
  | { source: "error"; reason: string }
  | { source: "live"; data: T; lastUpdated: string; staleReason?: string }
  | { source: "demo"; data: T; reason: string };

/** Human-readable reason for falling back to demo data. */
export async function describeFailure(res: Response): Promise<string> {
  if (res.status === 503) {
    const body = (await res.json().catch(() => null)) as { code?: string } | null;
    if (body?.code === "missing_supabase_env") return "Supabase not configured";
    if (body?.code === "public_service_role_key") return "Supabase misconfigured";
    if (body?.code === "missing_hermes_env") return "Hermes not connected yet";
    if (body?.code) return "Service not configured yet";
  }
  if (res.status === 401) return "Not signed in";
  if (res.status >= 500) return `Live service unavailable (HTTP ${res.status})`;
  return `Request failed (HTTP ${res.status})`;
}

/**
 * Fetch `url` on mount, when `url` changes, and on reload(). On success the
 * parsed payload is shown as live data; on any failure the provided demo data
 * is shown, labelled with the reason. Pass `url = null` to skip fetching
 * (state stays `loading`). A reload keeps showing the previous result until
 * the new one arrives; a different `url` shows `loading` immediately.
 */
export function useLiveData<T>(
  url: string | null,
  demo: T,
  parse: (json: unknown) => T,
): LiveState<T> & { reload: () => void; refresh: () => void; showDemo: () => void } {
  const [result, setResult] = useState<{ url: string | null; state: LiveState<T> }>({
    url: null,
    state: { source: "loading" },
  });
  const [request, setRequest] = useState({ nonce: 0, refresh: false });
  const lastUrl = useRef<string | null>(null);
  const reload = useCallback(() => setRequest((r) => ({ nonce: r.nonce + 1, refresh: false })), []);
  const refresh = useCallback(() => setRequest((r) => ({ nonce: r.nonce + 1, refresh: true })), []);
  const showDemo = useCallback(() => setResult((previous) => previous.url === url && previous.state.source === "error"
    ? { url, state: { source: "demo", data: demo, reason: previous.state.reason } } : previous), [url, demo]);

  useEffect(() => {
    if (url === null) { lastUrl.current = null; return; }
    const explicitRefresh = request.refresh && lastUrl.current === url;
    lastUrl.current = url;
    let cancelled = false;
    const settle = (state: LiveState<T>) => {
      if (!cancelled) setResult({ url, state });
    };
    const fail = (reason: string) => {
      if (cancelled) return;
      setResult((previous) => previous.url === url && previous.state.source === "live"
        ? { url, state: { ...previous.state, staleReason: reason } }
        : { url, state: previous.url === url && previous.state.source === "demo" ? previous.state : { source: "error", reason } });
    };
    (async () => {
      try {
        const requestUrl = explicitRefresh ? `${url}${url.includes("?") ? "&" : "?"}refresh=1` : url;
        const res = await fetch(requestUrl, { cache: "no-store" });
        if (!res.ok) {
          fail(await describeFailure(res));
          return;
        }
        let data: T;
        try {
          data = parse(await res.json());
        } catch {
          fail("Unexpected API response");
          return;
        }
        settle({ source: "live", data, lastUpdated: new Date().toISOString() });
      } catch {
        fail("Network error");
      }
    })();
    return () => {
      cancelled = true;
    };
    // `demo` and `parse` are expected to be stable module-level values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, request]);

  const state: LiveState<T> =
    url !== null && result.url === url ? result.state : { source: "loading" };
  return { ...state, reload, refresh, showDemo };
}
