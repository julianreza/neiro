"use client";

import { useState } from "react";
import { CalendarClock, Pause, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DataSourceBadge } from "@/components/data-source-badge";
import { useLiveData } from "@/hooks/use-live-data";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Picker } from "@/components/ui/picker";
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
const demoProfiles = ["Atlas", "Relay", "Muse"];
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
    return {
      id: pickString(job, ["id", "job_id", "name"], `job-${index + 1}`),
      profile: pickString(job, ["profile", "agent", "agent_name"], "default"),
      name: pickString(job, ["name", "title"], "Untitled job"),
      cron: pickString(job, ["schedule", "cron", "cron_expr"], "—"),
      prompt: pickString(job, ["prompt", "input", "message"]),
      paused: job.paused === true || job.enabled === false || status === "paused",
      lastRun: pickString(job, ["last_run_at", "lastRunAt", "last_run"], "Never run"),
    };
  });
}

const READ_ONLY_DEMO = "Demo mode: schedules cannot be changed here.";
const READ_ONLY_LIVE = "Read-only: manage schedules on the Hermes server.";

export function SchedulesManager() {
  const live = useLiveData<Schedule[]>("/api/schedules", initialSchedules, parseJobs);
  const isLive = live.source === "live";
  const isDemo = live.source === "demo";
  const schedules: Schedule[] = live.source === "loading" ? [] : live.data;
  const readOnlyHint = isLive ? READ_ONLY_LIVE : READ_ONLY_DEMO;
  const profiles = isLive
    ? [...new Set(schedules.map((schedule) => schedule.profile))]
    : demoProfiles;
  const [profile, setProfile] = useState("all");
  const visible = schedules.filter(
    (schedule) => profile === "all" || schedule.profile === profile,
  );

  return (
    <div className="min-w-0 space-y-8 p-4 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <p className="eyebrow">
            Automation{isDemo ? " / demo" : ""}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">Schedules</h1>
          <p className="flex max-w-2xl flex-wrap items-center gap-2 text-sm text-muted-foreground">
            Give recurring work a rhythm.
            <DataSourceBadge
              source={live.source}
              reason={live.source === "demo" ? live.reason : undefined}
            />
          </p>
        </div>
        <Button
          className="console-launch min-h-10"
          disabled
          title={readOnlyHint}
          aria-describedby="schedules-read-only"
        >
          <Plus aria-hidden="true" /> New schedule
        </Button>
      </div>

      <div className="flex gap-3 rounded-lg border bg-muted/30 p-4 text-sm">
        <CalendarClock
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <p id="schedules-read-only">
          {isLive ? (
            <>
              <span className="font-medium">Live from Hermes, read-only.</span>{" "}
              Create, edit, pause and delete schedules on the Hermes server.
              Cron times are shown as Hermes reports them.
            </>
          ) : (
            <>
              <span className="font-medium">Sample schedules.</span> These
              rows are not real and nothing is scheduled or sent to Hermes.
              Connect Hermes to see your jobs.
            </>
          )}
        </p>
      </div>

      <section
        className="min-w-0 space-y-4"
        aria-labelledby="schedule-list-heading"
      >
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
          <Table className="min-w-[1000px]">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Schedule / profile</TableHead>
                <TableHead>Cron · UTC</TableHead>
                <TableHead>Prompt</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last run</TableHead>
                <TableHead className="pr-4 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((schedule) => (
                <TableRow key={schedule.id}>
                  <TableCell className="pl-4">
                    <p className="font-medium">{schedule.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {schedule.profile}
                      {isDemo ? " · demo" : ""}
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
                      {schedule.paused ? "Paused" : "Enabled"}
                      {isDemo ? " · demo" : ""}
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
                        disabled
                        title={readOnlyHint}
                      >
                        <Play aria-hidden="true" /> Simulate
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="min-h-10"
                        aria-label={`${schedule.paused ? "Resume" : "Pause"} ${schedule.name}`}
                        disabled
                        title={readOnlyHint}
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
                        disabled
                        title={readOnlyHint}
                      >
                        <Pencil aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-10 text-destructive"
                        aria-label={`Delete ${schedule.name}`}
                        disabled
                        title={readOnlyHint}
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
                {live.source === "loading"
                  ? "Loading schedules…"
                  : "No schedules for this profile"}
              </h3>
              {live.source !== "loading" && (
                <p className="text-sm text-muted-foreground">
                  {isLive
                    ? "Create recurring jobs on the Hermes server; they appear here."
                    : "Sample data has no schedules for this profile."}
                </p>
              )}
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {isLive
            ? "Status and last run come from Hermes."
            : "Sample rows only. Nothing here is an active scheduler."}
        </p>
      </section>

    </div>
  );
}
