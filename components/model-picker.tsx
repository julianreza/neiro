"use client";

import { Picker } from "@/components/ui/picker";

export type ModelOption = { id: string; providerName: string };

/**
 * Model dropdown for the agent form: every Hermes model, searchable and
 * grouped by provider. A typed id Hermes does not list can still be used, and
 * "Hermes default" clears the field.
 */
export function ModelPicker({
  id,
  value,
  options,
  status,
  onChange,
  describedBy,
}: {
  id: string;
  value: string;
  options: ModelOption[];
  status: "loading" | "ready" | "unavailable";
  onChange: (model: string) => void;
  describedBy?: string;
}) {
  return (
    <Picker
      id={id}
      value={value}
      onChange={onChange}
      aria-describedby={describedBy}
      placeholder="Hermes default"
      searchable
      allowCustom
      mono
      searchPlaceholder="Search or type a model id…"
      emptyText={
        status === "loading"
          ? "Loading models from Hermes…"
          : status === "unavailable"
            ? "Hermes models unavailable. Type a model id."
            : "No model matches."
      }
      options={[
        { value: "", label: "Hermes default" },
        ...options.map((o) => ({ value: o.id, group: o.providerName || "Other" })),
      ]}
    />
  );
}
