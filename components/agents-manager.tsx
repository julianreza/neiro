"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
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
import { Badge } from "@/components/ui/badge";
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

const models = [
  "Claude Sonnet 4.6",
  "Claude Opus 4.6",
  "GPT-5.4",
  "Gemini 3.1 Pro",
  "DeepSeek V3.2",
  "Qwen3 Coder",
];
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
    model: models[0],
    profile: "default",
    prompt: presets[2].prompt,
    url: "",
    enabled: true,
    activeRun: false,
  };
}

const selectClass =
  "h-10 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:text-sm";

export function AgentsManager() {
  const [agents, setAgents] = useState<Agent[]>(starters);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<Agent | null>(null);
  const [deleting, setDeleting] = useState<Agent | null>(null);
  const [preview, setPreview] = useState<Agent | null>(null);
  const [probeShown, setProbeShown] = useState(false);
  const [formError, setFormError] = useState("");
  const actionOrigin = useRef<HTMLButtonElement | null>(null);

  async function loadAgents() {
    try {
      const res = await fetch("/api/agents");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.agents) && data.agents.length > 0) {
          setAgents(data.agents);
        }
      }
    } catch {
      // Keep starters
    }
  }

  useEffect(() => {
    let ignore = false;
    async function init() {
      try {
        const res = await fetch("/api/agents");
        if (res.ok) {
          const data = await res.json();
          if (!ignore && Array.isArray(data.agents) && data.agents.length > 0) {
            setAgents(data.agents);
          }
        }
      } catch {
        // Keep starters
      }
    }
    init();
    return () => {
      ignore = true;
    };
  }, []);

  const visible = agents.filter((agent) =>
    `${agent.name} ${agent.specialty} ${agent.role} ${agent.model} ${agent.profile}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );

  function edit(agent: Agent, trigger: HTMLButtonElement) {
    actionOrigin.current = trigger;
    setFormError("");
    setDraft({ ...agent });
  }

  async function toggleAgent(agent: Agent, enabled: boolean) {
    setAgents((current) =>
      current.map((item) =>
        item.id === agent.id ? { ...item, enabled } : item,
      ),
    );
    try {
      const res = await fetch(`/api/agents/${agent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (res.ok) {
        toast.success(`${agent.name} ${enabled ? "enabled" : "disabled"}`);
      }
    } catch {
      toast.error("Database sync failed");
    }
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

    setAgents((current) =>
      !isNew
        ? current.map((agent) => (agent.id === draft.id ? saved : agent))
        : [...current, saved],
    );
    setDraft(null);

    try {
      if (isNew) {
        await fetch("/api/agents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(saved),
        });
      } else {
        await fetch(`/api/agents/${saved.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(saved),
        });
      }
      toast.success(`${saved.name} saved to Supabase`);
    } catch {
      toast.error("Saved locally");
    }
  }

  async function restore() {
    try {
      const res = await fetch("/api/agents/seed", { method: "POST" });
      if (res.ok) {
        await loadAgents();
        setSearch("");
        toast.success("Starter team restored in Supabase");
        return;
      }
    } catch {
      // fallback
    }
    setAgents(starters);
    setSearch("");
    toast.success("Starter team restored");
  }

  function restoreFocus(event: Event) {
    event.preventDefault();
    if (actionOrigin.current?.isConnected) actionOrigin.current.focus();
    else document.getElementById("new-demo-agent")?.focus();
  }

  return (
    <div className="space-y-8 p-4 md:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
            People, translated into agents
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">AI team</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Define each specialist, then place them where they belong in the
            mission.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button className="min-h-10" variant="outline" onClick={restore}>
            <RotateCcw />
            Restore starters
          </Button>
          <Button
            id="new-demo-agent"
            className="console-launch min-h-10"
            onClick={(event) => edit(blankAgent(), event.currentTarget)}
          >
            <Plus />
            New agent
          </Button>
        </div>
      </header>

      <div className="flex items-start gap-3 border border-dashed bg-muted/30 p-4 text-sm">
        <Unplug className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div>
          <span className="font-medium">
            Demo workspace. No agents connected.
          </span>
          <p className="mt-1 text-muted-foreground">
            All profiles, runs, and capabilities below are sample data. Changes
            last only on this page; refreshing resets them. No requests are sent
            to a gateway or model provider.
          </p>
        </div>
      </div>

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
          {visible.length} of {agents.length} demo agents ·{" "}
          {agents.filter((agent) => agent.enabled).length} enabled locally
        </p>
      </section>

      {visible.length === 0 ? (
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
                : "Create a demo agent or restore the starter team. Nothing will be connected."}
            </p>
          </div>
          {agents.length ? (
            <Button variant="outline" onClick={() => setSearch("")}>
              Clear search
            </Button>
          ) : (
            <Button
              onClick={(event) => edit(blankAgent(), event.currentTarget)}
            >
              <Plus />
              Create demo agent
            </Button>
          )}
        </section>
      ) : (
        <div className="grid items-start gap-6 md:grid-cols-2 xl:grid-cols-3">
          {stages.map((stage, index) => {
            const members = visible.filter((agent) => agent.stage === stage.id);
            return (
              <section
                key={stage.id}
                className="console-lane min-w-0 space-y-3"
                aria-labelledby={`stage-${stage.id}`}
                data-stage={stage.id}
              >
                <div className="flex items-start justify-between border-b pb-3">
                  <div>
                    <h2
                      id={`stage-${stage.id}`}
                      className="flex items-center gap-2 font-semibold"
                    >
                      <span className="font-mono text-xs text-muted-foreground">
                        0{index + 1}
                      </span>
                      {stage.name}
                    </h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {stage.detail}
                    </p>
                  </div>
                  <span className="font-mono text-xs text-muted-foreground">
                    {members.length.toString().padStart(2, "0")}
                  </span>
                </div>
                {members.map((agent) => (
                  <article key={agent.id} className="card-trendy space-y-4 p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-amber-500/20 bg-amber-500/10 text-xs font-semibold text-amber-500">
                          {agent.name.slice(0, 2).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <h3 className="break-words font-semibold text-base tracking-tight">
                            {agent.name}
                          </h3>
                          <p className="mt-0.5 break-words text-xs text-muted-foreground">
                            {agent.specialty}
                          </p>
                        </div>
                      </div>
                      <Badge
                        variant="outline"
                        className="border-amber-500/30 text-amber-500 bg-amber-500/5 text-[10px]"
                      >
                        Demo
                      </Badge>
                    </div>
                    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-xs">
                      <dt className="text-muted-foreground">Model</dt>
                      <dd className="break-words">{agent.model}</dd>
                      <dt className="text-muted-foreground">Profile</dt>
                      <dd className="break-words font-mono">{agent.profile}</dd>
                    </dl>
                    <div className="flex min-h-11 items-center justify-between gap-2 border-y py-2">
                      <Label
                        htmlFor={`enabled-${agent.id}`}
                        className="text-xs"
                      >
                        {agent.enabled ? "Enabled in demo" : "Disabled in demo"}
                      </Label>
                      <Switch
                        id={`enabled-${agent.id}`}
                        checked={agent.enabled}
                        onCheckedChange={(enabled) =>
                          toggleAgent(agent, enabled)
                        }
                      />
                    </div>
                    {agent.activeRun && (
                      <p className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
                        <ShieldAlert className="size-4 shrink-0" />
                        Demo run M-104 assigned. Deletion blocked until
                        released.
                      </p>
                    )}
                    <div className="flex flex-wrap gap-1">
                      <Button
                        className="min-h-10"
                        variant="outline"
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
                        className="min-h-10"
                        variant="ghost"
                        aria-label={`Edit ${agent.name}`}
                        onClick={(event) => edit(agent, event.currentTarget)}
                      >
                        <Pencil />
                        <span className="sr-only">Edit</span>
                      </Button>
                      <Button
                        className="min-h-10"
                        variant="ghost"
                        aria-label={`Clone ${agent.name}`}
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
                        className="min-h-10"
                        variant="ghost"
                        aria-label={`Delete ${agent.name}`}
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
                  <div className="border border-dashed p-4 text-sm text-muted-foreground">
                    {search
                      ? "No matches in this stage."
                      : "No specialist assigned."}
                    <Button
                      className="mt-2 block min-h-10"
                      variant="ghost"
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
          })}
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
              {draft?.id ? "Edit demo agent" : "New demo agent"}
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
                  required
                  maxLength={160}
                  value={draft.model}
                  onChange={(event) =>
                    setDraft({ ...draft, model: event.target.value })
                  }
                  aria-describedby="agent-model-help"
                />
                <datalist id="agent-model-options">
                  {models.map((model) => (
                    <option key={model} value={model} />
                  ))}
                </datalist>
                <p
                  id="agent-model-help"
                  className="text-xs text-muted-foreground"
                >
                  Type to search suggestions or enter a custom model ID. Sample
                  catalog, availability unverified.
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
                <Label htmlFor="agent-form-enabled">Enabled in demo</Label>
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
                  Save demo agent
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
                ? "Demo run blocks deletion"
                : `Delete ${deleting?.name ?? "agent"}?`}
            </DialogTitle>
            <DialogDescription>
              {deleting?.activeRun
                ? "Neiro has sample mission M-104 assigned. This demonstrates the active-run conflict, not a real running mission. Release the sample assignment, then delete the agent."
                : "This removes the agent from this local demo only. Starter agents can be restored; custom agents cannot be recovered."}
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
            {deleting?.activeRun ? (
              <Button
                className="min-h-10"
                onClick={() => {
                  setAgents((current) =>
                    current.map((agent) =>
                      agent.id === deleting.id
                        ? { ...agent, activeRun: false }
                        : agent,
                    ),
                  );
                  setDeleting({ ...deleting, activeRun: false });
                  toast.success(
                    "Sample assignment released locally. No mission was stopped.",
                  );
                }}
              >
                Release demo assignment
              </Button>
            ) : (
              <Button
                className="min-h-10"
                variant="destructive"
                onClick={async () => {
                  if (!deleting) return;
                  const id = deleting.id;
                  setAgents((current) => current.filter((a) => a.id !== id));
                  try {
                    await fetch(`/api/agents/${id}`, { method: "DELETE" });
                    toast.success(`${deleting.name} deleted from Supabase`);
                  } catch {
                    toast.error("Deleted locally");
                  }
                  setDeleting(null);
                }}
              >
                Delete demo agent
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
            <dd className="break-words">{preview?.model}</dd>
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
