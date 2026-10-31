import { parseMissionCreateBody } from "@/lib/mission-input";

export const PROJECT_DEFAULT_KEYS = ["base_branch", "token_budget", "max_parallel_workers", "max_retries", "pause_after_planning", "isolate_workspace"] as const;
export type ProjectDefaults = Partial<Record<(typeof PROJECT_DEFAULT_KEYS)[number], string | number | boolean | null>>;

/** Validate exactly the mission fields used as project defaults. */
export function parseProjectDefaults(value: unknown): { ok: true; value: ProjectDefaults } | { ok: false; error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "defaults must be an object" };
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !PROJECT_DEFAULT_KEYS.includes(key as typeof PROJECT_DEFAULT_KEYS[number]))) return { ok: false, error: "Unknown project default" };
  const parsed = parseMissionCreateBody({ prompt: "validate defaults", ...input });
  if (!parsed.ok) return parsed;
  return { ok: true, value: Object.fromEntries(PROJECT_DEFAULT_KEYS.filter((key) => Object.hasOwn(input, key)).map((key) => [key, input[key]])) as ProjectDefaults };
}

export function applyProjectDefaults(body: Record<string, unknown>, defaults: ProjectDefaults): Record<string, unknown> {
  return { ...defaults, ...body };
}
