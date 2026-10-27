"use client";

import { useState, type FormEvent } from "react";
import { CalendarClock, Pause, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
  profile: string;
  name: string;
  cron: string;
  prompt: string;
  paused: boolean;
  lastRun: string;
};
const profiles = ["Atlas", "Relay", "Muse"];
const presets = {
  hourly: "0 * * * *",
  daily: "0 9 * * *",
  weekdays: "0 9 * * 1-5",
  custom: "",
};
type Preset = keyof typeof presets;
const initialSchedules: Schedule[] = [
  {
    id: "demo-research",
    profile: "Atlas",
    name: "Morning research brief",
    cron: "0 9 * * 1-5",
    prompt: "Summarize the latest AI infrastructure news with source links.",
    paused: false,
    lastRun: "Sample · Oct 23, 09:00 UTC",
  },
  {
    id: "demo-health",
    profile: "Relay",
    name: "Hourly operations review",
    cron: "0 * * * *",
    prompt: "Review open missions and summarize anything requiring attention.",
    paused: false,
    lastRun: "Sample · Oct 23, 10:00 UTC",
  },
  {
    id: "demo-content",
    profile: "Muse",
    name: "Daily content ideas",
    cron: "0 9 * * *",
    prompt: "Draft three content ideas based on the research brief.",
    paused: true,
    lastRun: "Never run · demo",
  },
];
const selectClass =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-base focus-visible:outline-2 focus-visible:outline-ring sm:text-sm";

function validCron(value: string) {
  const fields = value.trim().split(/\s+/);
  const limits = [
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 7],
  ];
  return (
    fields.length === 5 &&
    fields.every((field, index) =>
      field.split(",").every((part) => {
        const match = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
        if (!match) return false;
        const [min, max] = limits[index];
        if (
          match[2] &&
          (Number(match[2]) < 1 || Number(match[2]) > max - min + 1)
        )
          return false;
        if (match[1] === "*") return true;
        const range = match[1].split("-").map(Number);
        return (
          range.every((value) => value >= min && value <= max) &&
          (range.length === 1 || range[0] <= range[1])
        );
      }),
    )
  );
}

export function SchedulesManager() {
  const [schedules, setSchedules] = useState(initialSchedules);
  const [profile, setProfile] = useState("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Schedule | null>(null);
  const [name, setName] = useState("");
  const [agent, setAgent] = useState(profiles[0]);
  const [preset, setPreset] = useState<Preset>("daily");
  const [cron, setCron] = useState<string>(presets.daily);
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");
  const visible = schedules.filter(
    (schedule) => profile === "all" || schedule.profile === profile,
  );

  function showEditor(schedule?: Schedule) {
    setEditing(schedule?.id ?? null);
    setName(schedule?.name ?? "");
    setAgent(schedule?.profile ?? (profile === "all" ? profiles[0] : profile));
    setPreset(
      schedule
        ? ((Object.keys(presets) as Preset[]).find(
            (key) => presets[key] === schedule.cron,
          ) ?? "custom")
        : "daily",
    );
    setCron(schedule?.cron ?? presets.daily);
    setPrompt(schedule?.prompt ?? "");
    setError("");
    setOpen(true);
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || !prompt.trim()) {
      setError(
        "Enter a schedule name and a prompt containing more than spaces.",
      );
      return;
    }
    if (!validCron(cron)) {
      setError(
        "Enter five valid cron fields: minute (0–59), hour (0–23), day (1–31), month (1–12), weekday (0–7). Use *, numbers, ranges, lists, or steps.",
      );
      return;
    }
    const values = {
      name: name.trim(),
      profile: agent,
      cron: cron.trim().replace(/\s+/g, " "),
      prompt: prompt.trim(),
    };
    setSchedules((current) =>
      editing
        ? current.map((schedule) =>
            schedule.id === editing ? { ...schedule, ...values } : schedule,
          )
        : [
            ...current,
            {
              ...values,
              id: crypto.randomUUID(),
              paused: false,
              lastRun: "Never run · demo",
            },
          ],
    );
    setOpen(false);
    toast.success(
      editing
        ? "Demo schedule updated locally"
        : "Demo schedule created locally",
    );
  }

  return (
    <div className="min-w-0 space-y-8 p-4 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Automation / demo
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">Schedules</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Give recurring work a rhythm. Explore sample schedules without
            contacting an agent.
          </p>
        </div>
        <Button className="console-launch min-h-10" onClick={() => showEditor()}>
          <Plus aria-hidden="true" /> New demo schedule
        </Button>
      </div>

      <div className="flex gap-3 rounded-lg border bg-muted/30 p-4 text-sm">
        <CalendarClock
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <p>
          <span className="font-medium">Local demo only.</span> Changes reset
          when this page unmounts. Nothing is saved, scheduled, or sent to
          Hermes. All cron times use UTC in this preview.
        </p>
      </div>

      <section
        className="min-w-0 space-y-4"
        aria-labelledby="schedule-list-heading"
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 id="schedule-list-heading" className="text-lg font-semibold">
              Sample schedules
            </h2>
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {visible.length} demo{" "}
              {visible.length === 1 ? "schedule" : "schedules"}
            </p>
          </div>
          <div className="w-full space-y-2 sm:w-52">
            <Label htmlFor="schedule-profile">Agent profile</Label>
            <select
              id="schedule-profile"
              className={selectClass}
              value={profile}
              onChange={(event) => setProfile(event.target.value)}
            >
              <option value="all">All profiles</option>
              {profiles.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="console-table min-w-0 overflow-hidden rounded-lg border">
          <Table className="min-w-[1000px]">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Schedule / profile</TableHead>
                <TableHead>Cron · UTC</TableHead>
                <TableHead>Prompt</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last run</TableHead>
                <TableHead className="pr-4 text-right">Local actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((schedule) => (
                <TableRow key={schedule.id}>
                  <TableCell className="pl-4">
                    <p className="font-medium">{schedule.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {schedule.profile} · demo
                    </p>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {schedule.cron}
                  </TableCell>
                  <TableCell className="max-w-64 whitespace-normal text-muted-foreground">
                    {schedule.prompt}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {schedule.paused ? "Paused · demo" : "Enabled · demo"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {schedule.lastRun}
                  </TableCell>
                  <TableCell className="pr-4">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="min-h-10"
                        aria-label={`Simulate run for ${schedule.name}`}
                        onClick={() => {
                          setSchedules((current) =>
                            current.map((item) =>
                              item.id === schedule.id
                                ? {
                                    ...item,
                                    lastRun:
                                      "Simulated just now · no execution",
                                  }
                                : item,
                            ),
                          );
                          toast.info(
                            "Run simulated locally. No agent was invoked.",
                          );
                        }}
                      >
                        <Play aria-hidden="true" /> Simulate
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="min-h-10"
                        aria-label={`${schedule.paused ? "Resume" : "Pause"} ${schedule.name}`}
                        onClick={() => {
                          setSchedules((current) =>
                            current.map((item) =>
                              item.id === schedule.id
                                ? { ...item, paused: !item.paused }
                                : item,
                            ),
                          );
                          toast.info(
                            `Demo schedule ${schedule.paused ? "resumed" : "paused"} locally`,
                          );
                        }}
                      >
                        {schedule.paused ? (
                          <Play aria-hidden="true" />
                        ) : (
                          <Pause aria-hidden="true" />
                        )}
                        {schedule.paused ? "Resume" : "Pause"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-10"
                        aria-label={`Edit ${schedule.name}`}
                        onClick={() => showEditor(schedule)}
                      >
                        <Pencil aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-10 text-destructive"
                        aria-label={`Delete ${schedule.name}`}
                        onClick={() => setDeleting(schedule)}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {visible.length === 0 && (
            <div className="space-y-3 p-8 text-center">
              <CalendarClock
                className="mx-auto size-6 text-muted-foreground"
                aria-hidden="true"
              />
              <h3 className="font-medium">
                No demo schedules for this profile
              </h3>
              <p className="text-sm text-muted-foreground">
                Add recurring instructions to explore the local scheduling
                workflow.
              </p>
              <Button variant="outline" onClick={() => showEditor()}>
                Create demo schedule
              </Button>
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Enabled is a demo state, not an active scheduler. Simulate run now
          only updates the local last-run label.
        </p>
      </section>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit demo schedule" : "New demo schedule"}
            </DialogTitle>
            <DialogDescription>
              Local preview only. No recurring job will be deployed.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={save}>
            <div className="space-y-2">
              <Label htmlFor="schedule-name">Schedule name</Label>
              <Input
                id="schedule-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={100}
                placeholder="Morning research brief"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="schedule-agent">Agent profile</Label>
              <select
                id="schedule-agent"
                className={selectClass}
                value={agent}
                onChange={(event) => setAgent(event.target.value)}
              >
                {profiles.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="schedule-preset">Frequency preset · UTC</Label>
              <select
                id="schedule-preset"
                className={selectClass}
                value={preset}
                onChange={(event) => {
                  const value = event.target.value as Preset;
                  setPreset(value);
                  if (value !== "custom") setCron(presets[value]);
                }}
              >
                <option value="hourly">Hourly · on the hour</option>
                <option value="daily">Daily · 09:00 UTC</option>
                <option value="weekdays">Weekdays · 09:00 UTC</option>
                <option value="custom">Custom cron</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="schedule-cron">Cron expression</Label>
              <Input
                id="schedule-cron"
                className="font-mono"
                value={cron}
                onChange={(event) => {
                  setCron(event.target.value);
                  setPreset("custom");
                }}
                required
                aria-describedby="cron-help"
              />
              <p id="cron-help" className="text-xs text-muted-foreground">
                Five fields: minute, hour, day of month, month, weekday.
                Example: 0 9 * * 1-5.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="schedule-prompt">Agent prompt</Label>
              <Textarea
                id="schedule-prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                required
                maxLength={4000}
                rows={3}
                placeholder="Describe the recurring task…"
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit">
                {editing ? "Save local changes" : "Create demo schedule"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={deleting !== null}
        onOpenChange={(value) => {
          if (!value) setDeleting(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete demo schedule?</DialogTitle>
            <DialogDescription>
              Remove “{deleting?.name}” from this local session. No deployed
              schedule is affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setSchedules((current) =>
                  current.filter((item) => item.id !== deleting?.id),
                );
                setDeleting(null);
                toast.success("Demo schedule deleted locally");
              }}
            >
              Delete demo schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
