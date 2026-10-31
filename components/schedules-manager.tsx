"use client";

import { useEffect, useState, type FormEvent } from "react";
import { CalendarClock, Loader2, Pause, Pencil, Play, Plus } from "lucide-react";
import { toast } from "sonner";
import { AgentBot, agentLook, botRoles, roleForAgent } from "@/components/agent-bot";
import { Badge } from "@/components/ui/badge";
import { DataSourceBadge, DataSourceFailure } from "@/components/data-source-badge";
import { DeleteButton } from "@/components/delete-button";
import { useLiveData } from "@/hooks/use-live-data";
import { useRole } from "@/hooks/use-role";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Picker } from "@/components/ui/picker";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Schedule = {
  id: string;
  /** Agent whose Hermes profile owns the job; null = the default profile. */
  agentId: string | null;
  agentName: string;
  profile: string;
  name: string;
  cron: string;
  prompt: string;
  skills: string[];
  deliver: string;
  paused: boolean;
  lastRun: string;
  /** This profile's jobs could not be read. */
  error?: string;
};

type AgentOption = { id: string; name: string; role: string; profile: string };

const demoProfiles = ["Atlas", "Relay", "Muse"];
const demo = (s: Partial<Schedule> & Pick<Schedule, "id" | "profile" | "name" | "cron" | "prompt" | "paused" | "lastRun">): Schedule => ({
  agentId: null,
  agentName: s.profile,
  skills: [],
  deliver: "local",
  ...s,
});
const initialSchedules: Schedule[] = [
  demo({
    id: "demo-research",
    profile: "Atlas",
    name: "Morning research brief",
    cron: "0 9 * * 1-5",
    prompt: "Summarize the latest AI infrastructure news with source links.",
    paused: false,
    lastRun: "Sample · Oct 23, 09:00 UTC",
  }),
  demo({
    id: "demo-health",
    profile: "Relay",
    name: "Hourly operations review",
    cron: "0 * * * *",
    prompt: "Review open missions and summarize anything requiring attention.",
    paused: false,
    lastRun: "Sample · Oct 23, 10:00 UTC",
  }),
  demo({
    id: "demo-content",
    profile: "Muse",
    name: "Daily content ideas",
    cron: "0 9 * * *",
    prompt: "Draft three content ideas based on the research brief.",
    paused: true,
    lastRun: "Never run · demo",
  }),
];

const PRESETS = [
  { value: "every 1h", label: "Every hour" },
  { value: "0 9 * * *", label: "Daily 09:00" },
  { value: "0 9 * * 1-5", label: "Weekdays 09:00" },
  { value: "custom", label: "Custom cron" },
];

function pickString(job: Record<string, unknown>, keys: string[], fallback = ""): string {
  for (const key of keys) {
    const value = job[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return fallback;
}

/** Hermes job payloads are loosely typed; map the common field spellings. */
function parseJobs(json: unknown): Schedule[] {
  const jobs = (json as { jobs?: Record<string, unknown>[] } | null)?.jobs;
  if (!Array.isArray(jobs)) throw new Error("Malformed /api/schedules response");
  return jobs.map((job, index) => {
    const status = pickString(job, ["status", "state"]).toLowerCase();
    const schedule = job.schedule && typeof job.schedule === "object" ? (job.schedule as Record<string, unknown>) : null;
    return {
      id: pickString(job, ["id", "job_id"], `job-${index + 1}`),
      agentId: typeof job.agentId === "string" ? job.agentId : null,
      agentName: pickString(job, ["agentName"], "Default"),
      profile: pickString(job, ["profile"], "default"),
      name: pickString(job, ["name", "title"], typeof job.error === "string" ? "Could not read this profile" : "Untitled job"),
      cron: schedule ? pickString(schedule, ["display", "expr", "value"], "—") : pickString(job, ["schedule_display", "schedule", "cron", "cron_expr"], "—"),
      prompt: pickString(job, ["prompt", "input", "message"]),
      skills: Array.isArray(job.skills) ? job.skills.filter((s): s is string => typeof s === "string") : [],
      deliver: pickString(job, ["deliver"], "local"),
      paused: job.paused === true || job.enabled === false || status === "paused",
      lastRun: pickString(job, ["last_run_at", "lastRunAt", "last_run"], "Never run"),
      error: typeof job.error === "string" ? job.error : undefined,
    };
  });
}

function parseAgents(json: unknown): AgentOption[] {
  const rows = (json as { agents?: Record<string, unknown>[] } | null)?.agents;
  if (!Array.isArray(rows)) throw new Error("Malformed /api/agents response");
  return rows
    .filter((r) => r.enabled !== false && (r.runtime ?? "hermes") === "hermes")
    .map((r) => ({ id: String(r.id), name: String(r.name ?? r.id), role: String(r.role ?? ""), profile: String(r.profile ?? "default") }));
}

const lookRole = (role: string, name: string) => (botRoles.includes(role) ? role : roleForAgent(`${role} ${name}`));

async function send(url: string, method: string, body?: unknown): Promise<string | null> {
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

const READ_ONLY_DEMO = "Demo mode: connect Hermes to manage schedules.";
const VIEWER_HINT = "Only an admin can change schedules.";

type Draft = {
  id: string | null;
  agentId: string;
  name: string;
  preset: string;
  cron: string;
  prompt: string;
  skills: string[];
  deliver: string;
};

function draftOf(s: Schedule | null): Draft {
  if (!s) return { id: null, agentId: "", name: "", preset: "0 9 * * *", cron: "", prompt: "", skills: [], deliver: "" };
  const preset = PRESETS.some((p) => p.value === s.cron) ? s.cron : "custom";
  return {
    id: s.id,
    agentId: s.agentId ?? "",
    name: s.name.replace(/^\[bot:[^\]]*\]\s*/, ""),
    preset,
    cron: preset === "custom" ? s.cron : "",
    prompt: s.prompt,
    skills: s.skills,
    deliver: s.deliver === "local" ? "" : s.deliver,
  };
}

/** The skills installed on the picked agent's Hermes profile. */
function useProfileSkills(agentId: string): string[] {
  const [loaded, setLoaded] = useState<{ agentId: string; skills: string[] } | null>(null);
  useEffect(() => {
    if (!agentId) return;
    let alive = true;
    fetch(`/api/agents/capabilities?agentId=${encodeURIComponent(agentId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { skills?: { name: string }[] } | null) => {
        if (alive) setLoaded({ agentId, skills: (b?.skills ?? []).map((s) => s.name) });
      })
      .catch(() => alive && setLoaded({ agentId, skills: [] }));
    return () => {
      alive = false;
    };
  }, [agentId]);
  // Skills of another agent (still loading the new one) are never shown.
  return agentId && loaded?.agentId === agentId ? loaded.skills : [];
}

function ScheduleDialog({
  draft,
  agents,
  onClose,
  onSaved,
}: {
  draft: Draft;
  agents: AgentOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [d, setD] = useState(draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const skillOptions = useProfileSkills(d.agentId);
  const agent = agents.find((a) => a.id === d.agentId);
  const prefixed = agent && agent.profile !== "default" ? `[bot:${agent.profile}] ` : "";

  async function submit(event: FormEvent) {
    event.preventDefault();
    const schedule = d.preset === "custom" ? d.cron.trim() : d.preset;
    if (!schedule) return setError("Enter a cron expression.");
    setBusy(true);
    setError(null);
    const body = {
      agentId: d.agentId || undefined,
      name: d.name.trim(),
      schedule,
      prompt: d.prompt.trim(),
      skills: d.skills,
      deliver: d.deliver.trim() || "local",
    };
    const err = d.id
      ? await send(`/api/schedules/${encodeURIComponent(d.id)}`, "PATCH", body)
      : await send("/api/schedules", "POST", body);
    setBusy(false);
    if (err) return setError(err);
    toast.success(d.id ? "Schedule saved" : "Schedule created");
    onSaved();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{d.id ? "Edit schedule" : "New schedule"}</DialogTitle>
          <DialogDescription>Runs on the picked agent&apos;s Hermes profile. Times are UTC.</DialogDescription>
        </DialogHeader>
        <form id="schedule-form" className="space-y-4" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="schedule-agent">Agent / bot</Label>
            <Picker
              id="schedule-agent"
              value={d.agentId}
              onChange={(agentId) => setD({ ...d, agentId, skills: [] })}
              options={[{ value: "", label: "Default profile" }, ...agents.map((a) => ({ value: a.id, label: `${a.name} · ${a.profile}` }))]}
              disabled={Boolean(d.id)}
            />
            {d.id && <p className="text-xs text-muted-foreground">A schedule stays on its profile. Make a new one to move it.</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="schedule-name">Name</Label>
            <div className="flex items-center gap-2">
              {prefixed && <span className="code-chip shrink-0">{prefixed.trim()}</span>}
              <Input id="schedule-name" required maxLength={180} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="schedule-preset">When</Label>
              <Picker id="schedule-preset" value={d.preset} onChange={(preset) => setD({ ...d, preset })} options={PRESETS} />
            </div>
            {d.preset === "custom" && (
              <div className="space-y-2">
                <Label htmlFor="schedule-cron">Cron expression</Label>
                <Input
                  id="schedule-cron"
                  required
                  maxLength={120}
                  placeholder="30 8 * * 1"
                  className="font-mono"
                  value={d.cron}
                  onChange={(e) => setD({ ...d, cron: e.target.value })}
                />
              </div>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="schedule-prompt">Prompt</Label>
            <Textarea id="schedule-prompt" required maxLength={5000} rows={4} value={d.prompt} onChange={(e) => setD({ ...d, prompt: e.target.value })} />
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Skills (optional)</legend>
            {skillOptions.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {d.agentId ? "No skills on this profile." : "Pick an agent to choose its skills."}
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {skillOptions.map((name) => {
                  const on = d.skills.includes(name);
                  return (
                    <button
                      key={name}
                      type="button"
                      className="cap-pill"
                      data-on={on}
                      aria-pressed={on}
                      onClick={() => setD({ ...d, skills: on ? d.skills.filter((s) => s !== name) : [...d.skills, name] })}
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
            )}
          </fieldset>
          <div className="space-y-2">
            <Label htmlFor="schedule-deliver">Deliver to (optional)</Label>
            <Input
              id="schedule-deliver"
              maxLength={200}
              placeholder="local, telegram:<chat id>, slack:<channel>"
              value={d.deliver}
              onChange={(e) => setD({ ...d, deliver: e.target.value })}
              aria-describedby="schedule-deliver-help"
            />
            <p id="schedule-deliver-help" className="text-xs text-muted-foreground">
              Where Hermes sends each result. Empty keeps it on the Hermes server.
            </p>
          </div>
          {error && <p role="alert" className="text-sm text-[var(--status-danger)]">{error}</p>}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="schedule-form" disabled={busy}>
            {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
            {d.id ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SchedulesManager() {
  const live = useLiveData<Schedule[]>("/api/schedules", initialSchedules, parseJobs);
  const agentList = useLiveData<AgentOption[]>("/api/agents", [], parseAgents);
  const role = useRole();
  const isLive = live.source === "live";
  const isDemo = live.source === "demo";
  const canEdit = isLive && role !== "viewer";
  const lockedHint = !isLive ? READ_ONLY_DEMO : role === "viewer" ? VIEWER_HINT : undefined;
  const schedules: Schedule[] = live.source === "live" || live.source === "demo" ? live.data : [];
  const agents = agentList.source === "live" ? agentList.data : [];
  const profiles = isLive ? [...new Set(schedules.map((s) => s.profile))] : demoProfiles;
  const [profile, setProfile] = useState("all");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const visible = schedules.filter((s) => profile === "all" || s.profile === profile);

  async function act(s: Schedule, action: "run" | "pause" | "resume") {
    setBusy(`${s.id}:${action}`);
    const err = await send(`/api/schedules/${encodeURIComponent(s.id)}`, "POST", { action, agentId: s.agentId ?? undefined });
    setBusy(null);
    if (err) toast.error(err);
    else toast.success(action === "run" ? `${s.name} started` : action === "pause" ? `${s.name} paused` : `${s.name} resumed`);
    live.reload();
  }

  const lookOf = (s: Schedule) => {
    const a = agents.find((x) => x.id === s.agentId);
    return lookRole(a?.role ?? "", a?.name ?? s.agentName);
  };

  return (
    <div className="min-w-0 space-y-8 p-4 md:p-8">
      {live.source === "error" && <DataSourceFailure reason={live.reason} retry={live.reload} showDemo={live.showDemo} />}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <p className="eyebrow">Automation{isDemo ? " / demo" : ""}</p>
          <h1 className="text-3xl font-semibold tracking-tight">Schedules</h1>
          <p className="flex max-w-2xl flex-wrap items-center gap-2 text-sm text-muted-foreground">
            Give recurring work a rhythm.
            <DataSourceBadge source={live.source} reason={live.source === "demo" ? live.reason : undefined} lastUpdated={live.source === "live" ? live.lastUpdated : undefined} staleReason={live.source === "live" ? live.staleReason : undefined} />
          </p>
        </div>
        <Button
          className="console-launch min-h-10"
          disabled={!canEdit}
          title={lockedHint}
          onClick={() => setDraft(draftOf(null))}
        >
          <Plus aria-hidden="true" /> New schedule
        </Button>
      </div>

      {!isLive && (
        <div className="flex gap-3 rounded-lg border bg-muted/30 p-4 text-sm">
          <CalendarClock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p>
            <span className="font-medium">Sample schedules.</span> These rows are not real and nothing is
            scheduled or sent to Hermes. Connect Hermes to see and manage your jobs.
          </p>
        </div>
      )}

      <section className="min-w-0 space-y-4" aria-labelledby="schedule-list-heading">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 id="schedule-list-heading" className="text-lg font-semibold">
              {isLive ? "Scheduled jobs" : "Sample schedules"}
            </h2>
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {visible.length} {isDemo ? "demo " : ""}
              {visible.length === 1 ? "schedule" : "schedules"}
            </p>
          </div>
          <div className="w-full space-y-2 sm:w-52">
            <Label htmlFor="schedule-profile">Agent profile</Label>
            <Picker
              id="schedule-profile"
              value={profile}
              onChange={setProfile}
              options={[{ value: "all", label: "All profiles" }, ...profiles.map((item) => ({ value: item }))]}
            />
          </div>
        </div>
        <div className="console-table min-w-0 overflow-hidden rounded-lg border">
          <Table className="min-w-[1100px]">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Schedule</TableHead>
                <TableHead>Bot</TableHead>
                <TableHead>Cron · UTC</TableHead>
                <TableHead>Prompt</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last run</TableHead>
                <TableHead className="pr-4 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((s) => (
                <TableRow key={`${s.profile}:${s.id}`}>
                  <TableCell className="pl-4">
                    <p className="font-medium">{s.name}</p>
                    {s.skills.length > 0 && <p className="text-xs text-muted-foreground">{s.skills.join(", ")}</p>}
                    {s.error && <p className="text-xs text-[var(--status-danger)]">{s.error}</p>}
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-2" style={agentLook(lookOf(s))}>
                      <span className="schedule-bot" aria-hidden="true">
                        <AgentBot name={s.agentName} role={lookOf(s)} asleep={s.paused} working={false} />
                      </span>
                      <span className="text-sm">
                        {s.agentName}
                        <span className="block text-xs text-muted-foreground">{s.profile}{isDemo ? " · demo" : ""}</span>
                      </span>
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{s.cron}</TableCell>
                  <TableCell className="max-w-64 whitespace-normal text-muted-foreground">{s.prompt}</TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {s.paused ? "Paused" : "Enabled"}
                      {isDemo ? " · demo" : ""}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{s.lastRun}</TableCell>
                  <TableCell className="pr-4">
                    {!s.error && (
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="min-h-10"
                          aria-label={`Run ${s.name} now`}
                          disabled={!canEdit || busy !== null}
                          title={lockedHint}
                          onClick={() => void act(s, "run")}
                        >
                          {busy === `${s.id}:run` ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Play aria-hidden="true" />}
                          Run now
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="min-h-10"
                          aria-label={`${s.paused ? "Resume" : "Pause"} ${s.name}`}
                          disabled={!canEdit || busy !== null}
                          title={lockedHint}
                          onClick={() => void act(s, s.paused ? "resume" : "pause")}
                        >
                          {s.paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
                          {s.paused ? "Resume" : "Pause"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-10"
                          aria-label={`Edit ${s.name}`}
                          disabled={!canEdit}
                          title={lockedHint}
                          onClick={() => setDraft(draftOf(s))}
                        >
                          <Pencil aria-hidden="true" />
                        </Button>
                        <DeleteButton
                          url={`/api/schedules/${encodeURIComponent(s.id)}${s.agentId ? `?agentId=${encodeURIComponent(s.agentId)}` : ""}`}
                          what="Schedule"
                          title={`Delete ${s.name}?`}
                          body="Hermes stops running it. Past results stay on the Hermes server."
                          onDeleted={() => live.reload()}
                          disabledReason={lockedHint}
                        />
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {visible.length === 0 && (
            <div className="space-y-3 p-8 text-center">
              <CalendarClock className="mx-auto size-6 text-muted-foreground" aria-hidden="true" />
              <h3 className="font-medium">{live.source === "loading" ? "Loading schedules…" : live.source === "error" ? "Schedules unavailable" : "No schedules for this profile"}</h3>
              {live.source !== "loading" && live.source !== "error" && (
                <p className="text-sm text-muted-foreground">
                  {isLive ? "Press New schedule to add one." : "Sample data has no schedules for this profile."}
                </p>
              )}
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {isLive ? "Status and last run come from Hermes." : "Sample rows only. Nothing here is an active scheduler."}
        </p>
      </section>

      {draft && (
        <ScheduleDialog
          key={draft.id ?? "new"}
          draft={draft}
          agents={agents}
          onClose={() => setDraft(null)}
          onSaved={() => {
            setDraft(null);
            live.reload();
          }}
        />
      )}
    </div>
  );
}
