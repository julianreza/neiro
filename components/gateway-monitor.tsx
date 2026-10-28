"use client";

import { useState } from "react";
import { Cable, Check, Copy, Lock, RefreshCw, Search, Terminal, Unplug } from "lucide-react";
import { toast } from "sonner";
import type { GatewayStatusDTO } from "@/lib/types";
import { DataSourceBadge } from "@/components/data-source-badge";
import {
  AgentBot,
  agentLook,
  followPointer,
  resetPointer,
} from "@/components/agent-bot";
import { useLiveData } from "@/hooks/use-live-data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const categories = [
  "all",
  "combo",
  "chat",
  "web",
  "image",
  "embedding",
  "search",
] as const;
type Category = (typeof categories)[number];
const models: {
  id: string;
  name: string;
  type: Exclude<Category, "all">;
  provider: string;
}[] = [
  {
    id: "demo/research-combo",
    name: "Research routing combo",
    type: "combo",
    provider: "Sample 9Router combo",
  },
  {
    id: "demo/claude-sonnet",
    name: "Claude Sonnet",
    type: "chat",
    provider: "Anthropic · sample",
  },
  {
    id: "demo/gpt-chat",
    name: "GPT chat",
    type: "chat",
    provider: "OpenAI · sample",
  },
  {
    id: "demo/web-reader",
    name: "Web reader",
    type: "web",
    provider: "Sample web route",
  },
  {
    id: "demo/image-generator",
    name: "Image generation",
    type: "image",
    provider: "Sample image route",
  },
  {
    id: "demo/text-embedding",
    name: "Text embedding",
    type: "embedding",
    provider: "Sample embedding route",
  },
  {
    id: "demo/web-search",
    name: "Web search",
    type: "search",
    provider: "Sample search route",
  },
];
const capabilities = [
  {
    name: "Atlas",
    role: "Research",
    chat: true,
    web: true,
    image: false,
    embedding: true,
    search: true,
  },
  {
    name: "Relay",
    role: "DevOps",
    chat: true,
    web: true,
    image: false,
    embedding: false,
    search: false,
  },
  {
    name: "Muse",
    role: "Content",
    chat: true,
    web: true,
    image: true,
    embedding: false,
    search: true,
  },
];
const capabilityKeys = ["chat", "web", "image", "embedding", "search"] as const;
const MODEL_PREVIEW = 10;

type ModelFamily = {
  key: string;
  name: string;
  provider: string;
  brand: "gemini" | "claude" | "gpt" | "other";
  variants: { label: string; model: ModelRowBase }[];
};
type ModelRowBase = { id: string; name: string; type: string; provider: string };

const VARIANT_RE = /-(high|medium|low|thinking)$/i;
const VARIANT_ORDER = ["base", "low", "medium", "high", "thinking"];

function brandOf(name: string): ModelFamily["brand"] {
  const n = name.toLowerCase();
  if (n.startsWith("gemini")) return "gemini";
  if (n.startsWith("claude")) return "claude";
  if (n.startsWith("gpt")) return "gpt";
  return "other";
}

// Collapse "x-high / x-medium / x-low / x" into one family row with variant chips.
function groupModels(list: ModelRowBase[]): ModelFamily[] {
  const map = new Map<string, ModelFamily>();
  for (const model of list) {
    const match = model.name.match(VARIANT_RE);
    const base = match ? model.name.slice(0, -match[0].length) : model.name;
    const label = match ? match[1].toLowerCase() : "base";
    const key = `${model.provider}::${base}`;
    const family =
      map.get(key) ??
      { key, name: base, provider: model.provider, brand: brandOf(base), variants: [] };
    family.variants.push({ label, model });
    map.set(key, family);
  }
  for (const family of map.values()) {
    family.variants.sort(
      (a, b) => VARIANT_ORDER.indexOf(a.label) - VARIANT_ORDER.indexOf(b.label),
    );
  }
  return [...map.values()];
}
const cronSample =
  '# Example only: replace both placeholders on your VPS. Not deployed.\n* * * * * curl --fail --silent --show-error -X POST \\\n  -H "Authorization: Bearer <DASHBOARD_SECRET>" \\\n  "<NEIRO_URL>/api/orchestrator/tick"';

type ModelRow = (typeof models)[number];

function parseStatus(json: unknown): GatewayStatusDTO | null {
  const body = json as Partial<GatewayStatusDTO> | null;
  if (!body || typeof body !== "object" || !body.checkedAt) {
    throw new Error("Malformed /api/gateway/status response");
  }
  return body as GatewayStatusDTO;
}

function parseModels(json: unknown): ModelRow[] {
  const list = (json as { models?: { id: string; owned_by?: string }[] } | null)?.models;
  if (!Array.isArray(list)) throw new Error("Malformed /api/gateway/models response");
  return list.map((item) => ({
    id: item.id,
    name: item.id.split("/").pop() || item.id,
    type: "chat" as Exclude<Category, "all">,
    provider: item.owned_by || "9Router",
  }));
}

type Vital = {
  name: string;
  connected: boolean;
  detail: string;
  note: string;
  envKeys: string;
  keys: { name: string; description: string; secret?: boolean }[];
};
type VitalState = "alive" | "down" | "unset" | "checking";

// A heartbeat line per service: alive services beat, down ones flatline,
// unconfigured ones show a dashed "no signal" line.
const BEAT_PATH =
  "M0 20 H70 L80 20 L88 6 L98 34 L106 20 H190 L200 20 L208 6 L218 34 L226 20 H320 L330 20 L338 6 L348 34 L356 20 H480";

function vitalState(vital: Vital, loading: boolean): VitalState {
  if (loading) return "checking";
  if (vital.connected) return "alive";
  return /missing|configur|not set/i.test(vital.detail) ? "unset" : "down";
}

const stateLabel: Record<VitalState, string> = {
  alive: "Connected",
  down: "No response",
  unset: "Not configured",
  checking: "Checking…",
};

function VitalsPanel({ vitals, loading }: { vitals: Vital[]; loading: boolean }) {
  const aliveCount = vitals.filter((v) => !loading && v.connected).length;
  return (
    <section aria-labelledby="gateway-vitals" className="vitals-panel">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b p-5">
        <div className="space-y-1">
          <h2 id="gateway-vitals" className="text-lg font-semibold">
            Connection vitals
          </h2>
          <p className="text-sm text-muted-foreground">
            A live line beats. A flat line means the service is not answering.
          </p>
        </div>
        <p className="vitals-count" aria-live="polite">
          <span className="vitals-count-num">{loading ? "–" : aliveCount}</span>
          <span className="text-muted-foreground">/{vitals.length} connected</span>
        </p>
      </div>
      <ul className="divide-y">
        {vitals.map((vital) => {
          const state = vitalState(vital, loading);
          return (
            <li
              key={vital.name}
              className="vital-row grid gap-x-6 gap-y-2 p-5 md:grid-cols-[15rem_minmax(0,1fr)_12rem] md:items-center"
              data-state={state}
            >
              <div className="min-w-0 space-y-1">
                <h3 className="flex items-center gap-2 text-base font-semibold tracking-tight">
                  <span className="vital-dot" aria-hidden="true" />
                  {vital.name}
                </h3>
                <p className="text-xs text-muted-foreground">{vital.note}</p>
              </div>
              <svg
                className="vital-line"
                viewBox="0 0 480 40"
                preserveAspectRatio="none"
                role="img"
                aria-label={`${vital.name}: ${stateLabel[state]}`}
              >
                <path className="vital-line-base" d="M0 20 H480" />
                {state === "alive" && <path className="vital-line-beat" d={BEAT_PATH} />}
              </svg>
              <div className="min-w-0 space-y-1 md:text-right">
                <p className="vital-state text-sm font-semibold">{stateLabel[state]}</p>
                <p className="text-xs break-words text-muted-foreground">{vital.detail}</p>
                {(state === "down" || state === "unset") && (
                  <a
                    href="#setup-heading"
                    className="inline-flex min-h-10 items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline"
                  >
                    <Cable className="size-3.5" aria-hidden="true" />
                    Set <code className="code-chip">{vital.envKeys}</code>
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function GatewayMonitor() {
  const [category, setCategory] = useState<Category>("all");
  const [showAllModels, setShowAllModels] = useState(false);
  const [query, setQuery] = useState("");
  const status = useLiveData<GatewayStatusDTO | null>("/api/gateway/status", null, parseStatus);
  const modelList = useLiveData<ModelRow[]>("/api/gateway/models", models, parseModels);
  const liveStatus = status.source === "live" ? status.data : null;
  const displayModels: ModelRow[] = modelList.source === "loading" ? [] : modelList.data;
  const modelsAreSample = modelList.source !== "live";
  const statusLoading = status.source === "loading";
  const anyDemo = status.source === "demo" || modelList.source === "demo";
  // Plain-language summary for the badge; raw reasons stay in the banner's
  // technical-detail line so operators can still debug.
  const demoReason =
    status.source === "demo"
      ? "health checks unavailable"
      : modelList.source === "demo"
        ? "showing sample models"
        : undefined;
  const technicalDetail = [
    status.source === "demo" ? `status: ${status.reason}` : null,
    modelList.source === "demo" ? `models: ${modelList.reason}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  function refreshStatus() {
    status.reload();
    modelList.reload();
    toast.info("Re-checking gateway status");
  }

  const filtered = displayModels.filter(
    (model) =>
      (category === "all" || model.type === category) &&
      `${model.name} ${model.id} ${model.provider}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const families = groupModels(filtered);
  const presentCategories = categories.filter(
    (item) => item === "all" || displayModels.some((model) => model.type === item),
  );
  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error(
        "Clipboard unavailable. Select and copy the displayed text instead.",
      );
    }
  }

  const vitals: Vital[] = [
    {
      name: "Supabase Postgres",
      connected: liveStatus?.supabase?.status === "connected",
      detail:
        liveStatus?.supabase?.status === "connected"
          ? `Connected (${liveStatus?.supabase?.latencyMs ?? 0}ms)`
          : statusLoading
            ? "Checking…"
            : liveStatus?.supabase?.error || "Database disconnected",
      note: "Missions, tasks DAG, and agent registry state.",
      envKeys: "SUPABASE_URL",
      keys: [
        { name: "SUPABASE_URL", description: "Project URL for persistent dashboard data." },
        {
          name: "SUPABASE_SERVICE_ROLE_KEY",
          secret: true,
          description: "Service role credential. Never expose it in browser code.",
        },
      ],
    },
    {
      name: "9Router Gateway",
      connected: liveStatus?.nineRouter?.status === "connected",
      detail:
        liveStatus?.nineRouter?.status === "connected"
          ? `Online (${displayModels.length} models, ${liveStatus?.nineRouter?.latencyMs ?? 0}ms)`
          : statusLoading
            ? "Checking…"
            : liveStatus?.nineRouter?.error || "LLM Gateway unreachable",
      note: "LLM inference router and model discovery.",
      envKeys: "NINEROUTER_URL",
      keys: [
        {
          name: "NINEROUTER_URL",
          description: "Gateway base URL for model discovery and inference routing.",
        },
      ],
    },
    {
      name: "Hermes Agent VPS",
      connected: liveStatus?.hermes?.status === "connected",
      detail:
        liveStatus?.hermes?.status === "connected"
          ? `Agent runtime ready (${liveStatus?.hermes?.latencyMs ?? 0}ms)`
          : statusLoading
            ? "Checking…"
            : liveStatus?.hermes?.error || "Hermes VPS unreachable",
      note: "Autonomous coding agent runtime.",
      envKeys: "HERMES_DEFAULT_URL",
      keys: [
        { name: "HERMES_DEFAULT_URL", description: "Default Hermes agent endpoint on your VPS." },
        {
          name: "HERMES_DEFAULT_KEY",
          secret: true,
          description: "Authentication key for the Hermes endpoint.",
        },
      ],
    },
  ];

  return (
    <div className="min-w-0 space-y-8 p-4 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <p className="eyebrow">
            Infrastructure{anyDemo ? " / demo" : ""}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">Gateway</h1>
          <p className="flex max-w-2xl flex-wrap items-center gap-2 text-sm text-muted-foreground">
            Inspect the connection map, model routes, and agent capabilities.
            <DataSourceBadge source={anyDemo ? "demo" : "live"} reason={demoReason} />
          </p>
        </div>
        <Button
          variant="outline"
          className="min-h-10"
          disabled={statusLoading}
          onClick={refreshStatus}
        >
          <RefreshCw
            className={statusLoading ? "animate-spin" : ""}
            aria-hidden="true"
          />
          {statusLoading ? "Checking..." : "Refresh status"}
        </Button>
      </div>

      {anyDemo && (
        <div role="status" className="flex gap-3 rounded-lg border bg-muted/30 p-4 text-sm">
          <Unplug
            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <div className="space-y-1">
            <p>
              <span className="font-medium">Showing sample data.</span>{" "}
              {status.source === "demo"
                ? "Couldn't check live connections. "
                : ""}
              {modelList.source === "demo"
                ? "Couldn't load live models, so the catalog below is a sample."
                : ""}{" "}
              <a href="#setup-heading" className="font-medium underline underline-offset-4">
                See what to configure
              </a>
            </p>
            {technicalDetail && (
              <p className="font-mono text-xs text-muted-foreground">
                Technical detail: {technicalDetail}
              </p>
            )}
          </div>
        </div>
      )}
      <VitalsPanel loading={statusLoading} vitals={vitals} />

      <section className="space-y-4" aria-labelledby="setup-heading">
        <div>
          <h2 id="setup-heading" className="scroll-mt-24 text-lg font-semibold">
            Connection setup
          </h2>
          <p className="text-sm text-muted-foreground">
            Keys each service needs. Set them on the server, then refresh.
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {vitals.map((vital) => {
            const state = vitalState(vital, statusLoading);
            return (
              <div key={vital.name} className="setup-group vital-row" data-state={state}>
                <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <span className="vital-dot" aria-hidden="true" />
                    {vital.name}
                  </h3>
                  <span className="vital-state text-xs font-medium">{stateLabel[state]}</span>
                </div>
                <ul className="divide-y">
                  {vital.keys.map((key) => (
                    <li key={key.name} className="space-y-2 px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="code-chip break-all font-medium">{key.name}</code>
                        {key.secret && (
                          <span className="secret-pill">
                            <Lock className="size-3" aria-hidden="true" />
                            Secret
                          </span>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="ml-auto min-h-10"
                          aria-label={`Copy key name ${key.name}`}
                          onClick={() => void copy(key.name, "Key name")}
                        >
                          <Copy aria-hidden="true" />
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">{key.description}</p>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          Configure credentials in the server deployment environment, never in
          this UI. This demo does not collect, store, or display secrets.
        </p>
      </section>

      <section className="min-w-0 space-y-4" aria-labelledby="models-heading">
        <div>
          <h2 id="models-heading" className="text-lg font-semibold">
            {modelsAreSample ? "Sample model catalog" : "Model catalog"}
          </h2>
          <p className="text-sm text-muted-foreground">
            Click a model to copy its ID.
            {modelsAreSample ? " Sample IDs only; availability is not verified." : ""}
          </p>
        </div>
        <div className="space-y-3">
          <div className="relative max-w-xl">
            <Label htmlFor="model-search" className="sr-only">
              {modelsAreSample ? "Search sample models" : "Search models"}
            </Label>
            <Search
              className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="model-search"
              className="h-10 pl-9"
              placeholder="Search name, ID, or provider"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {presentCategories.length > 2 && (
          <div role="group" aria-label="Model category" className="flex flex-wrap gap-2">
            {presentCategories.map((item) => (
              <button
                key={item}
                type="button"
                className="filter-pill"
                aria-pressed={category === item}
                onClick={() => setCategory(item)}
              >
                {item === "all" ? "All" : item}
              </button>
            ))}
          </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {modelList.source === "loading"
            ? "Loading models…"
            : `${filtered.length} ${modelsAreSample ? "sample " : ""}${filtered.length === 1 ? "model" : "models"} in ${families.length} ${families.length === 1 ? "family" : "families"}`}
        </p>
        {filtered.length > 0 ? (
          <>
          <ul className="family-list">
            {(showAllModels ? families : families.slice(0, MODEL_PREVIEW)).map((family) => (
              <li key={family.key} className="family-row" data-brand={family.brand}>
                <div className="flex min-w-0 items-center gap-3">
                  <span className="family-bar" aria-hidden="true" />
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold">{family.name}</h3>
                    <p className="text-xs text-muted-foreground">
                      {family.provider} · {family.variants.length}{" "}
                      {family.variants.length === 1 ? "variant" : "variants"}
                    </p>
                  </div>
                </div>
                <ul className="flex flex-wrap gap-1.5" aria-label={`${family.name} variants`}>
                  {family.variants.map(({ label, model }) => (
                    <li key={model.id}>
                      <button
                        type="button"
                        className="variant-chip"
                        title={model.id}
                        aria-label={`Copy model ID ${model.id}`}
                        onClick={() =>
                          void copy(model.id, modelsAreSample ? "Sample model ID" : "Model ID")
                        }
                      >
                        {label}
                        <Copy className="size-3" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          {families.length > MODEL_PREVIEW && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                className="min-h-10"
                aria-expanded={showAllModels}
                onClick={() => setShowAllModels((value) => !value)}
              >
                {showAllModels ? "Show fewer" : `Show all ${families.length} families`}
              </Button>
            </div>
          )}
          </>
        ) : (
          modelList.source !== "loading" && (
            <div className="space-y-3 rounded-xl border p-8 text-center">
              <Search className="mx-auto size-6 text-muted-foreground" aria-hidden="true" />
              <h3 className="font-medium">No models match</h3>
              <p className="text-sm text-muted-foreground">
                {modelsAreSample
                  ? "Try another name or category. This list is a fixed demo catalog."
                  : "Try another name or category."}
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  setCategory("all");
                  setQuery("");
                }}
              >
                Clear filters
              </Button>
            </div>
          )
        )}
      </section>

      <section className="min-w-0 space-y-4" aria-labelledby="capabilities-heading">
        <div>
          <h2 id="capabilities-heading" className="text-lg font-semibold">
            Sample agent capabilities
          </h2>
          <p className="text-sm text-muted-foreground">
            Example assignments, not discovered runtime permissions.
          </p>
        </div>
        <ul className="grid gap-3 md:grid-cols-3">
          {capabilities.map((agent) => (
            <li
              key={agent.name}
              className="agent-card space-y-4"
              data-state="idle"
              style={agentLook(agent.role)}
              onPointerMove={followPointer}
              onPointerLeave={resetPointer}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 space-y-2">
                  <span className="agent-status">
                    <i aria-hidden="true" />
                    Sample
                  </span>
                  <p className="agent-name break-words">{agent.name}</p>
                  <p className="text-sm text-white/85">{agent.role}</p>
                </div>
                <AgentBot
                  name={agent.name}
                  role={agent.role}
                  asleep={false}
                  working={false}
                />
              </div>
              <ul className="flex flex-wrap gap-1.5" aria-label={`${agent.name} capabilities`}>
                {capabilityKeys.map((capability) => (
                  <li key={capability} className="cap-pill" data-on={agent[capability]}>
                    {agent[capability] && <Check className="size-3" aria-hidden="true" />}
                    {capability}
                    <span className="sr-only">
                      {agent[capability] ? ": included in sample" : ": not assigned"}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-4" aria-labelledby="cron-heading">
        <div>
          <h2 id="cron-heading" className="text-lg font-semibold">
            Cron setup example
          </h2>
          <p className="text-sm text-muted-foreground">
            Documentation sample only. Nothing has been installed or deployed.
          </p>
        </div>
        <div className="term">
          <div className="term-bar">
            <span className="term-lights" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span className="flex items-center gap-1.5 text-xs">
              <Terminal className="size-3.5" aria-hidden="true" />
              crontab · VPS
            </span>
            <button
              type="button"
              className="term-copy"
              onClick={() => void copy(cronSample, "Cron example with placeholders")}
            >
              <Copy className="size-3.5" aria-hidden="true" /> Copy
            </button>
          </div>
          <pre
            tabIndex={0}
            aria-label="Cron example with NEIRO_URL and DASHBOARD_SECRET placeholders"
            className="max-w-full overflow-x-auto p-4 text-xs leading-6"
          >
            <code>{cronSample}</code>
          </pre>
        </div>
        <div className="flex gap-3 text-sm text-muted-foreground">
          <Cable className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            Replace <code className="code-chip">&lt;NEIRO_URL&gt;</code> with your
            dashboard origin and{" "}
            <code className="code-chip">&lt;DASHBOARD_SECRET&gt;</code> with a
            server-side secret. Keep the credential out of source control and
            shared logs.
          </p>
        </div>
      </section>
    </div>
  );
}
