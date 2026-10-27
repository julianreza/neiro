import { AppConfigError } from "@/lib/types";

export type NineRouterModel = {
  id: string;
  owned_by: string;
  kind?: string;
  created?: number;
};

export type NineRouterStatus = {
  ok: boolean;
  latencyMs: number;
  modelsCount: number;
  error?: string;
};

export function getNineRouterEndpoint(): { url: string; key?: string } {
  let url = process.env.NINEROUTER_URL?.trim()?.replace(/\/+$/, "") || "";
  if (url.endsWith("/v1")) {
    url = url.slice(0, -3);
  }
  const key = process.env.NINEROUTER_KEY?.trim();

  if (!url) {
    throw new AppConfigError(
      "missing_ninerouter_env",
      "Missing NINEROUTER_URL environment variable.",
    );
  }

  return { url, key: key || undefined };
}

export async function getNineRouterStatus(): Promise<NineRouterStatus> {
  const startTime = Date.now();
  let url: string;
  let key: string | undefined;

  try {
    const ep = getNineRouterEndpoint();
    url = ep.url;
    key = ep.key;
  } catch (err: unknown) {
    if (err instanceof AppConfigError) throw err;
    return {
      ok: false,
      latencyMs: 0,
      modelsCount: 0,
      error: err instanceof Error ? err.message : "Invalid 9Router configuration",
    };
  }

  const headers: Record<string, string> = {};
  if (key) {
    headers["Authorization"] = `Bearer ${key}`;
  }

  try {
    const signal = AbortSignal.timeout(10_000);
    // Try health check
    const healthPromise = fetch(`${url}/api/health`, { headers, signal }).catch(() => null);
    // Fetch models count
    const modelsPromise = fetch(`${url}/v1/models`, { headers, signal }).catch(() => null);

    const [healthRes, modelsRes] = await Promise.all([healthPromise, modelsPromise]);
    const latencyMs = Date.now() - startTime;

    if (!healthRes?.ok && !modelsRes?.ok) {
      const errorMsg =
        modelsRes?.statusText ||
        healthRes?.statusText ||
        "Could not connect to 9Router endpoints (/api/health, /v1/models)";
      return {
        ok: false,
        latencyMs,
        modelsCount: 0,
        error: errorMsg,
      };
    }

    let modelsCount = 0;
    if (modelsRes && modelsRes.ok) {
      const data = (await modelsRes.json().catch(() => ({}))) as Record<string, unknown>;
      if (Array.isArray(data.data)) {
        modelsCount = data.data.length;
      } else if (Array.isArray(data.models)) {
        modelsCount = data.models.length;
      }
    }

    return {
      ok: true,
      latencyMs,
      modelsCount,
    };
  } catch (err: unknown) {
    return {
      ok: false,
      latencyMs: Date.now() - startTime,
      modelsCount: 0,
      error: err instanceof Error ? err.message : "Failed to connect to 9Router",
    };
  }
}

export async function listNineRouterModelsByKind(
  kind?: string,
): Promise<Array<NineRouterModel>> {
  const { url, key } = getNineRouterEndpoint();
  const headers: Record<string, string> = {};
  if (key) {
    headers["Authorization"] = `Bearer ${key}`;
  }

  const subpath = kind ? `/v1/models/${encodeURIComponent(kind)}` : `/v1/models`;
  const res = await fetch(`${url}${subpath}`, {
    headers,
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`9Router models request failed (${res.status}): ${text}`);
  }

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  let list: unknown[] = [];
  if (Array.isArray(data.data)) {
    list = data.data;
  } else if (Array.isArray(data.models)) {
    list = data.models;
  } else if (Array.isArray(data)) {
    list = data;
  }

  return list.map((item) => {
    if (item && typeof item === "object") {
      const rec = item as Record<string, unknown>;
      return {
        id: typeof rec.id === "string" ? rec.id : String(rec.id ?? ""),
        owned_by: typeof rec.owned_by === "string" ? rec.owned_by : "system",
        kind: typeof rec.kind === "string" ? rec.kind : kind,
        created: typeof rec.created === "number" ? rec.created : undefined,
      };
    }
    return {
      id: String(item ?? ""),
      owned_by: "system",
      kind,
    };
  });
}
