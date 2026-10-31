import type {
  HermesDetailedInventory,
  HermesProbeResult,
  HermesServerCapabilities,
  HermesToolsetInfo,
} from "@/lib/hermes";

/** What the browser may see of an agent's capabilities: no URL, key or raw health body. */
export type AgentCapabilitiesDTO = {
  capabilities: { available: boolean; features: Record<string, boolean>; endpoints: string[] };
  skills: HermesDetailedInventory["skills"];
  toolsets: { core: HermesToolsetInfo[]; mcp: HermesToolsetInfo[] };
};

export function capabilitiesDTO(
  caps: HermesServerCapabilities,
  inventory: HermesDetailedInventory,
): AgentCapabilitiesDTO {
  return {
    capabilities: {
      available: caps.available,
      features: { ...caps.features },
      // Names only: paths are the server's business.
      endpoints: Object.keys(caps.endpoints).sort(),
    },
    skills: inventory.skills.map((s) => ({ name: s.name, description: s.description, category: s.category })),
    toolsets: {
      core: inventory.toolsets.filter((t) => !t.isMcp),
      mcp: inventory.toolsets.filter((t) => t.isMcp),
    },
  };
}

export type AgentProbeDTO = AgentCapabilitiesDTO & {
  ok: boolean;
  latencyMs: number;
  error?: string;
  readiness: HermesProbeResult["readiness"] | null;
  /** Names only, kept for older callers. */
  inventory: string[];
};

export function probeDTO(
  probe: HermesProbeResult,
  caps: HermesServerCapabilities,
  inventory: HermesDetailedInventory,
): AgentProbeDTO {
  const base = capabilitiesDTO(caps, inventory);
  return {
    ...base,
    ok: probe.ok,
    latencyMs: probe.latencyMs,
    error: probe.error,
    readiness: probe.readiness ?? null,
    inventory: [...inventory.skills.map((s) => s.name), ...inventory.toolsets.map((t) => t.name)],
  };
}
