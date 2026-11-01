import { decryptAgentKey } from "@/lib/crypto-keys";
import { isSyntheticRequestId, normalizePendingControls } from "@/lib/approvals";
import { AppConfigError } from "@/lib/types";
import type { Agent, ApprovalChoice, PendingControl, ReasoningEffort } from "@/lib/types";

export type HermesEndpointConfig = {
  baseUrl: string;
  apiKey: string;
  profilePrefix: string;
};

export async function resolveAgentEndpoint(
  agent?: Pick<Agent, "profile" | "url" | "key_enc"> | null,
): Promise<HermesEndpointConfig> {
  const customUrl = agent?.url?.trim();
  const envUrl = process.env.HERMES_DEFAULT_URL?.trim();
  const rawBaseUrl = customUrl || envUrl || "";
  const baseUrl = rawBaseUrl.replace(/\/+$/, "");

  const storedKey = agent?.key_enc?.trim();
  const customKey = storedKey ? await decryptAgentKey(storedKey) : undefined;
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
  const { baseUrl, apiKey, profilePrefix } = await resolveAgentEndpoint(agent);
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

type HermesAgentRef = Pick<Agent, "profile" | "url" | "key_enc">;

export type HermesSteerResult = { ok: boolean; status: number; error?: string };

/** Queue an instruction for a running Hermes agent. */
export async function steerHermesRun(agent: Agent, runId: string, text: string): Promise<HermesSteerResult> {
  const res = await hermesFetch(agent, `/v1/runs/${encodeURIComponent(runId)}/steer`, {
    method: "POST", body: JSON.stringify({ input: text.trim() }),
  });
  if (res.ok) return { ok: true, status: res.status };
  const message = (await res.text().catch(() => "")).trim().slice(0, 1000);
  return { ok: false, status: res.status, error: message || `HTTP ${res.status}` };
}


const textOf = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const numOf = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** `[...]`, `{ data: [...] }` or `{ <key>: [...] }`: Hermes has used all three. */
function readList(data: unknown, key: string): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const rec = data as Record<string, unknown>;
    if (Array.isArray(rec.data)) return rec.data;
    if (Array.isArray(rec[key])) return rec[key] as unknown[];
  }
  return [];
}

export type HermesReadiness = {
  status?: string;
  db?: string;
  diskFreeBytes?: number;
  activeRuns?: number;
  pendingCompletions?: number;
  activeDelegations?: number;
};

export type HermesProbeResult = {
  ok: boolean;
  latencyMs: number;
  status?: string;
  capabilities?: string[];
  /** Raw /health/detailed body. Server-side only: never sent to the browser. */
  details?: Record<string, unknown>;
  readiness?: HermesReadiness;
  error?: string;
  /** A public health endpoint confirms reachability, not the API credential. */
  authVerified?: boolean;
};

/** The readiness fields of /health/detailed, wherever this Hermes version puts them. */
export function readinessOf(data: Record<string, unknown>): HermesReadiness {
  const pick = (...keys: string[]): unknown => {
    for (const key of keys) {
      const parts = key.split(".");
      let cur: unknown = data;
      for (const part of parts) {
        cur = cur && typeof cur === "object" ? (cur as Record<string, unknown>)[part] : undefined;
      }
      if (cur !== undefined && cur !== null) return cur;
    }
    return undefined;
  };
  const dbVal = pick("db.status", "database.status", "db", "database", "state_db");
  return {
    status: textOf(pick("status")),
    db: typeof dbVal === "string" ? dbVal : typeof dbVal === "boolean" ? (dbVal ? "ok" : "down") : undefined,
    diskFreeBytes: numOf(pick("disk.free_bytes", "disk_free_bytes", "disk.free", "disk_space.free_bytes")),
    activeRuns: numOf(pick("active_runs", "runs.active")),
    pendingCompletions: numOf(pick("pending_completions")),
    activeDelegations: numOf(pick("active_delegations", "delegations.active")),
  };
}

export async function probeHermesAgent(agent: Agent): Promise<HermesProbeResult> {
  const startTime = Date.now();
  try {
    const res = await hermesFetch(agent, "/health/detailed");
    const latencyMs = Date.now() - startTime;

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        return { ok: false, latencyMs, error: `Hermes returned status ${res.status}: ${res.statusText}`, authVerified: false };
      }
      const fallbackRes = await hermesFetch(agent, "/health");
      if (!fallbackRes.ok) {
        return {
          ok: false,
          latencyMs,
          error: `Hermes returned status ${res.status}: ${res.statusText}`,
        };
      }
      return { ok: true, latencyMs, status: "healthy", readiness: { status: "healthy" }, authVerified: false };
    }

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const statusVal = typeof data.status === "string" ? data.status : "healthy";
    const capabilitiesVal = Array.isArray(data.capabilities)
      ? data.capabilities.filter((c): c is string => typeof c === "string")
      : [];

    return {
      ok: true,
      authVerified: true,
      latencyMs,
      status: statusVal,
      capabilities: capabilitiesVal,
      details: data,
      readiness: { ...readinessOf(data), status: statusVal },
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

export type HermesServerCapabilities = {
  /** False when the server has no /v1/capabilities (older Hermes) or could not be reached. */
  available: boolean;
  features: Record<string, boolean>;
  endpoints: Record<string, { method: string; path: string }>;
};

const CAPABILITIES_TTL_MS = 60_000;
const capabilitiesCache = new Map<string, { at: number; value: HermesServerCapabilities }>();

const NO_CAPABILITIES: HermesServerCapabilities = { available: false, features: {}, endpoints: {} };

/** For tests. */
export function clearHermesCapabilitiesCache(): void {
  capabilitiesCache.clear();
}

/** GET /v1/capabilities, cached for a minute per server + profile. Never throws for a missing route. */
export async function getHermesServerCapabilities(agent?: HermesAgentRef): Promise<HermesServerCapabilities> {
  const { baseUrl, profilePrefix } = await resolveAgentEndpoint(agent);
  const key = `${baseUrl}|${profilePrefix}`;
  const hit = capabilitiesCache.get(key);
  if (hit && Date.now() - hit.at < CAPABILITIES_TTL_MS) return hit.value;
  try {
    const res = await hermesFetch(agent, "/v1/capabilities");
    if (!res.ok) return NO_CAPABILITIES;
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const features: Record<string, boolean> = {};
    const rawFeatures = data.features && typeof data.features === "object" ? (data.features as Record<string, unknown>) : {};
    for (const [name, value] of Object.entries(rawFeatures)) {
      if (typeof value === "boolean") features[name] = value;
      else if (value && typeof value === "object" && "enabled" in value) {
        features[name] = Boolean((value as Record<string, unknown>).enabled);
      } else features[name] = Boolean(value);
    }
    const endpoints: HermesServerCapabilities["endpoints"] = {};
    const rawEndpoints = data.endpoints && typeof data.endpoints === "object" ? (data.endpoints as Record<string, unknown>) : {};
    for (const [name, value] of Object.entries(rawEndpoints)) {
      if (!value || typeof value !== "object") continue;
      const v = value as Record<string, unknown>;
      const method = textOf(v.method);
      const path = textOf(v.path);
      if (method && path) endpoints[name] = { method, path };
    }
    const value: HermesServerCapabilities = { available: true, features, endpoints };
    capabilitiesCache.set(key, { at: Date.now(), value });
    return value;
  } catch (err: unknown) {
    if (err instanceof AppConfigError) throw err;
    return NO_CAPABILITIES;
  }
}

export type HermesSkillInfo = { name: string; description?: string; category?: string };
export type HermesToolsetInfo = {
  name: string;
  label?: string;
  description?: string;
  enabled?: boolean;
  configured?: boolean;
  tools?: string[];
  /** An MCP server's toolset (mcp-<server>). */
  isMcp: boolean;
};

export type HermesDetailedInventory = { skills: HermesSkillInfo[]; toolsets: HermesToolsetInfo[] };

export function parseSkills(data: unknown): HermesSkillInfo[] {
  return readList(data, "skills").flatMap((s): HermesSkillInfo[] => {
    if (typeof s === "string") return s.trim() ? [{ name: s.trim() }] : [];
    if (!s || typeof s !== "object") return [];
    const r = s as Record<string, unknown>;
    const name = textOf(r.name);
    if (!name) return [];
    return [{ name, description: textOf(r.description), category: textOf(r.category) }];
  });
}

export function parseToolsets(data: unknown): HermesToolsetInfo[] {
  return readList(data, "toolsets").flatMap((t): HermesToolsetInfo[] => {
    if (typeof t === "string") return t.trim() ? [{ name: t.trim(), isMcp: t.trim().startsWith("mcp-") }] : [];
    if (!t || typeof t !== "object") return [];
    const r = t as Record<string, unknown>;
    const name = textOf(r.name);
    if (!name) return [];
    return [{
      name,
      label: textOf(r.label),
      description: textOf(r.description),
      enabled: typeof r.enabled === "boolean" ? r.enabled : undefined,
      configured: typeof r.configured === "boolean" ? r.configured : undefined,
      tools: Array.isArray(r.tools) ? r.tools.filter((x): x is string => typeof x === "string") : undefined,
      isMcp: name.startsWith("mcp-"),
    }];
  });
}

/** Installed skills and toolsets (MCP servers included), with their metadata. */
export async function getHermesDetailedInventory(agent: HermesAgentRef): Promise<HermesDetailedInventory> {
  try {
    const [skillsRes, toolsRes] = await Promise.all([
      hermesFetch(agent, "/v1/skills").catch(() => null),
      hermesFetch(agent, "/v1/toolsets").catch(() => null),
    ]);
    const skills = skillsRes?.ok ? parseSkills(await skillsRes.json().catch(() => null)) : [];
    const toolsets = toolsRes?.ok ? parseToolsets(await toolsRes.json().catch(() => null)) : [];
    return { skills, toolsets };
  } catch (err: unknown) {
    if (err instanceof AppConfigError) throw err;
    return { skills: [], toolsets: [] };
  }
}

/** Names only (skills, then toolsets), for callers that predate the detailed inventory. */
export async function listHermesCapabilitiesInventory(agent: Agent): Promise<string[]> {
  const { skills, toolsets } = await getHermesDetailedInventory(agent);
  return Array.from(new Set([...skills.map((s) => s.name), ...toolsets.map((t) => t.name)]));
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
  const nested = data.session && typeof data.session === "object" ? data.session as Record<string, unknown> : {};
  const sessionId = textOf(data.id) ?? textOf(data.session_id) ?? textOf(nested.id) ?? textOf(nested.session_id);

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
  opts?: { includeCompacted?: boolean; inlineImages?: boolean },
): Promise<Array<{ role: string; content: string }>> {
  const query = new URLSearchParams({
    inline_images: opts?.inlineImages ? "true" : "false",
  });
  if (opts?.includeCompacted !== undefined) {
    query.set("include_compacted", opts.includeCompacted ? "true" : "false");
  }
  const res = await hermesFetch(
    agent,
    `/api/sessions/${encodeURIComponent(sessionId)}/messages?${query.toString()}`,
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

export type HermesModelOptionsInput = {
  reasoning_effort?: ReasoningEffort;
  service_tier?: string;
  reasoning?: { enabled: boolean };
};

export type HermesStartRunInput = {
  sessionId?: string;
  prompt: string;
  instructions?: string;
  model?: string;
  idempotencyKey?: string;
  /** Long-term memory scope (X-Hermes-Session-Key), e.g. "neiro:project:<id>". */
  sessionKey?: string;
  /** Per-run model_options; fields left out fall back to the agent's settings. */
  modelOptions?: HermesModelOptionsInput;
  /** Images sent with the prompt, as data: URLs. */
  images?: Array<{ name?: string; dataUrl: string }>;
};

export type HermesStartRunResult =
  | { kind: "started"; runId: string; skippedImages?: boolean }
  | { kind: "deferred"; reason: string };

/** A header-safe X-Hermes-Session-Key: no CR, LF or NUL, at most 256 characters. */
export function cleanSessionKey(value: string | undefined | null): string {
  return (value ?? "").replace(/[\r\n\0]/g, "").trim().slice(0, 256);
}

/** model_options for a run: the input's fields over the agent's. Undefined when there is nothing to send. */
export function buildModelOptions(
  agent: Pick<Agent, "reasoningEffort" | "serviceTier">,
  input?: HermesModelOptionsInput,
): HermesModelOptionsInput | undefined {
  const out: HermesModelOptionsInput = {};
  const effort = input?.reasoning_effort ?? agent.reasoningEffort ?? undefined;
  if (effort) out.reasoning_effort = effort;
  const tier = (input?.service_tier ?? agent.serviceTier ?? "").trim();
  if (tier) out.service_tier = tier;
  if (input?.reasoning) out.reasoning = input.reasoning;
  return Object.keys(out).length ? out : undefined;
}

/** The run's `input`: plain text, or one user message with text and image parts. */
export function runInput(prompt: string, images?: Array<{ dataUrl: string }>): unknown {
  if (!images || images.length === 0) return prompt;
  return [{
    role: "user",
    content: [
      { type: "input_text", text: prompt },
      ...images.map((img) => ({ type: "image_url", image_url: { url: img.dataUrl } })),
    ],
  }];
}

/** A 400 that says the images (not the prompt) were the problem. */
function isImageRejection(status: number, text: string): boolean {
  return status === 400 && /invalid_image_url|image|vision|multimodal/i.test(text);
}

export async function startHermesRun(
  agent: Agent,
  input: HermesStartRunInput,
): Promise<HermesStartRunResult> {
  const headers: Record<string, string> = {};
  if (input.idempotencyKey) {
    headers["Idempotency-Key"] = input.idempotencyKey;
  }
  const sessionKey = cleanSessionKey(input.sessionKey);
  if (sessionKey) {
    headers["X-Hermes-Session-Key"] = sessionKey;
  }

  const body: Record<string, unknown> = {
    input: runInput(input.prompt, input.images),
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

  const modelOptions = buildModelOptions(agent, input.modelOptions);
  if (modelOptions) {
    body.model_options = modelOptions;
  }
  // Skills and toolsets are set per Hermes profile; /v1/runs ignores them.

  const post = (values: Record<string, unknown>) =>
    hermesFetch(agent, "/v1/runs", {
      method: "POST",
      headers,
      body: JSON.stringify(values),
    });

  let res = await post(body);
  let skippedImages = false;
  if (!res.ok && input.images?.length) {
    const text = await res.clone().text().catch(() => "");
    if (isImageRejection(res.status, text)) {
      skippedImages = true;
      res = await post({ ...body, input: input.prompt });
    }
  }

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

  return skippedImages ? { kind: "started", runId, skippedImages } : { kind: "started", runId };
}

export type HermesRunRuntime = { provider?: string; model?: string; route_source?: string };

export type HermesRunStatus = {
  run_id: string;
  status: string;
  output?: string;
  tokens?: number;
  /** The model Hermes really ran: the run's runtime, else its session, once the run ends. */
  model?: string;
  error?: string;
  pending_controls?: unknown[];
  /** pending_controls, normalized. */
  controls?: PendingControl[];
  admission_id?: string;
  execution_generation?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  /** Prompt (in) and completion (out) tokens, when the run reports them. */
  input_tokens?: number;
  output_tokens?: number;
  estimated_cost_usd?: number;
  cost_status?: string;
  runtime?: HermesRunRuntime;
  /** Set while the server drains for shutdown. */
  shutdown_requested_at?: number;
};

const ENDED_RUN_STATUSES = new Set([
  "completed", "succeeded", "success", "failed", "error", "cancelled", "canceled", "stopped", "interrupted",
]);

/** The model a Hermes session ran on, or undefined when Hermes cannot say. */
export async function getHermesSessionModel(
  agent: Pick<Agent, "profile" | "url" | "key_enc"> | undefined,
  sessionId: string,
): Promise<string | undefined> {
  try {
    const res = await hermesFetch(agent, `/api/sessions/${encodeURIComponent(sessionId)}`);
    if (!res.ok) return undefined;
    const data = (await res.json().catch(() => ({}))) as { session?: { model?: unknown } };
    const model = data.session?.model;
    return typeof model === "string" && model.trim() ? model.trim() : undefined;
  } catch {
    return undefined;
  }
}

function runtimeOf(v: unknown): HermesRunRuntime | undefined {
  if (!v || typeof v !== "object") return undefined;
  const r = v as Record<string, unknown>;
  const out: HermesRunRuntime = {};
  const provider = textOf(r.provider);
  const model = textOf(r.model);
  const route = textOf(r.route_source);
  if (provider) out.provider = provider;
  if (model) out.model = model;
  if (route) out.route_source = route;
  return Object.keys(out).length ? out : undefined;
}

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
  // A missing status is not Hermes saying "unknown" (that one triggers recovery).
  const status = typeof data.status === "string" ? data.status : "missing_status";
  const runtime = runtimeOf(data.runtime);
  // The run itself rarely says its model. An agent with no model set runs on
  // Hermes' default, so read the model from the session, once, when it ends.
  const ended = ENDED_RUN_STATUSES.has(status.toLowerCase());
  const model =
    runtime?.model ??
    (ended && tokens > 0 && typeof data.session_id === "string"
      ? await getHermesSessionModel(agent, data.session_id)
      : undefined);

  const result: HermesRunStatus = {
    run_id: typeof data.run_id === "string" ? data.run_id : runId,
    status,
    output,
    tokens,
    model,
    error: typeof data.error === "string" ? data.error : undefined,
    pending_controls,
    controls: normalizePendingControls(pending_controls),
    admission_id: typeof data.admission_id === "string" ? data.admission_id : undefined,
    execution_generation:
      typeof data.execution_generation === "number" ? data.execution_generation : undefined,
  };
  const cacheRead = numOf(usage?.cache_read_tokens);
  const cacheWrite = numOf(usage?.cache_write_tokens);
  if (cacheRead !== undefined) result.cache_read_tokens = cacheRead;
  if (cacheWrite !== undefined) result.cache_write_tokens = cacheWrite;
  const inTokens = numOf(usage?.input_tokens) ?? numOf(usage?.prompt_tokens);
  const outTokens = numOf(usage?.output_tokens) ?? numOf(usage?.completion_tokens);
  if (inTokens !== undefined) result.input_tokens = inTokens;
  if (outTokens !== undefined) result.output_tokens = outTokens;
  const estimatedCost = numOf(usage?.estimated_cost_usd);
  if (estimatedCost !== undefined && estimatedCost >= 0) result.estimated_cost_usd = estimatedCost;
  if (typeof usage?.cost_status === "string") result.cost_status = usage.cost_status;
  if (runtime) result.runtime = runtime;
  const shutdown = numOf(data.shutdown_requested_at);
  if (shutdown !== undefined) result.shutdown_requested_at = shutdown;
  return result;
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

/** Releases a run Hermes lost track of (status "unknown") so it can be retried safely. */
export async function resolveHermesUnknownRun(
  agent: Agent,
  runId: string,
  details: { admissionId: string; executionGeneration: number },
): Promise<boolean> {
  try {
    const res = await hermesFetch(agent, `/v1/runs/${encodeURIComponent(runId)}/resolve-unknown`, {
      method: "POST",
      body: JSON.stringify({
        admission_id: details.admissionId,
        execution_generation: details.executionGeneration,
      }),
    });
    return res.ok;
  } catch (err: unknown) {
    if (err instanceof AppConfigError) throw err;
    return false;
  }
}

export type HermesControlDetails = { requestId?: string | null; executionGeneration?: number | null };

/** request_id / execution_generation, only when they are real (a made-up id is left out). */
function controlFields(details?: HermesControlDetails): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (details?.requestId && !isSyntheticRequestId(details.requestId)) out.request_id = details.requestId;
  if (typeof details?.executionGeneration === "number") out.execution_generation = details.executionGeneration;
  return out;
}

/** Answers a waiting approval. `true` = once, `false` = deny. */
export async function submitHermesRunApproval(
  agent: Agent,
  runId: string,
  choice: ApprovalChoice | boolean,
  details?: HermesControlDetails,
): Promise<boolean> {
  const value: ApprovalChoice = typeof choice === "boolean" ? (choice ? "once" : "deny") : choice;
  const res = await hermesFetch(agent, `/v1/runs/${encodeURIComponent(runId)}/approval`, {
    method: "POST",
    body: JSON.stringify({ ...controlFields(details), choice: value }),
  });

  return res.ok;
}

export async function submitHermesRunClarify(
  agent: Agent,
  runId: string,
  reply: string,
  details?: HermesControlDetails,
): Promise<boolean> {
  const res = await hermesFetch(agent, `/v1/runs/${encodeURIComponent(runId)}/clarify`, {
    method: "POST",
    body: JSON.stringify({ ...controlFields(details), answer: reply }),
  });

  return res.ok;
}

/** Branches a session; returns the new session's id. */
export async function forkHermesSession(agent: Agent, sessionId: string, title?: string): Promise<string> {
  const res = await hermesFetch(agent, `/api/sessions/${encodeURIComponent(sessionId)}/fork`, {
    method: "POST",
    body: JSON.stringify(title ? { title } : {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to fork Hermes session (${res.status}): ${text}`);
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const nested = data.session && typeof data.session === "object" ? (data.session as Record<string, unknown>) : {};
  const id = textOf(data.session_id) ?? textOf(data.id) ?? textOf(nested.id) ?? textOf(nested.session_id);
  if (!id) throw new Error("Hermes did not return the forked session id");
  return id;
}

export type HermesSessionChatInput = {
  prompt: string;
  instructions?: string;
  /** data: or http(s) image URLs. */
  images?: string[];
  model?: string;
  modelOptions?: Record<string, unknown>;
  sessionKey?: string;
};

function sessionChatBody(input: HermesSessionChatInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    message: input.images?.length
      ? [
          { type: "text", text: input.prompt },
          ...input.images.map((url) => ({ type: "image_url", image_url: { url } })),
        ]
      : input.prompt,
  };
  if (input.instructions?.trim()) body.instructions = input.instructions.trim();
  if (input.model?.trim()) body.model = input.model.trim();
  if (input.modelOptions && Object.keys(input.modelOptions).length) body.model_options = input.modelOptions;
  return body;
}

function sessionChatHeaders(input: HermesSessionChatInput): Record<string, string> {
  const key = cleanSessionKey(input.sessionKey);
  return key ? { "X-Hermes-Session-Key": key } : {};
}

/** One turn in a session, streamed (POST /api/sessions/{id}/chat/stream). */
export async function streamHermesSessionChat(
  agent: Agent,
  sessionId: string,
  input: HermesSessionChatInput,
  signal?: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  const res = await hermesFetch(
    agent,
    `/api/sessions/${encodeURIComponent(sessionId)}/chat/stream`,
    {
      method: "POST",
      headers: { Accept: "text/event-stream", ...sessionChatHeaders(input) },
      body: JSON.stringify(sessionChatBody(input)),
    },
    signal,
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to stream session chat (${res.status}): ${text}`);
  }
  if (!res.body) throw new Error("No response body received from session chat stream");
  return res.body;
}

/**
 * One whole turn in a session (POST /api/sessions/{id}/chat). Used for
 * "/compact" and for bot turns, which need the full answer.
 */
export async function sendHermesSessionChat(
  agent: Agent,
  sessionId: string,
  input: HermesSessionChatInput,
  signal?: AbortSignal,
): Promise<{ output: string; tokens: number }> {
  const res = await hermesFetch(
    agent,
    `/api/sessions/${encodeURIComponent(sessionId)}/chat`,
    {
      method: "POST",
      headers: sessionChatHeaders(input),
      body: JSON.stringify(sessionChatBody(input)),
    },
    signal ?? AbortSignal.timeout(10 * 60_000),
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Session chat failed (${res.status}): ${text}`);
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const usage = data.usage && typeof data.usage === "object" ? (data.usage as Record<string, unknown>) : {};
  const output =
    textOf(data.output) ?? textOf(data.response) ?? textOf(data.content) ?? textOf(data.message) ?? "";
  return { output, tokens: numOf(usage.total_tokens) ?? 0 };
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
  /** USD per million tokens when Hermes reports a numeric rate. */
  pricing?: { input?: number; output?: number; cacheRead?: number };
  supportsVision?: boolean;
  supportsReasoning?: boolean;
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
export async function listHermesModelOptions(agent?: Pick<Agent, "profile" | "url" | "key_enc">, opts?: { refresh?: boolean; signal?: AbortSignal }): Promise<HermesModelOptions> {
  const res = await hermesFetch(agent, opts?.refresh ? "/api/model/options?refresh=1" : "/api/model/options", {}, opts?.signal);
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
  const add = (id: string, provider: string, providerName: string, extra: Partial<HermesModelOption> = {}) => {
    const key = `${provider}\0${id}`;
    if (!id || seen.has(key)) return;
    seen.add(key);
    models.push({ id, provider, providerName, ...extra });
  };
  const number = (v: unknown): number | undefined => {
    if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : undefined;
    if (v === "free") return 0;
    if (typeof v !== "string" || !/^\$?\d+(?:\.\d+)?$/.test(v.trim())) return undefined;
    const n = Number(v.trim().replace(/^\$/, ""));
    return Number.isFinite(n) ? n : undefined;
  };

  for (const raw of providers) {
    if (!raw || typeof raw !== "object") continue;
    const p = raw as Record<string, unknown>;
    const slug = typeof p.slug === "string" ? p.slug : "";
    const name = typeof p.name === "string" ? p.name : slug;
    const usable = p.authenticated !== false && (providerOverride ? slug === providerOverride : p.authenticated === true || (p.authenticated === undefined && p.is_current === true));
    if (!usable || !Array.isArray(p.models)) continue;
    const pricing = p.pricing && typeof p.pricing === "object" ? p.pricing as Record<string, unknown> : {};
    const capabilities = p.capabilities && typeof p.capabilities === "object" ? p.capabilities as Record<string, unknown> : {};
    for (const m of p.models) {
      if (typeof m !== "string") continue;
      const price = pricing[m] && typeof pricing[m] === "object" ? pricing[m] as Record<string, unknown> : {};
      const caps = capabilities[m] && typeof capabilities[m] === "object" ? capabilities[m] as Record<string, unknown> : {};
      const input = number(price.input), output = number(price.output), cacheRead = number(price.cache);
      const rates = { ...(input !== undefined && { input }), ...(output !== undefined && { output }), ...(cacheRead !== undefined && { cacheRead }) };
      add(m, slug, name, {
        ...(Object.keys(rates).length > 0 && { pricing: rates }),
        ...(typeof caps.vision === "boolean" && { supportsVision: caps.vision }),
        ...(typeof caps.reasoning === "boolean" && { supportsReasoning: caps.reasoning }),
      });
    }
  }

  const currentRow = providers.find((raw) => raw && typeof raw === "object" && (raw as Record<string, unknown>).slug === currentProvider) as Record<string, unknown> | undefined;
  if (currentModel && currentRow?.authenticated !== false && (!providerOverride || providerOverride === currentProvider)) {
    add(currentModel, currentProvider, currentProvider);
  }

  return { currentModel, currentProvider, models };
}
