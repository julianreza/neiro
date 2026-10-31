import { listHermesScheduledJobs } from "@/lib/hermes";
import { asRuntime } from "@/lib/types";
import type { Agent } from "@/lib/types";

/**
 * Hermes cron jobs (/api/jobs) across agent profiles: input checks, the
 * Bot Mode "[bot:<profile>]" name prefix, and one list over every profile.
 * Hermes takes name, schedule, prompt, deliver, skills and repeat; it has no
 * per-job provider, so none is sent.
 */

export const SCHEDULE_LIMITS = { name: 200, schedule: 120, prompt: 5000, deliver: 200, skills: 20 } as const;

export type ScheduleInput = {
  name?: string;
  schedule?: string;
  prompt?: string;
  deliver?: string;
  skills?: string[];
  repeat?: number;
};

const BOT_PREFIX = /^\[bot:[^\]]*\]\s*/;

/** "[bot:<profile>] name", once. The default profile gets no prefix. */
export function withBotPrefix(name: string, profile: string | null | undefined): string {
  const bare = name.replace(BOT_PREFIX, "").trim();
  const p = (profile ?? "").trim();
  return p && p !== "default" ? `[bot:${p}] ${bare}` : bare;
}

function text(
  v: unknown,
  field: string,
  max: number,
  required: boolean,
): { ok: true; value?: string } | { ok: false; error: string } {
  if (v === undefined || v === null) return required ? { ok: false, error: `${field} is required` } : { ok: true };
  if (typeof v !== "string") return { ok: false, error: `${field} must be text` };
  const t = v.trim();
  if (required && !t) return { ok: false, error: `${field} is required` };
  if (t.length > max) return { ok: false, error: `${field} must be at most ${max} characters` };
  return { ok: true, value: t };
}

/** Only the fields Hermes accepts. `partial` = an edit (nothing required). */
export function parseScheduleInput(
  body: unknown,
  partial = false,
): { ok: true; value: ScheduleInput } | { ok: false; error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const out: ScheduleInput = {};
  const fields = [
    ["name", SCHEDULE_LIMITS.name],
    ["schedule", SCHEDULE_LIMITS.schedule],
    ["prompt", SCHEDULE_LIMITS.prompt],
  ] as const;
  for (const [key, max] of fields) {
    const r = text(b[key], key, max, !partial);
    if (!r.ok) return r;
    if (r.value !== undefined) out[key] = r.value;
  }
  const deliver = text(b.deliver, "deliver", SCHEDULE_LIMITS.deliver, false);
  if (!deliver.ok) return deliver;
  if (deliver.value) out.deliver = deliver.value;
  if (b.skills !== undefined && b.skills !== null) {
    if (!Array.isArray(b.skills) || b.skills.some((s) => typeof s !== "string" || !/^[\w.:@/-]{1,100}$/.test(s))) {
      return { ok: false, error: "skills must be a list of skill names" };
    }
    if (b.skills.length > SCHEDULE_LIMITS.skills) return { ok: false, error: `At most ${SCHEDULE_LIMITS.skills} skills` };
    out.skills = b.skills as string[];
  }
  if (b.repeat !== undefined && b.repeat !== null) {
    if (typeof b.repeat !== "number" || !Number.isInteger(b.repeat) || b.repeat < 1) {
      return { ok: false, error: "repeat must be a positive whole number" };
    }
    out.repeat = b.repeat;
  }
  return { ok: true, value: out };
}

export type ScheduleItem = Record<string, unknown> & {
  agentId: string | null;
  agentName: string;
  profile: string;
  /** Set when this profile's jobs could not be read. */
  error?: string;
};

type Lister = (agent?: Agent) => Promise<Array<Record<string, unknown>>>;

const profileKey = (a: Pick<Agent, "url" | "profile">) => `${a.url?.trim() || ""}|${a.profile?.trim() || "default"}`;

/**
 * Jobs of the default profile plus every distinct profile of the enabled
 * Hermes agents. A profile that fails gives one error item instead of
 * failing the whole list.
 */
export async function listAllSchedules(agents: Agent[], list: Lister = listHermesScheduledJobs): Promise<ScheduleItem[]> {
  const groups = new Map<string, { agent: Agent | undefined; names: string[] }>();
  groups.set("|default", { agent: undefined, names: [] });
  for (const a of agents) {
    if (!a.enabled || asRuntime(a.runtime) !== "hermes") continue;
    const key = profileKey(a);
    const g = groups.get(key);
    if (g) g.names.push(a.name);
    else groups.set(key, { agent: a, names: [a.name] });
  }
  const entries = [...groups.values()];
  const results = await Promise.allSettled(entries.map((g) => list(g.agent)));
  return results.flatMap((r, i): ScheduleItem[] => {
    const { agent, names } = entries[i];
    const base = {
      agentId: agent?.id ?? null,
      agentName: agent ? names.join(", ") : names.length ? `Default (${names.join(", ")})` : "Default",
      profile: agent?.profile || "default",
    };
    if (r.status === "rejected") {
      return [{ ...base, error: r.reason instanceof Error ? r.reason.message : String(r.reason) }];
    }
    return r.value.map((job) => ({ ...job, ...base }));
  });
}
