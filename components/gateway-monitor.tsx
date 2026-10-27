"use client";

import { useEffect, useState } from "react";
import { Cable, Check, Copy, RefreshCw, Search, Unplug } from "lucide-react";
import { toast } from "sonner";
import type { GatewayStatusDTO } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
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

export function GatewayMonitor() {
  const [category, setCategory] = useState<Category>("all");
  const [query, setQuery] = useState("");
  const [liveStatus, setLiveStatus] = useState<GatewayStatusDTO | null>(null);
  const [displayModels, setDisplayModels] = useState<typeof models>(models);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let ignore = false;
    async function fetchStatus() {
      try {
        const [statusRes, modelsRes] = await Promise.all([
          fetch("/api/gateway/status"),
          fetch("/api/gateway/models"),
        ]);
        if (!ignore && statusRes.ok) {
          const s = await statusRes.json();
          setLiveStatus(s);
        }
        if (!ignore && modelsRes.ok) {
          const m = await modelsRes.json();
          if (Array.isArray(m.models) && m.models.length > 0) {
            setDisplayModels(
              m.models.map((item: { id: string; owned_by?: string }) => ({
                id: item.id,
                name: item.id.split("/").pop() || item.id,
                type: "chat" as Exclude<Category, "all">,
                provider: item.owned_by || "9Router",
              })),
            );
          }
        }
      } catch {
        // Keep initial values
      }
    }
    fetchStatus();
    return () => {
      ignore = true;
    };
  }, []);

  async function refreshStatus() {
    setRefreshing(true);
    try {
      const [statusRes, modelsRes] = await Promise.all([
        fetch("/api/gateway/status"),
        fetch("/api/gateway/models"),
      ]);
      if (statusRes.ok) {
        const s = await statusRes.json();
        setLiveStatus(s);
      }
      if (modelsRes.ok) {
        const m = await modelsRes.json();
        if (Array.isArray(m.models) && m.models.length > 0) {
          setDisplayModels(
            m.models.map((item: { id: string; owned_by?: string }) => ({
              id: item.id,
              name: item.id.split("/").pop() || item.id,
              type: "chat" as Exclude<Category, "all">,
              provider: item.owned_by || "9Router",
            })),
          );
        }
      }
      toast.success("Gateway status updated");
    } catch {
      toast.error("Failed to refresh gateway status");
    } finally {
      setRefreshing(false);
    }
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
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Infrastructure / demo
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">Gateway</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Inspect the connection map, sample model routes, and agent
            capabilities before connecting your infrastructure.
          </p>
        </div>
        <Button
          variant="outline"
          className="min-h-10"
          disabled={refreshing}
          onClick={refreshStatus}
        >
          <RefreshCw
            className={refreshing ? "animate-spin" : ""}
            aria-hidden="true"
          />
          {refreshing ? "Checking..." : "Refresh status"}
        </Button>
      </div>

      <div className="flex gap-3 rounded-lg border bg-muted/30 p-4 text-sm">
        <Unplug
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <p>
          <span className="font-medium">Disconnected demo.</span> No health
          checks or environment inspection have run. Models, capabilities, and
          connection details below are illustrative, not live telemetry.
        </p>
      </div>

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
                  : "Database disconnected",
              note: "Missions, tasks DAG, and agent registry state.",
            },
            {
              name: "9Router Gateway",
              connected: liveStatus?.nineRouter?.status === "connected",
              detail:
                liveStatus?.nineRouter?.status === "connected"
                  ? `Online (${displayModels.length} models, ${liveStatus?.nineRouter?.latencyMs ?? 0}ms)`
                  : "LLM Gateway unreachable",
              note: "LLM inference router and model discovery.",
            },
            {
              name: "Hermes Agent VPS",
              connected: liveStatus?.hermes?.status === "connected",
              detail:
                liveStatus?.hermes?.status === "connected"
                  ? `Agent runtime ready (${liveStatus?.hermes?.latencyMs ?? 0}ms)`
                  : "Hermes VPS skipped (local testing)",
              note: "Autonomous coding agent runtime.",
            },
          ].map((vital) => (
            <div key={vital.name} className="card-trendy space-y-4 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold tracking-tight text-base text-amber-500">
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
                      <Check
                        className="size-3 mr-1 text-emerald-400"
                        aria-hidden="true"
                      />{" "}
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
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4" aria-labelledby="setup-heading">
        <div>
          <h2 id="setup-heading" className="text-lg font-semibold">
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
              <code className="break-all text-xs font-medium">{key}</code>
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
            Sample model catalog
          </h2>
          <p className="text-sm text-muted-foreground">
            Illustrative IDs only. Availability, permissions, and pricing are
            not verified.
          </p>
        </div>
        <div className="grid items-end gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <div className="space-y-2">
            <Label htmlFor="model-search">Search sample models</Label>
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
          {filtered.length} sample {filtered.length === 1 ? "model" : "models"}
        </p>
        <div className="console-table min-w-0 overflow-hidden rounded-lg border">
          <Table className="min-w-[680px]">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Model</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Sample ID</TableHead>
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
                  <TableCell className="font-mono text-xs">
                    {model.id}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {model.provider}
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="min-h-10"
                      aria-label={`Copy sample ID ${model.id}`}
                      onClick={() => void copy(model.id, "Sample model ID")}
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
              <h3 className="font-medium">No sample models match</h3>
              <p className="text-sm text-muted-foreground">
                Try another name or category. This list is a fixed demo catalog.
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
