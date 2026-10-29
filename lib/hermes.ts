import { Agent, AppConfigError } from "@/lib/types";

export type HermesEndpointConfig = {
  baseUrl: string;
  apiKey: string;
  profilePrefix: string;
};

export function resolveAgentEndpoint(
  agent?: Pick<Agent, "profile" | "url" | "key_enc"> | null,
): HermesEndpointConfig {
  const customUrl = agent?.url?.trim();
  const envUrl = process.env.HERMES_DEFAULT_URL?.trim();
  const rawBaseUrl = customUrl || envUrl || "";
  const baseUrl = rawBaseUrl.replace(/\/+$/, "");

  const customKey = agent?.key_enc?.trim();
  const envKey = process.env.HERMES_DEFAULT_KEY?.trim();
  const apiKey = customKey || envKey || "";

  if (!baseUrl || !apiKey) {
    throw new AppConfigError(
      "missing_hermes_env",
      "Missing Hermes configuration. Please set HERMES_DEFAULT_URL and HERMES_DEFAULT_KEY or configure custom agent credentials.",
    );
  }

  const profile = agent?.profile?.trim();
  const profilePrefix =
    profile && profile !== "default" ? `/p/${encodeURIComponent(profile)}` : "";

  return { baseUrl, apiKey, profilePrefix };
}

async function hermesFetch(
  agent: Pick<Agent, "profile" | "url" | "key_enc"> | undefined,
  path: string,
  options: RequestInit = {},
  customSignal?: AbortSignal,
): Promise<Response> {
  const { baseUrl, apiKey, profilePrefix } = resolveAgentEndpoint(agent);
  const url = `${baseUrl}${profilePrefix}${path}`;

  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${apiKey}`);
  if (!headers.has("Content-Type") && options.body && typeof options.body === "string") {
    headers.set("Content-Type", "application/json");
  }

  const signal = customSignal || AbortSignal.timeout(15_000);

  return fetch(url, {
    ...options,
    headers,
    signal,
  });
}

export type HermesProbeResult = {
  ok: boolean;
  latencyMs: number;
  status?: string;
  capabilities?: string[];
  details?: Record<string, unknown>;
  error?: string;
};

export async function probeHermesAgent(agent: Agent): Promise<HermesProbeResult> {
  const startTime = Date.now();
  try {
    const res = await hermesFetch(agent, "/health/detailed");
    const latencyMs = Date.now() - startTime;

    if (!res.ok) {
      const fallbackRes = await hermesFetch(agent, "/health");
      if (!fallbackRes.ok) {
        return {
          ok: false,
          latencyMs,
          error: `Hermes returned status ${res.status}: ${res.statusText}`,
        };
      }
      return { ok: true, latencyMs, status: "healthy" };
    }

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const statusVal = typeof data.status === "string" ? data.status : "healthy";
    const capabilitiesVal = Array.isArray(data.capabilities)
      ? data.capabilities.filter((c): c is string => typeof c === "string")
      : [];

    return {
      ok: true,
      latencyMs,
      status: statusVal,
      capabilities: capabilitiesVal,
      details: data,
    };
  } catch (err: unknown) {
    if (err instanceof AppConfigError) throw err;
    const message = err instanceof Error ? err.message : "Failed to reach Hermes agent";
    return {
      ok: false,
      latencyMs: Date.now() - startTime,
      error: message,
    };
  }
}

export async function listHermesCapabilitiesInventory(
  agent: Agent,
): Promise<string[]> {
  try {
    const [skillsRes, toolsRes] = await Promise.all([
      hermesFetch(agent, "/v1/skills").catch(() => null),
      hermesFetch(agent, "/v1/toolsets").catch(() => null),
    ]);

    const inventory: string[] = [];

    if (skillsRes && skillsRes.ok) {
      const skillsData = (await skillsRes.json().catch(() => null)) as unknown;
      if (Array.isArray(skillsData)) {
        for (const s of skillsData) {
          if (typeof s === "string") {
            inventory.push(s);
          } else if (s && typeof s === "object" && "name" in s) {
            const nameVal = s.name;
            if (typeof nameVal === "string") inventory.push(nameVal);
          }
        }
      } else if (skillsData && typeof skillsData === "object" && "skills" in skillsData) {
        const skillsList = skillsData.skills;
        if (Array.isArray(skillsList)) {
          for (const s of skillsList) {
            if (typeof s === "string") {
              inventory.push(s);
            } else if (s && typeof s === "object" && "name" in s) {
              const nameVal = s.name;
              if (typeof nameVal === "string") inventory.push(nameVal);
            }
          }
        }
      }
    }

    if (toolsRes && toolsRes.ok) {
      const toolsData = (await toolsRes.json().catch(() => null)) as unknown;
      if (Array.isArray(toolsData)) {
        for (const t of toolsData) {
          if (typeof t === "string") {
            inventory.push(t);
          } else if (t && typeof t === "object" && "name" in t) {
            const nameVal = t.name;
            if (typeof nameVal === "string") inventory.push(nameVal);
          }
        }
      } else if (toolsData && typeof toolsData === "object" && "toolsets" in toolsData) {
        const toolsetsList = toolsData.toolsets;
        if (Array.isArray(toolsetsList)) {
          for (const t of toolsetsList) {
            if (typeof t === "string") {
              inventory.push(t);
            } else if (t && typeof t === "object" && "name" in t) {
              const nameVal = t.name;
              if (typeof nameVal === "string") inventory.push(nameVal);
            }
          }
        }
      }
    }

    return Array.from(new Set(inventory));
  } catch (err: unknown) {
    if (err instanceof AppConfigError) throw err;
    return [];
  }
}

export async function createHermesSession(
  agent: Agent,
  title: string,
): Promise<string> {
  const res = await hermesFetch(agent, "/api/sessions", {
    method: "POST",
    body: JSON.stringify({ title }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to create Hermes session (${res.status}): ${text}`);
  }

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const idCandidate = data.id;
  const sessionIdCandidate = data.session_id;

  const sessionId =
    typeof idCandidate === "string"
      ? idCandidate
      : typeof sessionIdCandidate === "string"
        ? sessionIdCandidate
        : null;

  if (!sessionId) {
    throw new Error("No session id returned from Hermes");
  }

  if (title) {
    await hermesFetch(agent, `/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    }).catch(() => null);
  }

  return sessionId;
}

export async function getHermesSessionMessages(
  agent: Agent,
  sessionId: string,
): Promise<Array<{ role: string; content: string }>> {
  const res = await hermesFetch(
    agent,
    `/api/sessions/${encodeURIComponent(sessionId)}/messages?inline_images=false`,
  );

  if (!res.ok) {
    if (res.status === 404) return [];
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to get Hermes session messages (${res.status}): ${text}`);
  }

  const data = (await res.json().catch(() => [])) as unknown;
  let list: unknown[] = [];
  if (Array.isArray(data)) {
    list = data;
  } else if (data && typeof data === "object" && "messages" in data) {
    const msgs = data.messages;
    if (Array.isArray(msgs)) {
      list = msgs;
    }
  }

  return list.map((m: unknown) => {
    if (m && typeof m === "object") {
      const rec = m as Record<string, unknown>;
      const role = typeof rec.role === "string" ? rec.role : "assistant";
      const content =
        typeof rec.content === "string"
          ? rec.content
          : JSON.stringify(rec.content ?? "");
      return { role, content };
    }
    return { role: "assistant", content: String(m ?? "") };
  });
}

export type HermesStartRunInput = {
  sessionId?: string;
  prompt: string;
  instructions?: string;
  model?: string;
  idempotencyKey?: string;
};

export type HermesStartRunResult =
  | { kind: "started"; runId: string }
  | { kind: "deferred"; reason: string };

export async function startHermesRun(
  agent: Agent,
  input: HermesStartRunInput,
): Promise<HermesStartRunResult> {
  const headers: Record<string, string> = {};
  if (input.idempotencyKey) {
    headers["Idempotency-Key"] = input.idempotencyKey;
  }

  const body: Record<string, unknown> = {
    input: input.prompt,
    instructions: input.instructions || agent.prompt || "",
  };

  // An empty model means "use the Hermes profile's own model". Sending
  // model: "" (or a name Hermes has no provider for) fails the run with 404.
  const model = (input.model || agent.model || "").trim();
  if (model) {
    body.model = model;
  }

  if (input.sessionId) {
    body.session_id = input.sessionId;
  }

  if (process.env.HERMES_PROVIDER_SLUG) {
    body.provider = process.env.HERMES_PROVIDER_SLUG;
  }

  const res = await hermesFetch(agent, "/v1/runs", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (res.status === 429 || res.status === 503) {
    const text = await res.text().catch(() => "Service busy or draining");
    return { kind: "deferred", reason: text };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to start Hermes run (${res.status}): ${text}`);
  }

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const runIdCandidate = data.run_id;
  const idCandidate = data.id;

  const runId =
    typeof runIdCandidate === "string"
      ? runIdCandidate
      : typeof idCandidate === "string"
        ? idCandidate
        : null;

  if (!runId) {
    throw new Error("Hermes did not return a runId");
  }

  return { kind: "started", runId };
}

export type HermesRunStatus = {
  run_id: string;
  status: string;
  output?: string;
  tokens?: number;
  error?: string;
  pending_controls?: unknown[];
  admission_id?: string;
  execution_generation?: number;
};

export async function getHermesRun(
  agent: Agent,
  runId: string,
): Promise<HermesRunStatus> {
  const res = await hermesFetch(agent, `/v1/runs/${encodeURIComponent(runId)}`);

  if (res.status === 404) {
    return {
      run_id: runId,
      status: "expired_404",
      error: "Run not found or expired on Hermes server",
    };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to get Hermes run status (${res.status}): ${text}`);
  }

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const usage = data.usage && typeof data.usage === "object" ? (data.usage as Record<string, unknown>) : undefined;

  let tokens = 0;
  if (typeof usage?.total_tokens === "number") {
    tokens = usage.total_tokens;
  } else if (typeof data.tokens === "number") {
    tokens = data.tokens;
  } else if (typeof usage?.prompt_tokens === "number" || typeof usage?.completion_tokens === "number") {
    tokens = (Number(usage?.prompt_tokens) || 0) + (Number(usage?.completion_tokens) || 0);
  }

  let output: string | undefined;
  if (typeof data.output === "string") {
    output = data.output;
  } else if (data.result !== undefined) {
    output = typeof data.result === "string" ? data.result : JSON.stringify(data.result);
  }

  const pending_controls = Array.isArray(data.pending_controls) ? data.pending_controls : [];

  return {
    run_id: typeof data.run_id === "string" ? data.run_id : runId,
    status: typeof data.status === "string" ? data.status : "unknown",
    output,
    tokens,
    error: typeof data.error === "string" ? data.error : undefined,
    pending_controls,
    admission_id: typeof data.admission_id === "string" ? data.admission_id : undefined,
    execution_generation:
      typeof data.execution_generation === "number" ? data.execution_generation : undefined,
  };
}

export async function stopHermesRun(agent: Agent, runId: string): Promise<boolean> {
  try {
    const res = await hermesFetch(agent, `/v1/runs/${encodeURIComponent(runId)}/stop`, {
      method: "POST",
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function submitHermesRunApproval(
  agent: Agent,
  runId: string,
  approved: boolean,
  details?: { requestId?: string; executionGeneration?: number },
): Promise<boolean> {
  const payload = {
    request_id: details?.requestId || "default",
    execution_generation: details?.executionGeneration || 1,
    choice: approved ? "once" : "deny",
  };

  const res = await hermesFetch(agent, `/v1/runs/${encodeURIComponent(runId)}/approval`, {
    method: "POST",
    body: JSON.stringify(payload),
  });

  return res.ok;
}

export async function submitHermesRunClarify(
  agent: Agent,
  runId: string,
  reply: string,
  details?: { requestId?: string; executionGeneration?: number },
): Promise<boolean> {
  const payload = {
    request_id: details?.requestId || "default",
    execution_generation: details?.executionGeneration || 1,
    answer: reply,
  };

  const res = await hermesFetch(agent, `/v1/runs/${encodeURIComponent(runId)}/clarify`, {
    method: "POST",
    body: JSON.stringify(payload),
  });

  return res.ok;
}

export async function openHermesRunEventStream(
  agent: Agent,
  runId: string,
  signal?: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  const res = await hermesFetch(
    agent,
    `/v1/runs/${encodeURIComponent(runId)}/events`,
    {
      headers: {
        Accept: "text/event-stream",
      },
    },
    signal,
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to open event stream (${res.status}): ${text}`);
  }

  if (!res.body) {
    throw new Error("No response body received from event stream");
  }

  return res.body;
}

export async function listHermesScheduledJobs(agent?: Agent): Promise<Array<Record<string, unknown>>> {
  const res = await hermesFetch(agent, "/api/jobs");
  if (!res.ok) {
    if (res.status === 404) return [];
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to list scheduled jobs (${res.status}): ${text}`);
  }
  const data = (await res.json().catch(() => [])) as unknown;
  if (Array.isArray(data)) return data as Array<Record<string, unknown>>;
  if (data && typeof data === "object" && "jobs" in data) {
    const jobsList = data.jobs;
    if (Array.isArray(jobsList)) {
      return jobsList as Array<Record<string, unknown>>;
    }
  }
  return [];
}

export async function createHermesScheduledJob(
  job: Record<string, unknown>,
  agent?: Agent,
): Promise<Record<string, unknown>> {
  const res = await hermesFetch(agent, "/api/jobs", {
    method: "POST",
    body: JSON.stringify(job),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to create scheduled job (${res.status}): ${text}`);
  }
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

export async function updateHermesScheduledJob(
  jobId: string,
  updates: Record<string, unknown>,
  agent?: Agent,
): Promise<Record<string, unknown>> {
  const res = await hermesFetch(agent, `/api/jobs/${encodeURIComponent(jobId)}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to update scheduled job (${res.status}): ${text}`);
  }
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

export async function deleteHermesScheduledJob(
  jobId: string,
  agent?: Agent,
): Promise<boolean> {
  const res = await hermesFetch(agent, `/api/jobs/${encodeURIComponent(jobId)}`, {
    method: "DELETE",
  });
  return res.ok;
}

export async function triggerHermesScheduledJob(
  jobId: string,
  action: "run" | "pause" | "resume",
  agent?: Agent,
): Promise<Record<string, unknown>> {
  const res = await hermesFetch(
    agent,
    `/api/jobs/${encodeURIComponent(jobId)}/${encodeURIComponent(action)}`,
    {
      method: "POST",
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to trigger scheduled job ${action} (${res.status}): ${text}`);
  }
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

export type HermesModelOption = {
  id: string;
  provider: string;
  providerName: string;
};

export type HermesModelOptions = {
  currentModel: string;
  currentProvider: string;
  models: HermesModelOption[];
};

/**
 * Models the connected Hermes can run, read from Hermes' own
 * `/api/model/options`. Neiro never asks 9Router directly: Hermes owns the
 * provider config and forwards to 9Router itself.
 *
 * Runs use the configured provider override, or Hermes' current provider.
 */
export async function listHermesModelOptions(agent?: Pick<Agent, "profile" | "url" | "key_enc">): Promise<HermesModelOptions> {
  const res = await hermesFetch(agent, "/api/model/options");
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to read Hermes model options (${res.status}): ${text}`);
  }

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const currentModel = typeof data.model === "string" ? data.model : "";
  const currentProvider = typeof data.provider === "string" ? data.provider : "";
  const providerOverride = process.env.HERMES_PROVIDER_SLUG;
  const providers = Array.isArray(data.providers) ? data.providers : [];

  const seen = new Set<string>();
  const models: HermesModelOption[] = [];
  const add = (id: string, provider: string, providerName: string) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    models.push({ id, provider, providerName });
  };

  for (const raw of providers) {
    if (!raw || typeof raw !== "object") continue;
    const p = raw as Record<string, unknown>;
    const slug = typeof p.slug === "string" ? p.slug : "";
    const name = typeof p.name === "string" ? p.name : slug;
    const usable = providerOverride ? slug === providerOverride : p.is_current === true;
    if (!usable || !Array.isArray(p.models)) continue;
    for (const m of p.models) {
      if (typeof m === "string") add(m, slug, name);
    }
  }

  if (currentModel && (!providerOverride || providerOverride === currentProvider)) {
    add(currentModel, currentProvider, currentProvider);
  }

  return { currentModel, currentProvider, models };
}
