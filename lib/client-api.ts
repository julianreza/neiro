/** fetch + JSON with one error shape. `error` is a sentence for a toast. */
export async function sendJson<T = Record<string, unknown>>(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown
): Promise<{ ok: true; data: T } | { ok: false; error: string; status: number }> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: typeof data.error === "string" ? data.error : `Request failed (${res.status})`,
      };
    }
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, status: 0, error: "Couldn't reach Neiro. Check your connection and try again." };
  }
}

export function formatTokens(n: number): string {
  return n.toLocaleString("en-US");
}

/** "2 min ago", "3 h ago", "26 Oct". */
export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  if (s < 2 * 86_400) return "yesterday";
  return new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
