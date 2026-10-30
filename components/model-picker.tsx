"use client";

import { Picker, type PickerOption } from "@/components/ui/picker";
import type { AgentRuntime } from "@/lib/types";

export type ModelOption = { id: string; providerName: string };

export type RuntimeModels = {
  runtime: AgentRuntime;
  /** Shown as the group heading, e.g. "Hermes" or "Oh My Pi". */
  name: string;
  /** Small text on each row, e.g. "CLI omp". */
  hint: string;
  status: "loading" | "ready" | "unavailable";
  models: ModelOption[];
};

const SEP = "|";

export function runtimeModelValue(runtime: AgentRuntime, model: string): string {
  return `${runtime}${SEP}${model}`;
}

/**
 * Model dropdown for the agent form. One list holds the models of every
 * runtime (Hermes, Oh My Pi), grouped by runtime and provider;
 * picking a model also picks the runtime that runs it. Each runtime has a
 * "default" row that leaves the model empty, and a typed id is used on the
 * current runtime.
 */
export function ModelPicker({
  id,
  runtime,
  value,
  runtimes,
  onChange,
  describedBy,
}: {
  id: string;
  runtime: AgentRuntime;
  value: string;
  runtimes: RuntimeModels[];
  onChange: (next: { runtime: AgentRuntime; model: string }) => void;
  describedBy?: string;
}) {
  const options: PickerOption[] = [];
  for (const r of runtimes) {
    const state = r.status === "loading" ? " · loading…" : r.status === "unavailable" ? " · not ready" : "";
    options.push({ value: runtimeModelValue(r.runtime, ""), label: `${r.name} default`, group: `${r.name}${state}`, hint: r.hint });
    for (const m of r.models) {
      const provider = m.providerName && m.providerName !== r.name ? ` · ${m.providerName}` : "";
      options.push({ value: runtimeModelValue(r.runtime, m.id), label: m.id, group: `${r.name}${provider}${state}`, hint: r.hint });
    }
  }
  const current = runtimeModelValue(runtime, value);
  if (!options.some((o) => o.value === current)) {
    const r = runtimes.find((item) => item.runtime === runtime);
    options.unshift({ value: current, label: value || `${r?.name ?? runtime} default`, group: "Current", hint: r?.hint });
  }

  const loading = runtimes.some((r) => r.status === "loading");
  return (
    <Picker
      id={id}
      value={current}
      onChange={(next) => {
        const at = next.indexOf(SEP);
        const known = runtimes.find((r) => r.runtime === next.slice(0, at));
        // A typed id has no runtime prefix: it runs on the current runtime.
        if (at < 0 || !known) onChange({ runtime, model: next.trim() });
        else onChange({ runtime: known.runtime, model: next.slice(at + 1) });
      }}
      aria-describedby={describedBy}
      searchable
      allowCustom
      mono
      searchPlaceholder="Search a model or runtime…"
      emptyText={loading ? "Loading models…" : "No model matches. Type a model id."}
      options={options}
    />
  );
}
