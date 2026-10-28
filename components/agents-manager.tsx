"use client";

import { useRef, useState, type FormEvent } from "react";
import { useLiveData } from "@/hooks/use-live-data";
import { DataSourceBadge } from "@/components/data-source-badge";
import {
  AgentBot,
  agentColor,
  agentLook,
  followPointer,
  resetPointer,
} from "@/components/agent-bot";
import { TeamWires } from "@/components/team-wires";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Bot,
  Copy,
  FlaskConical,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  ShieldAlert,
  Trash2,
  Unplug,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

const stages = [
  { id: "orchestrator", name: "Orchestrator", detail: "Direct the mission" },
  { id: "spec", name: "Specification", detail: "Make the plan concrete" },
  { id: "workers", name: "Workers", detail: "Build in parallel" },
  { id: "qa", name: "QA", detail: "Exercise the result" },
  { id: "reviewer", name: "Reviewer", detail: "Independent final pass" },
  { id: "scheduled", name: "Scheduled", detail: "Recurring assignments" },
] as const;

type Stage = (typeof stages)[number]["id"];
type Agent = {
  id: string;
  name: string;
  role: string;
  stage: Stage;
  specialty: string;
  model: string;
  profile: string;
  prompt: string;
  url: string;
  enabled: boolean;
  activeRun: boolean;
  /** Max tokens per mission; null = no limit. */
  tokenBudget?: number | null;
};

const presets = [
  {
    role: "PM",
    stage: "orchestrator",
    specialty: "Mission planning & delegation",
    prompt:
      "Break missions into clear deliverables. Delegate work, track dependencies, and escalate blockers. Never claim work is complete without evidence.",
  },
  {
    role: "PRD",
    stage: "spec",
    specialty: "Requirements & acceptance criteria",
    prompt:
      "Turn goals into precise requirements, constraints, and testable acceptance criteria. Surface unanswered questions before implementation.",
  },
  {
    role: "Backend",
    stage: "workers",
    specialty: "Services, APIs & data models",
    prompt:
      "Implement maintainable backend services. Respect existing contracts, validate inputs, and explain evidence for correctness.",
  },
  {
    role: "Frontend",
    stage: "workers",
    specialty: "Accessible product interfaces",
    prompt:
      "Build responsive, accessible interfaces using the existing design system. Handle empty, error, and keyboard interaction states.",
  },
  {
    role: "DevOps",
    stage: "workers",
    specialty: "Infrastructure & delivery",
    prompt:
      "Plan safe infrastructure and deployment changes. Protect secrets, document rollback steps, and never deploy without authorization.",
  },
  {
    role: "Research",
    stage: "scheduled",
    specialty: "Research & source synthesis",
    prompt:
      "Research the assignment using credible sources. Cite evidence, distinguish facts from inference, and state uncertainty.",
  },
  {
    role: "Content",
    stage: "workers",
    specialty: "Editorial & content strategy",
    prompt:
      "Create clear, audience-appropriate content grounded in the supplied brief. Do not invent facts or citations.",
  },
  {
    role: "QA",
    stage: "qa",
    specialty: "Regression & acceptance testing",
    prompt:
      "Evaluate work against acceptance criteria. Report reproducible defects and clearly distinguish executed tests from proposed tests.",
  },
  {
    role: "Security",
    stage: "reviewer",
    specialty: "Security & risk review",
    prompt:
      "Review trust boundaries, permissions, and data handling. Report evidence-backed risks with practical remediation steps.",
  },
] as const;

type HermesModel = { id: string; providerName: string };
const noHermesModels: HermesModel[] = [];

function parseHermesModels(json: unknown): HermesModel[] {
  const rows = (json as { models?: unknown } | null)?.models;
  if (!Array.isArray(rows)) throw new Error("Malformed /api/agents/models response");
  return rows.flatMap((row) => {
    const r = row as { id?: unknown; providerName?: unknown };
    return typeof r.id === "string"
      ? [{ id: r.id, providerName: typeof r.providerName === "string" ? r.providerName : "" }]
      : [];
  });
}
const starters: Agent[] = [
  ["neiro", "Neiro", "PM", "Claude Opus 4.6", "coordinator", true],
  ["scribe", "Scribe", "PRD", "Claude Sonnet 4.6", "product", false],
  ["forge", "Forge", "Backend", "GPT-5.4", "engineering", false],
  ["relay", "Relay", "DevOps", "Claude Sonnet 4.6", "operations", false],
  ["muse", "Muse", "Content", "Gemini 3.1 Pro", "content", false],
  ["sentinel", "Sentinel", "QA", "GPT-5.4", "quality", false],
  ["lens", "Lens", "Security", "Claude Opus 4.6", "security", false],
  ["atlas", "Atlas", "Research", "Gemini 3.1 Pro", "research", false],
].map(([id, name, role, model, profile, activeRun]) => {
  const preset = presets.find((item) => item.role === role)!;
  return {
    id: String(id),
    name: String(name),
    role: String(role),
    model: String(model),
    profile: String(profile),
    activeRun: Boolean(activeRun),
    stage: preset.stage,
    specialty: preset.specialty,
    prompt: preset.prompt,
    url: "",
    enabled: true,
  };
});

function blankAgent(): Agent {
  return {
    id: "",
    name: "",
    role: "Backend",
    stage: "workers",
    specialty: presets[2].specialty,
    model: "",
    profile: "default",
    prompt: presets[2].prompt,
    url: "",
    enabled: true,
    activeRun: false,
  };
}

const selectClass =
  "h-10 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:text-sm";

const DEMO_READ_ONLY =
  "Demo mode: connect Supabase to add, edit or remove agents.";

function parseAgents(json: unknown): Agent[] {
  const rows = (json as { agents?: Record<string, unknown>[] } | null)?.agents;
  if (!Array.isArray(rows)) throw new Error("Malformed /api/agents response");
  return rows.map((row) => ({
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    role: String(row.role ?? ""),
    stage: (row.stage as Agent["stage"]) ?? "workers",
    specialty: String(row.specialty ?? ""),
    model: String(row.model ?? ""),
    profile: String(row.profile ?? "default"),
    prompt: String(row.prompt ?? ""),
    url: String(row.url ?? ""),
    enabled: Boolean(row.enabled ?? true),
    activeRun: Boolean(row.activeRun ?? row.active_run ?? false),
    tokenBudget: Number(row.token_budget ?? row.tokenBudget) > 0 ? Number(row.token_budget ?? row.tokenBudget) : null,
  }));
}

async function sendJson(url: string, method: string, body?: unknown): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return data.error ?? `Request failed (${res.status})`;
  } catch {
    return "Network error";
  }
}

export function AgentsManager() {
  const live = useLiveData<Agent[]>("/api/agents", starters, parseAgents);
  const readOnly = live.source !== "live";
  const agents: Agent[] = live.source === "loading" ? [] : live.data;
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<Agent | null>(null);
  // Model suggestions come from Hermes only; Hermes forwards to 9Router.
  const hermesModels = useLiveData<HermesModel[]>(
    draft ? "/api/agents/models" : null,
    noHermesModels,
    parseHermesModels,
  );
  const modelOptions = hermesModels.source === "live" ? hermesModels.data : [];
  const [deleting, setDeleting] = useState<Agent | null>(null);
  const [preview, setPreview] = useState<Agent | null>(null);
  const [probeShown, setProbeShown] = useState(false);
  const [formError, setFormError] = useState("");
  const actionOrigin = useRef<HTMLButtonElement | null>(null);

  const visible = agents.filter((agent) =>
    `${agent.name} ${agent.specialty} ${agent.role} ${agent.model} ${agent.profile}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );

  function edit(agent: Agent, trigger: HTMLButtonElement) {
    if (readOnly) {
      toast.error(DEMO_READ_ONLY);
      return;
    }
    actionOrigin.current = trigger;
    setFormError("");
    setDraft({ ...agent });
  }

  async function toggleAgent(agent: Agent, enabled: boolean) {
    if (readOnly) {
      toast.error(DEMO_READ_ONLY);
      return;
    }
    const error = await sendJson(`/api/agents/${encodeURIComponent(agent.id)}`, "PATCH", {
      enabled,
    });
    if (error) toast.error(`Could not update ${agent.name}: ${error}`);
    else toast.success(`${agent.name} ${enabled ? "enabled" : "disabled"}`);
    live.reload();
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    if (
      ![
        draft.name,
        draft.specialty,
        draft.model,
        draft.profile,
        draft.prompt,
      ].every((value) => value.trim())
    ) {
      setFormError(
        "Name, specialty, model, profile, and system prompt cannot be blank.",
      );
      return;
    }
    const isNew = !draft.id || !agents.some((a) => a.id === draft.id);
    const saved: Agent = {
      ...draft,
      id: draft.id || draft.name.toLowerCase().replace(/[^a-z0-9]/g, "-"),
      name: draft.name.trim(),
      specialty: draft.specialty.trim(),
      model: draft.model.trim(),
      profile: draft.profile.trim(),
      prompt: draft.prompt.trim(),
      url: draft.url.trim(),
    };

    const error = isNew
      ? await sendJson("/api/agents", "POST", saved)
      : await sendJson(`/api/agents/${encodeURIComponent(saved.id)}`, "PATCH", saved);
    if (error) {
      setFormError(`Could not save: ${error}`);
      return;
    }
    setDraft(null);
    toast.success(`${saved.name} saved`);
    live.reload();
  }

  async function restore() {
    if (readOnly) {
      toast.error(DEMO_READ_ONLY);
      return;
    }
    const error = await sendJson("/api/agents/seed", "POST");
    if (error) {
      toast.error(`Could not restore starters: ${error}`);
      return;
    }
    setSearch("");
    toast.success("Starter team restored");
    live.reload();
  }

  function restoreFocus(event: Event) {
    event.preventDefault();
    if (actionOrigin.current?.isConnected) actionOrigin.current.focus();
    else document.getElementById("new-demo-agent")?.focus();
  }

  const laneLook = (id: Stage): React.CSSProperties => {
    const lead = visible.find((agent) => agent.stage === id);
    return lead ? agentLook(lead.role) : {};
  };

  const renderLane = (stage: (typeof stages)[number], index: number) => {
    const members = visible.filter((agent) => agent.stage === stage.id);
    return (
      <section
        key={stage.id}
        className="console-lane min-w-0 space-y-3"
        aria-labelledby={`stage-${stage.id}`}
        data-stage={stage.id}
        style={laneLook(stage.id)}
      >
        <div className="lane-head border-b pb-3">
          <div>
            <h2
              id={`stage-${stage.id}`}
              className="flex items-center gap-2 font-semibold"
            >
              {stage.name}
              <span
                className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground"
                aria-label={`${members.length} ${members.length === 1 ? "agent" : "agents"}`}
              >
                {members.length}
              </span>
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {stage.detail}
            </p>
          </div>
        </div>
        {members.map((agent, memberIndex) => (
          <article
            key={agent.id}
            className="agent-card space-y-4"
            data-state={
              !agent.enabled ? "asleep" : agent.activeRun ? "working" : "idle"
            }
            style={
              {
                "--i": index + memberIndex,
                ...agentLook(agent.role),
              } as React.CSSProperties
            }
            onPointerMove={followPointer}
            onPointerLeave={resetPointer}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="agent-status">
                    <i aria-hidden="true" />
                    {!agent.enabled
                      ? "Paused"
                      : agent.activeRun
                        ? "Working"
                        : "Online"}
                  </span>
                  {readOnly && <span className="agent-status">Demo</span>}
                </div>
                <h3 className="agent-name break-words">{agent.name}</h3>
                <p className="break-words text-sm text-white/85">
                  {agent.specialty}
                </p>
              </div>
              <AgentBot
                name={agent.name}
                role={agent.role}
                asleep={!agent.enabled}
                working={agent.activeRun}
              />
            </div>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-xs">
              <dt className="text-white/70">Model</dt>
              <dd className="break-words">{agent.model || "Hermes default"}</dd>
              <dt className="text-white/70">Profile</dt>
              <dd className="min-w-0">
                <code className="agent-chip break-all">{agent.profile}</code>
              </dd>
            </dl>
            <div className="flex min-h-11 items-center justify-between gap-2 border-y border-white/20 py-2">
              <Label
                htmlFor={`enabled-${agent.id}`}
                className="text-xs"
              >
                {agent.enabled ? "Enabled" : "Disabled"}
              </Label>
              <Switch
                id={`enabled-${agent.id}`}
                disabled={readOnly}
                title={readOnly ? DEMO_READ_ONLY : undefined}
                checked={agent.enabled}
                onCheckedChange={(enabled) =>
                  toggleAgent(agent, enabled)
                }
              />
            </div>
            {agent.activeRun && (
              <p className="flex items-start gap-2 rounded-xl bg-black/25 p-2 text-xs text-amber-100">
                <ShieldAlert className="size-4 shrink-0" />
                {readOnly
                  ? "Demo run M-104 assigned. Deletion blocked until released."
                  : "Assigned to an active run. Deletion is blocked until the run ends."}
              </p>
            )}
            <div className="flex flex-wrap gap-1">
              <Button
                className="agent-pill min-h-10"
                onClick={(event) => {
                  actionOrigin.current = event.currentTarget;
                  setPreview(agent);
                  setProbeShown(false);
                }}
              >
                <FlaskConical />
                Preview
              </Button>
              <Button
                className="agent-icon min-h-10"
                variant="ghost"
                aria-label={`Edit ${agent.name}`}
                disabled={readOnly}
                title={readOnly ? DEMO_READ_ONLY : undefined}
                onClick={(event) => edit(agent, event.currentTarget)}
              >
                <Pencil />
                <span className="sr-only">Edit</span>
              </Button>
              <Button
                className="agent-icon min-h-10"
                variant="ghost"
                aria-label={`Clone ${agent.name}`}
                disabled={readOnly}
                title={readOnly ? DEMO_READ_ONLY : undefined}
                onClick={(event) =>
                  edit(
                    {
                      ...agent,
                      id: "",
                      name: `${agent.name} copy`,
                      activeRun: false,
                    },
                    event.currentTarget,
                  )
                }
              >
                <Copy />
                <span className="sr-only">Clone</span>
              </Button>
              <Button
                className="agent-icon min-h-10"
                variant="ghost"
                aria-label={`Delete ${agent.name}`}
                disabled={readOnly}
                title={readOnly ? DEMO_READ_ONLY : undefined}
                onClick={(event) => {
                  actionOrigin.current = event.currentTarget;
                  setDeleting(agent);
                }}
              >
                <Trash2 />
                <span className="sr-only">Delete</span>
              </Button>
            </div>
          </article>
        ))}
        {!members.length && (
          <div className="team-empty rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
            {search
              ? "No matches in this stage."
              : "No specialist assigned."}
            <Button
              className="mt-3 flex min-h-10"
              variant="outline"
              onClick={(event) =>
                edit(
                  { ...blankAgent(), stage: stage.id },
                  event.currentTarget,
                )
              }
            >
              Add to {stage.name.toLowerCase()}
            </Button>
          </div>
        )}
      </section>
    );
  };

  return (
    <div className="space-y-8 p-4 md:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <p className="eyebrow">
            People, translated into agents
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">AI team</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Define each specialist, then place them where they belong in the
            mission.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            className="min-h-10"
            variant="outline"
            onClick={restore}
            disabled={readOnly}
            title={readOnly ? DEMO_READ_ONLY : undefined}
          >
            <RotateCcw />
            Restore starters
          </Button>
          <Button
            id="new-demo-agent"
            className="console-launch min-h-10"
            disabled={readOnly}
            title={readOnly ? DEMO_READ_ONLY : undefined}
            onClick={(event) => edit(blankAgent(), event.currentTarget)}
          >
            <Plus />
            New agent
          </Button>
        </div>
      </header>

      {live.source === "demo" && (
        <div
          role="status"
          className="flex items-start gap-3 border border-dashed bg-muted/30 p-4 text-sm"
        >
          <Unplug className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div>
            <span className="flex flex-wrap items-center gap-2 font-medium">
              Demo workspace. No agents connected.
              <DataSourceBadge source="demo" reason={live.reason} />
            </span>
            <p className="mt-1 text-muted-foreground">
              The profiles below are sample data and cannot be changed here. No
              requests are sent to a gateway or model provider. Connect Supabase
              to manage your real team.
            </p>
          </div>
        </div>
      )}

      {live.source === "loading" && (
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="Loading agents">
          <Skeleton className="h-56 w-full" />
          <Skeleton className="h-56 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      )}

      <section
        className="flex flex-wrap items-end justify-between gap-4"
        aria-label="Team filters"
      >
        <div className="w-full space-y-2 sm:max-w-sm">
          <Label htmlFor="agent-search">Find a specialist</Label>
          <div className="relative">
            <Search className="absolute top-3 left-3 size-4 text-muted-foreground" />
            <Input
              id="agent-search"
              className="h-10 pl-9 text-base sm:text-sm"
              placeholder="Search name, model, role, or profile"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {visible.length} of {agents.length} {readOnly ? "demo " : ""}agents ·{" "}
          {agents.filter((agent) => agent.enabled).length} enabled
        </p>
      </section>

      {live.source === "loading" ? null : visible.length === 0 ? (
        <section className="flex min-h-64 flex-col items-center justify-center gap-4 border border-dashed p-8 text-center">
          <Bot className="size-8 text-muted-foreground" />
          <div>
            <h2 className="font-semibold">
              {agents.length
                ? "No matching specialists"
                : "A team starts with one specialist"}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {agents.length
                ? "Try a different name, model, or profile."
                : "Create an agent or restore the starter team."}
            </p>
          </div>
          {agents.length ? (
            <Button variant="outline" onClick={() => setSearch("")}>
              Clear search
            </Button>
          ) : (
            <Button
              onClick={(event) => edit(blankAgent(), event.currentTarget)}
              disabled={readOnly}
              title={readOnly ? DEMO_READ_ONLY : undefined}
            >
              <Plus />
              Create agent
            </Button>
          )}
        </section>
      ) : (
        <div className="team-tree">
          {(() => {
            const [root, ...branches] = stages;
            const isLive = (id: Stage) =>
              visible.some((agent) => agent.stage === id && agent.enabled);
            const anyLive = visible.some((agent) => agent.enabled);
            const middle = (branches.length - 1) / 2;
            return (
              <>
                <TeamWires
                  wires={branches.map((stage) => {
                    const lead = visible.find((a) => a.stage === stage.id);
                    return {
                      id: stage.id,
                      color: lead ? agentColor(lead.role) : "var(--primary)",
                      live: isLive(stage.id),
                    };
                  })}
                />
                <div className="team-root">{renderLane(root, 0)}</div>
                <div
                  className="team-trunk"
                  aria-hidden="true"
                  data-live={anyLive || undefined}
                />
                <div
                  className="team-branches"
                  style={
                    { "--branch-count": branches.length } as React.CSSProperties
                  }
                >
                  {branches.map((stage, i) => (
                    <div
                      key={stage.id}
                      className="team-branch"
                      data-live={isLive(stage.id) || undefined}
                      data-side={i < middle ? "left" : "right"}
                      style={
                        { "--b": i, ...laneLook(stage.id) } as React.CSSProperties
                      }
                    >
                      <span className="team-pulse" aria-hidden="true" />
                      {renderLane(stage, i + 1)}
                    </div>
                  ))}
                </div>
              </>
            );
          })()}
        </div>
      )}

      <Dialog
        open={draft !== null}
        onOpenChange={(open) => {
          if (!open) setDraft(null);
        }}
      >
        <DialogContent
          className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"
          onCloseAutoFocus={restoreFocus}
        >
          <DialogHeader>
            <DialogTitle>
              {draft?.id ? "Edit agent" : "New agent"}
            </DialogTitle>
            <DialogDescription>
              Local configuration only. No deployment, connection, or model
              request occurs.
            </DialogDescription>
          </DialogHeader>
          {draft && (
            <form className="space-y-4" onSubmit={save}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="agent-name">Agent name</Label>
                  <Input
                    id="agent-name"
                    required
                    maxLength={80}
                    value={draft.name}
                    onChange={(event) =>
                      setDraft({ ...draft, name: event.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="agent-role">Role preset</Label>
                  <select
                    id="agent-role"
                    className={selectClass}
                    value={draft.role}
                    onChange={(event) => {
                      const preset = presets.find(
                        (item) => item.role === event.target.value,
                      )!;
                      setDraft({
                        ...draft,
                        role: preset.role,
                        stage: preset.stage,
                        specialty: preset.specialty,
                        prompt: preset.prompt,
                      });
                    }}
                  >
                    {presets.map((preset) => (
                      <option key={preset.role}>{preset.role}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="agent-stage">Stage</Label>
                  <select
                    id="agent-stage"
                    className={selectClass}
                    value={draft.stage}
                    onChange={(event) =>
                      setDraft({ ...draft, stage: event.target.value as Stage })
                    }
                  >
                    {stages.map((stage) => (
                      <option key={stage.id} value={stage.id}>
                        {stage.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="agent-profile">Hermes profile</Label>
                  <Input
                    id="agent-profile"
                    required
                    maxLength={100}
                    value={draft.profile}
                    onChange={(event) =>
                      setDraft({ ...draft, profile: event.target.value })
                    }
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="agent-specialty">Specialty</Label>
                <Input
                  id="agent-specialty"
                  required
                  maxLength={160}
                  value={draft.specialty}
                  onChange={(event) =>
                    setDraft({ ...draft, specialty: event.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="agent-model">Model</Label>
                <Input
                  id="agent-model"
                  list="agent-model-options"
                  maxLength={160}
                  value={draft.model}
                  placeholder="Hermes default"
                  onChange={(event) =>
                    setDraft({ ...draft, model: event.target.value })
                  }
                  aria-describedby="agent-model-help"
                />
                <datalist id="agent-model-options">
                  {modelOptions.map((model) => (
                    <option key={model.id} value={model.id} label={model.providerName} />
                  ))}
                </datalist>
                <p
                  id="agent-model-help"
                  className="text-xs text-muted-foreground"
                >
                  Leave empty to use the model of the Hermes profile.{" "}
                  {hermesModels.source === "loading"
                    ? "Loading models from Hermes…"
                    : hermesModels.source === "live"
                      ? `${modelOptions.length} models available in Hermes.`
                      : `Hermes models unavailable: ${hermesModels.reason}.`}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="agent-token-budget">Token budget per mission</Label>
                <Input
                  id="agent-token-budget"
                  type="number"
                  min="0"
                  step="1000"
                  inputMode="numeric"
                  placeholder="No limit"
                  value={draft.tokenBudget ?? ""}
                  onChange={(event) => {
                    const n = Number.parseInt(event.target.value, 10);
                    setDraft({ ...draft, tokenBudget: Number.isFinite(n) && n > 0 ? n : null });
                  }}
                  aria-describedby="agent-token-budget-help"
                />
                <p id="agent-token-budget-help" className="text-xs text-muted-foreground">
                  This agent stops at Needs you after using this many tokens in one mission. Empty means no limit.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="agent-prompt">System prompt</Label>
                <Textarea
                  id="agent-prompt"
                  className="min-h-28"
                  required
                  maxLength={12000}
                  value={draft.prompt}
                  onChange={(event) =>
                    setDraft({ ...draft, prompt: event.target.value })
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Changing a role preset replaces the specialty, stage, and
                  prompt.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="agent-url">Provider URL (optional)</Label>
                  <Input
                    id="agent-url"
                    type="url"
                    placeholder="https://gateway.example/v1"
                    value={draft.url}
                    onChange={(event) =>
                      setDraft({ ...draft, url: event.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="agent-key">
                    API key (optional, discarded)
                  </Label>
                  <Input
                    id="agent-key"
                    type="password"
                    autoComplete="off"
                    aria-describedby="agent-key-help"
                  />
                  <p
                    id="agent-key-help"
                    className="text-xs text-muted-foreground"
                  >
                    Do not enter a real secret. Masked while typing; never
                    saved, echoed, or sent. Cleared when this dialog closes.
                  </p>
                </div>
              </div>
              <div className="flex min-h-11 items-center gap-3">
                <Switch
                  id="agent-form-enabled"
                  checked={draft.enabled}
                  onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}
                />
                <Label htmlFor="agent-form-enabled">Enabled</Label>
              </div>
              {formError && (
                <p role="alert" className="text-sm text-destructive">
                  {formError}
                </p>
              )}
              <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
                <Button
                  className="min-h-10"
                  type="button"
                  variant="outline"
                  onClick={() => setDraft(null)}
                >
                  Cancel
                </Button>
                <Button className="min-h-10" type="submit">
                  Save agent
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <DialogContent onCloseAutoFocus={restoreFocus}>
          <DialogHeader>
            <DialogTitle>
              {deleting?.activeRun
                ? "Active run blocks deletion"
                : `Delete ${deleting?.name ?? "agent"}?`}
            </DialogTitle>
            <DialogDescription>
              {deleting?.activeRun
                ? "This agent is assigned to an active run. Stop or finish the run on Mission control, then delete the agent."
                : "This permanently removes the agent from Supabase. Starter agents can be restored; custom agents cannot be recovered."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              className="min-h-10"
              variant="outline"
              onClick={() => setDeleting(null)}
            >
              Cancel
            </Button>
            {deleting?.activeRun ? null : (
              <Button
                className="min-h-10"
                variant="destructive"
                onClick={async () => {
                  if (!deleting) return;
                  const error = await sendJson(
                    `/api/agents/${encodeURIComponent(deleting.id)}`,
                    "DELETE",
                  );
                  if (error) toast.error(`Could not delete ${deleting.name}: ${error}`);
                  else toast.success(`${deleting.name} deleted`);
                  setDeleting(null);
                  live.reload();
                }}
              >
                Delete agent
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
      >
        <DialogContent onCloseAutoFocus={restoreFocus}>
          <DialogHeader>
            <DialogTitle>{preview?.name}: demo capability preview</DialogTitle>
            <DialogDescription>
              Not connected. This is a static configuration preview, not a probe
              of Hermes, a provider, or a model.
            </DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 text-sm">
            <dt className="text-muted-foreground">Role</dt>
            <dd>{preview?.role}</dd>
            <dt className="text-muted-foreground">Model</dt>
            <dd className="break-words">{preview?.model || "Hermes default"}</dd>
            <dt className="text-muted-foreground">Profile</dt>
            <dd className="break-words">{preview?.profile}</dd>
            <dt className="text-muted-foreground">Connection</dt>
            <dd>Not connected</dd>
          </dl>
          <Button
            className="min-h-10"
            variant="outline"
            onClick={() => setProbeShown(true)}
          >
            <FlaskConical />
            Show demo probe result
          </Button>
          {probeShown && (
            <div
              role="status"
              className="space-y-2 border border-dashed bg-muted/30 p-4 text-sm"
            >
              <p className="font-medium">
                Demo result: capabilities unverified
              </p>
              <p className="text-muted-foreground">
                Tool calling, structured output, streaming, context limits, and
                model availability require a real connection. No network probe
                was executed.
              </p>
            </div>
          )}
          <Button
            className="min-h-10"
            variant="outline"
            onClick={() => setPreview(null)}
          >
            Close preview
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
