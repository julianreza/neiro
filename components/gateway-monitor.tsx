"use client";

import { useState } from "react";
import { Cable, Check, Copy, RefreshCw, Search, Unplug } from "lucide-react";
import { toast } from "sonner";
import type { GatewayStatusDTO } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { DataSourceBadge } from "@/components/data-source-badge";
import { useLiveData } from "@/hooks/use-live-data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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
const setup = [
  ["SUPABASE_URL", "Supabase project URL for persistent dashboard data."],
  [
    "SUPABASE_SERVICE_ROLE_KEY",
    "Server-only service role credential. Never expose it in browser code.",
  ],
  ["HERMES_DEFAULT_URL", "Default Hermes agent endpoint on your VPS."],
  [
    "HERMES_DEFAULT_KEY",
    "Server-only authentication key for the Hermes endpoint.",
  ],
  [
    "NINEROUTER_URL",
    "9Router gateway base URL for model discovery and inference routing.",
  ],
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

export function GatewayMonitor() {
  const [category, setCategory] = useState<Category>("all");
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

      <section aria-labelledby="gateway-vitals" className="space-y-4">
        <h2 id="gateway-vitals" className="text-lg font-semibold">
          Connection vitals
        </h2>
        <div className="grid gap-4 lg:grid-cols-3">
          {[
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
              accent: "emerald",
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
              accent: "sky",
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
              accent: "violet",
            },
          ].map((vital, index) => (
            <div
              key={vital.name}
              className="card-trendy space-y-4 p-5"
              data-accent={vital.accent}
              style={{ "--i": index } as React.CSSProperties}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold tracking-tight text-base">
                  {vital.name}
                </h3>
                <Badge
                  variant="outline"
                  className={
                    vital.connected
                      ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/10 text-[10px]"
                      : "border-border text-muted-foreground bg-secondary/50 text-[10px]"
                  }
                >
                  {vital.connected ? (
                    <>
                      <span className="pulse-dot mr-1.5" aria-hidden="true" />
                      Connected
                    </>
                  ) : (
                    <>
                      <Unplug
                        className="size-3 mr-1 text-muted-foreground"
                        aria-hidden="true"
                      />{" "}
                      Disconnected
                    </>
                  )}
                </Badge>
              </div>
              <p className="text-sm font-medium">{vital.detail}</p>
              <p className="text-xs text-muted-foreground">{vital.note}</p>
              {!vital.connected && !statusLoading && (
                <a
                  href="#setup-heading"
                  className="inline-flex min-h-10 items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline"
                >
                  <Cable className="size-3.5" aria-hidden="true" />
                  Set <code className="code-chip">{vital.envKeys}</code>{" "}
                  to connect
                </a>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4" aria-labelledby="setup-heading">
        <div>
          <h2 id="setup-heading" className="scroll-mt-24 text-lg font-semibold">
            Connection setup
          </h2>
          <p className="text-sm text-muted-foreground">
            Configuration reference only. These keys have not been read or
            validated.
          </p>
        </div>
        <div className="divide-y rounded-lg border">
          {setup.map(([key, description]) => (
            <div key={key} className="grid gap-2 p-4 lg:grid-cols-[19rem_1fr]">
              <code className="code-chip self-start break-all font-medium">{key}</code>
              <p className="text-sm text-muted-foreground">{description}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Configure credentials in the server deployment environment, never in
          this UI. This demo does not collect, store, or display secrets.
          Connecting these services requires a backend implementation.
        </p>
      </section>

      <section className="min-w-0 space-y-4" aria-labelledby="models-heading">
        <div>
          <h2 id="models-heading" className="text-lg font-semibold">
            {modelsAreSample ? "Sample model catalog" : "Model catalog"}
          </h2>
          <p className="text-sm text-muted-foreground">
            Illustrative IDs only. Availability, permissions, and pricing are
            not verified.
          </p>
        </div>
        <div className="grid items-end gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <div className="space-y-2">
            <Label htmlFor="model-search">
              {modelsAreSample ? "Search sample models" : "Search models"}
            </Label>
            <div className="relative">
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
          </div>
          <div className="space-y-2">
            <Label htmlFor="model-category">Model category</Label>
            <select
              id="model-category"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-base focus-visible:outline-2 focus-visible:outline-ring sm:text-sm"
              value={category}
              onChange={(event) => setCategory(event.target.value as Category)}
            >
              {categories.map((value) => (
                <option key={value} value={value}>
                  {value === "all"
                    ? "All categories"
                    : value[0].toUpperCase() + value.slice(1)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {modelList.source === "loading"
            ? "Loading models…"
            : `${filtered.length} ${modelsAreSample ? "sample " : ""}${filtered.length === 1 ? "model" : "models"}`}
        </p>
        <div className="console-table min-w-0 overflow-hidden rounded-lg border">
          <Table className="min-w-[680px]">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Model</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>{modelsAreSample ? "Sample ID" : "Model ID"}</TableHead>
                <TableHead>Provider / route</TableHead>
                <TableHead className="pr-4 text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((model) => (
                <TableRow key={model.id}>
                  <TableCell className="pl-4 font-medium">
                    {model.name}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{model.type}</Badge>
                  </TableCell>
                  <TableCell>
                    <code className="code-chip">{model.id}</code>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {model.provider}
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="min-h-10"
                      aria-label={`Copy model ID ${model.id}`}
                      onClick={() =>
                        void copy(model.id, modelsAreSample ? "Sample model ID" : "Model ID")
                      }
                    >
                      <Copy aria-hidden="true" /> Copy ID
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {filtered.length === 0 && (
            <div className="space-y-3 p-8 text-center">
              <Search
                className="mx-auto size-6 text-muted-foreground"
                aria-hidden="true"
              />
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
          )}
        </div>
      </section>

      <section
        className="min-w-0 space-y-4"
        aria-labelledby="capabilities-heading"
      >
        <div>
          <h2 id="capabilities-heading" className="text-lg font-semibold">
            Sample agent capabilities
          </h2>
          <p className="text-sm text-muted-foreground">
            Example assignments, not discovered runtime permissions. Check means
            included in this sample; a dash means not assigned.
          </p>
        </div>
        <div className="console-table min-w-0 overflow-hidden rounded-lg border">
          <Table className="min-w-[600px]">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Agent · demo</TableHead>
                {["Chat", "Web", "Image", "Embedding", "Search"].map(
                  (heading) => (
                    <TableHead key={heading} className="text-center">
                      {heading}
                    </TableHead>
                  ),
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {capabilities.map((agent) => (
                <TableRow key={agent.name}>
                  <TableCell className="pl-4">
                    <p className="font-medium">{agent.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {agent.role}
                    </p>
                  </TableCell>
                  {(
                    ["chat", "web", "image", "embedding", "search"] as const
                  ).map((capability) => (
                    <TableCell key={capability} className="text-center">
                      {agent[capability] ? (
                        <Check
                          className="mx-auto size-4 text-primary"
                          aria-hidden="true"
                        />
                      ) : (
                        <span
                          aria-hidden="true"
                          className="text-muted-foreground"
                        >
                          —
                        </span>
                      )}
                      <span className="sr-only">
                        {agent[capability]
                          ? "Included in sample"
                          : "Not assigned in sample"}
                      </span>
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="space-y-4" aria-labelledby="cron-heading">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 id="cron-heading" className="text-lg font-semibold">
              Cron setup example
            </h2>
            <p className="text-sm text-muted-foreground">
              Documentation sample only. Nothing has been installed or deployed.
            </p>
          </div>
          <Button
            variant="outline"
            className="min-h-10"
            onClick={() =>
              void copy(cronSample, "Cron example with placeholders")
            }
          >
            <Copy aria-hidden="true" /> Copy example
          </Button>
        </div>
        <pre
          tabIndex={0}
          aria-label="Cron example with NEIRO_URL and DASHBOARD_SECRET placeholders"
          className="max-w-full overflow-x-auto rounded-lg border bg-muted/30 p-4 text-xs leading-6"
        >
          <code>{cronSample}</code>
        </pre>
        <div className="flex gap-3 text-sm text-muted-foreground">
          <Cable className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            Replace <code className="text-xs">&lt;NEIRO_URL&gt;</code> with your
            dashboard origin and{" "}
            <code className="text-xs">&lt;DASHBOARD_SECRET&gt;</code> with a
            server-side secret. The future backend must implement and
            authenticate this tick endpoint before use. Keep the credential out
            of source control and shared logs.
          </p>
        </div>
      </section>
    </div>
  );
}
