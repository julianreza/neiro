import type { Mission, MissionPhase } from "@/lib/types";

/** The stations a mission passes, one per engine phase. */
export const STATIONS: { phase: MissionPhase; label: string }[] = [
  { phase: "planning", label: "Plan" },
  { phase: "spec", label: "Spec" },
  { phase: "executing", label: "Build" },
  { phase: "summarizing", label: "Summary" },
  { phase: "done", label: "Done" },
];

export type StationState = "done" | "now" | "wait" | "stop" | "todo";

/** Where the robot stands, and how each station looks. */
export function railStops(m: Pick<Mission, "status" | "phase">): { at: number; states: StationState[]; note: string } {
  const last = STATIONS.length - 1;
  const found = STATIONS.findIndex((s) => s.phase === m.phase);
  const phaseAt = found < 0 ? 0 : found;
  const at = m.status === "completed" ? last : phaseAt;
  const here: StationState =
    m.status === "completed" ? "done" : m.status === "cancelled" ? "stop" : m.status === "awaiting_plan_approval" ? "wait" : "now";
  const states = STATIONS.map((_, i): StationState => (i < at ? "done" : i === at ? here : "todo"));
  const name = STATIONS[at].label;
  const note =
    here === "done" ? "Reached Done" : here === "stop" ? `Stopped at ${name}` : here === "wait" ? "Waiting for your plan approval" : `Now at ${name}`;
  return { at, states, note };
}
