"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Where a surface's data came from. Surfaces must never present sample data
 * as live: `demo` always carries the reason the live source was unavailable.
 */
export type LiveState<T> =
  | { source: "loading" }
  | { source: "live"; data: T }
  | { source: "demo"; data: T; reason: string };

/** Human-readable reason for falling back to demo data. */
export async function describeFailure(res: Response): Promise<string> {
  if (res.status === 503) {
    const body = (await res.json().catch(() => null)) as { code?: string } | null;
    if (body?.code === "missing_supabase_env") return "Supabase not configured";
    if (body?.code === "public_service_role_key") return "Supabase misconfigured";
    if (body?.code) return `Service not configured (${body.code})`;
  }
  if (res.status === 401) return "Not signed in";
  return `API error ${res.status}`;
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
): LiveState<T> & { reload: () => void } {
  const [result, setResult] = useState<{ url: string | null; state: LiveState<T> }>({
    url: null,
    state: { source: "loading" },
  });
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (url === null) return;
    let cancelled = false;
    const settle = (state: LiveState<T>) => {
      if (!cancelled) setResult({ url, state });
    };
    (async () => {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) {
          settle({ source: "demo", data: demo, reason: await describeFailure(res) });
          return;
        }
        let data: T;
        try {
          data = parse(await res.json());
        } catch {
          settle({ source: "demo", data: demo, reason: "Unexpected API response" });
          return;
        }
        settle({ source: "live", data });
      } catch {
        settle({ source: "demo", data: demo, reason: "Network error" });
      }
    })();
    return () => {
      cancelled = true;
    };
    // `demo` and `parse` are expected to be stable module-level values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, nonce]);

  const state: LiveState<T> =
    url !== null && result.url === url ? result.state : { source: "loading" };
  return { ...state, reload };
}
