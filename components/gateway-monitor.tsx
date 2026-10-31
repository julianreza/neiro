"use client";

import { useState } from "react";
import { Activity, Box, Cable, Check, ChevronDown, Clock3, Copy, Database, Lock, RefreshCw, Search, Server, Terminal, Unplug } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import type { GatewayStatusDTO } from "@/lib/types";
import { DataSourceBadge, DataSourceFailure } from "@/components/data-source-badge";
import { LiveAgentCapabilities } from "@/components/live-agent-capabilities";
import {
  AgentBot,
  agentLook,
  followPointer,
  resetPointer,
} from "@/components/agent-bot";
import { modelSource } from "@/lib/model-catalog";
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
    provider: "Sample combo",
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
type CliCatalog = { installed: boolean; reason?: string; models: { id: string; name: string; group: string }[] };
const emptyCli: CliCatalog = { installed: false, models: [] };
function parseCliCatalog(json: unknown): CliCatalog {
  const info = (json as { ohmypi?: CliCatalog } | null)?.ohmypi;
  if (!info || typeof info.installed !== "boolean" || !Array.isArray(info.models)) throw new Error("Malformed runtime response");
  return info;
}


function parseStatus(json: unknown): GatewayStatusDTO | null {
  const body = json as Partial<GatewayStatusDTO> | null;
  if (!body || typeof body !== "object" || !body.checkedAt) {
    throw new Error("Malformed /api/gateway/status response");
  }
  return body as GatewayStatusDTO;
}

function parseModels(json: unknown): ModelRow[] {
  const list = (json as { models?: { id: string; providerName?: string; provider?: string }[] } | null)
    ?.models;
  if (!Array.isArray(list)) throw new Error("Malformed /api/agents/models response");
  return list.map((item) => ({
    id: item.id,
    name: item.id.split("/").pop() || item.id,
    type: "chat" as Exclude<Category, "all">,
    provider: item.providerName || item.provider || "Hermes",
  }));
}

type Vital = {
  id: string;
  icon: LucideIcon;
  name: string;
  connected: boolean;
  detail: string;
  note: string;
  keys: { name: string; description: string; secret?: boolean }[];
};
type VitalState = "alive" | "down" | "unset" | "checking" | "unknown";

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
  unknown: "Unavailable",
};

function ServicePanel({ vitals, loading, unavailable, onCopy }: {
  vitals: Vital[];
  loading: boolean;
  unavailable: boolean;
  onCopy: (value: string, label: string) => void;
}) {
  return (
    <section aria-labelledby="setup-heading" className="gateway-section">
      <div className="gateway-section-heading">
        <div><h2 id="setup-heading">Connections</h2><p>Live status of your infrastructure services.</p></div>
      </div>
      <ul className="gateway-services">
        {vitals.map((vital) => {
          const state = unavailable ? "unknown" : vitalState(vital, loading);
          const broken = state === "down" || state === "unset";
          const Icon = vital.icon;
          return (
            <li key={vital.id} className="gateway-service vital-row" data-state={state}>
              <details key={state} className="gateway-disclosure gateway-service-disclosure" open={broken || undefined}>
                <summary>
                  <span className="gateway-service-icon"><Icon aria-hidden="true" /></span>
                  <span className="gateway-service-info">
                    <span className="gateway-service-name">{vital.name}</span>
                    <span className="gateway-muted">{vital.note}</span>
                    {!loading && <span className="gateway-service-detail">{unavailable ? "Could not check this service." : vital.detail}</span>}
                  </span>
                  <span className="gateway-status" data-state={state}><i aria-hidden="true" />{stateLabel[state]}</span>
                  <span className="gateway-service-toggle">Configuration <ChevronDown aria-hidden="true" /></span>
                </summary>
                <div className="gateway-service-config">
                  <ul className="gateway-keys">
                    {vital.keys.map((key) => (
                      <li key={key.name}>
                        <code title={key.description}>{key.name}</code>
                        {key.secret && <span className="secret-pill"><Lock className="size-3" aria-hidden="true" /> Secret</span>}
                        <Button variant="ghost" size="sm" className="ml-auto min-h-10" aria-label={`Copy key name ${key.name}`} onClick={() => onCopy(key.name, "Key name")}><Copy aria-hidden="true" /></Button>
                      </li>
                    ))}
                  </ul>
                  <p className="gateway-muted">Set credentials in your server environment. Secret values are never displayed here.</p>
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function GatewayMonitor() {
  const [category, setCategory] = useState<Category>("all");
  const [expandedSources, setExpandedSources] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const status = useLiveData<GatewayStatusDTO | null>("/api/gateway/status", null, parseStatus);
  const modelList = useLiveData<ModelRow[]>("/api/agents/models", models, parseModels);
  const cli = useLiveData<CliCatalog>("/api/agents/runtimes", emptyCli, parseCliCatalog);
  const liveStatus = status.source === "live" ? status.data : null;
  const hermesModels = modelList.source === "live" || modelList.source === "demo" ? modelList.data : [];
  const cliModels: ModelRow[] = cli.source === "live" && cli.data.installed && !cli.data.reason
    ? cli.data.models.map((m) => ({ id: m.id, name: m.name.split("/").pop() || m.name, type: "chat", provider: m.group.replace(/^.*·\s*/, "") })) : [];
  const displayModels = [...hermesModels, ...cliModels];
  const modelsAreSample = modelList.source === "demo";
  const statusLoading = status.source === "loading";
  const anyDemo = status.source === "demo" || modelList.source === "demo";
  const [liveCaps, setLiveCaps] = useState(false);
  const [sampleCaps, setSampleCaps] = useState(false);
  const showLiveCaps = !anyDemo && liveCaps;
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
    cli.reload();
    toast.info("Re-checking gateway status");
  }

  const runtimes = [
    { key: "hermes", name: "Hermes", models: hermesModels, sample: modelList.source === "demo", state: modelList.source === "loading" ? "Loading models…" : modelList.source === "demo" || modelList.source === "error" ? `Live catalog unavailable: ${modelList.reason}` : "" },
    { key: "ohmypi", name: "Oh My Pi", models: cliModels, sample: false, state: cli.source === "loading" ? "Loading models…" : cli.source === "demo" || cli.source === "error" ? `Unavailable: ${cli.reason}` : !cli.data.installed ? "Not installed" : cli.data.reason ? `Unavailable: ${cli.data.reason}` : "" },
  ];
  const search = query.trim().toLowerCase();
  const filteredRuntimes = runtimes.map((runtime) => {
    const filtered = runtime.models.filter((model) => (category === "all" || model.type === category) && `${runtime.name} ${modelSource(model.id, model.provider)} ${model.name} ${model.id} ${model.provider}`.toLowerCase().includes(search));
    const sources = new Map<string, ModelRow[]>();
    for (const model of filtered) {
      const source = modelSource(model.id, model.provider);
      sources.set(source, [...(sources.get(source) ?? []), model]);
    }
    return { ...runtime, filtered, sources: [...sources.entries()] };
  });
  const filteredCount = filteredRuntimes.reduce((sum, runtime) => sum + runtime.filtered.length, 0);
  const liveModelCount = (modelList.source === "live" ? hermesModels.length : 0) + cliModels.length;
  const partialModels = modelList.source !== "live" || cli.source !== "live" || !cli.data.installed || Boolean(cli.data.reason);
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
      id: "supabase",
      icon: Database,
      name: "Supabase Postgres",
      connected: liveStatus?.supabase?.status === "connected",
      detail:
        liveStatus?.supabase?.status === "connected"
          ? `Connected${liveStatus?.supabase?.latencyMs != null ? ` (${liveStatus.supabase.latencyMs}ms)` : ""}`
          : statusLoading
            ? "Checking…"
            : liveStatus?.supabase?.error || "Database disconnected",
      note: "Missions, tasks DAG, and agent registry state.",
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
      id: "hermes",
      icon: Server,
      name: "Hermes Agent VPS",
      connected: liveStatus?.hermes?.status === "connected",
      detail:
        liveStatus?.hermes?.status === "connected"
          ? `Agent runtime ready${liveStatus?.hermes?.latencyMs != null ? ` (${liveStatus.hermes.latencyMs}ms)` : ""}`
          : statusLoading
            ? "Checking…"
            : liveStatus?.hermes?.error || "Hermes VPS unreachable",
      note: "Agent runtime. Runs every model; the model provider is set in Hermes.",
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
    <div className="gateway-page min-w-0 p-4 md:p-8">
      <div className="gateway-header flex flex-wrap items-start justify-between gap-4">
        <div className="gateway-heading">
          <span className="gateway-heading-icon"><Activity aria-hidden="true" /></span>
          <div className="space-y-2">
          <p className="eyebrow">
            Infrastructure{anyDemo ? " / demo" : ""}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">Gateway</h1>
          <p className="flex max-w-2xl flex-wrap items-center gap-2 text-sm text-muted-foreground">
            Inspect the connection map, model routes, and agent capabilities.
            <DataSourceBadge source={anyDemo ? "demo" : "live"} reason={demoReason} lastUpdated={status.source === "live" ? status.lastUpdated : undefined} staleReason={status.source === "live" ? status.staleReason : undefined} />
            {modelList.source === "live" && <DataSourceBadge source="live" lastUpdated={modelList.lastUpdated} staleReason={modelList.staleReason} />}
            {cli.source === "live" && <DataSourceBadge source="live" lastUpdated={cli.lastUpdated} staleReason={cli.staleReason} />}
          </p>
          </div>
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
        <div role="status" className="gateway-notice">
          <Unplug className="size-4 shrink-0" aria-hidden="true" />
          <div><p><strong>Some live data is unavailable.</strong> Sample data is clearly labelled below. <a href="#setup-heading">View connections</a></p>
            {technicalDetail && <details><summary>Technical details</summary><p>{technicalDetail}</p></details>}
          </div>
        </div>
      )}
      <div className="gateway-metrics" aria-label="Gateway overview">
        <div><span><Activity aria-hidden="true" /> Connections</span><strong>{status.source === "live" ? `${vitals.filter((v) => v.connected).length} / ${vitals.length}` : "—"}</strong><small>services connected</small></div>
        <div><span><Box aria-hidden="true" /> Models</span><strong>{modelList.source === "live" || (cli.source === "live" && cli.data.installed && !cli.data.reason) ? liveModelCount : "—"}</strong><small>{partialModels ? "available routes · partial" : "available routes"}</small></div>
        <div><span><Clock3 aria-hidden="true" /> Last checked</span><strong className="gateway-metric-time">{liveStatus?.checkedAt && !Number.isNaN(Date.parse(liveStatus.checkedAt)) ? new Date(liveStatus.checkedAt).toLocaleString() : "—"}</strong><small>connection status</small></div>
      </div>
      <ServicePanel loading={statusLoading} unavailable={status.source === "demo" || status.source === "error"} vitals={vitals} onCopy={(v, l) => void copy(v, l)} />

      <div className="gateway-content">
      <section className="gateway-section gateway-models min-w-0" aria-labelledby="models-heading">
        <div>
          <h2 id="models-heading" className="text-lg font-semibold">
            Model catalog
          </h2>
          <p className="text-sm text-muted-foreground">
            Click a variant to copy its model ID.
            {modelsAreSample ? " Hermes sample IDs are not verified." : ""}
          </p>
        </div>
        <div className="gateway-toolbar">
          <div className="relative gateway-search">
            <Label htmlFor="model-search" className="sr-only">
              Search models
            </Label>
            <Search
              className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="model-search"
              className="h-10 pl-9"
              placeholder="Search runtime, source, model, or ID"
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
        <p className="text-xs text-muted-foreground" aria-live="polite">{filteredCount} matching models</p>
        </div>
        {filteredRuntimes.map((runtime) => (
          <details className="catalog-runtime" key={runtime.key} open>
            <summary>{runtime.name} <span>{runtime.filtered.length} models{runtime.sample ? " · sample" : ""}</span></summary>
            {runtime.state && <p className="catalog-message" role="status">{runtime.state}</p>}
            {runtime.sources.map(([source, items]) => {
              const key = `${runtime.key}:${source}`;
              const families = groupModels(items);
              const showAll = expandedSources.includes(key);
              return (
                <details className="catalog-source" key={`${key}:${Boolean(search)}`} open={search ? true : undefined}>
                  <summary><span className="catalog-source-label">Source</span> {source} <span>{items.length} models</span></summary>
                  <ul className="family-list">
                    {(showAll ? families : families.slice(0, MODEL_PREVIEW)).map((family) => (
                      <li key={family.key} className="family-row" data-brand={family.brand}>
                        <div className="flex min-w-0 items-center gap-3"><span className="family-bar" aria-hidden="true" /><div className="min-w-0"><h3 className="truncate font-semibold">{family.name}</h3><p className="text-xs text-muted-foreground">{family.variants.length} {family.variants.length === 1 ? "variant" : "variants"}</p></div></div>
                        <ul className="flex flex-wrap gap-1.5" aria-label={`${family.name} variants`}>
                          {family.variants.map(({ label, model }) => <li key={model.id}><button type="button" className="variant-chip" title={model.id} aria-label={`Copy model ID ${model.id}`} onClick={() => void copy(model.id, runtime.sample ? "Sample model ID" : "Model ID")}>{label}<Copy className="size-3" aria-hidden="true" /></button></li>)}
                        </ul>
                      </li>
                    ))}
                  </ul>
                  {families.length > MODEL_PREVIEW && <Button variant="outline" className="min-h-10" aria-expanded={showAll} onClick={() => setExpandedSources((items) => showAll ? items.filter((item) => item !== key) : [...items, key])}>{showAll ? "Show fewer" : `Show all ${families.length} families`}</Button>}
                </details>
              );
            })}
            {!runtime.state && !runtime.filtered.length && <p className="catalog-message">No models match.</p>}
          </details>
        ))}
        {!filteredCount && (search || category !== "all") && <Button variant="outline" onClick={() => { setCategory("all"); setQuery(""); }}>Clear filters</Button>}

      </section>

      {[status, modelList, cli].map((item, index) => item.source === "error" ? <DataSourceFailure key={index} reason={item.reason} retry={item.reload} showDemo={index === 1 ? item.showDemo : undefined} /> : null)}
      <section className="gateway-section gateway-capabilities min-w-0" aria-labelledby="capabilities-heading">
        <div>
          <h2 id="capabilities-heading" className="flex items-center gap-2 text-lg font-semibold">
            {sampleCaps && !showLiveCaps ? "Sample agent capabilities" : "Agent capabilities"}
            {sampleCaps && !showLiveCaps && <DataSourceBadge source="demo" reason="Sample assignments" />}
          </h2>
          <p className="text-sm text-muted-foreground">
            {sampleCaps && !showLiveCaps ? "Example assignments, not discovered runtime permissions." : "Read from each Hermes agent: skills, toolsets, MCP servers and server features."}
          </p>
        </div>
        {!anyDemo && !statusLoading && modelList.source !== "loading" && <LiveAgentCapabilities onState={setLiveCaps} />}
        {!showLiveCaps && !sampleCaps && <button type="button" className="text-sm text-primary underline" onClick={() => setSampleCaps(true)}>View demo</button>}
        {!showLiveCaps && sampleCaps && (
        <ul className="gateway-sample-agents grid gap-3">
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
        )}
      </section>

      </div>
      <details className="gateway-deployment gateway-disclosure">
        <summary><span><Terminal aria-hidden="true" /> Deployment setup <small>Cron example</small></span><ChevronDown aria-hidden="true" /></summary>
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
      </details>
    </div>
  );
}
