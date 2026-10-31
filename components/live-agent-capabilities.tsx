"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { AgentBot, agentLook, botRoles, roleForAgent } from "@/components/agent-bot";
import type { AgentCapabilitiesDTO } from "@/lib/agent-capabilities";

type AgentRow = { id: string; name: string; role: string; runtime?: string; enabled?: boolean };

/** Flags shown on each card: what changes what Neiro can do with the agent. */
const FLAGS = [
  ["run_approval", "approvals"],
  ["run_unknown_resolution", "crash recovery"],
  ["reasoning_streaming", "thinking"],
] as const;

const PARALLEL = 4;

type Card = { agent: AgentRow; caps: AgentCapabilitiesDTO | null; error?: string };

/** A known bot role for an agent, so its robot keeps its colours on dark cards. */
function lookRole(a: AgentRow): string {
  return botRoles.includes(a.role) ? a.role : roleForAgent(`${a.role} ${a.name}`);
}

async function loadCaps(agentId: string): Promise<AgentCapabilitiesDTO> {
  const res = await fetch(`/api/agents/capabilities?agentId=${encodeURIComponent(agentId)}`);
  const body = (await res.json().catch(() => ({}))) as AgentCapabilitiesDTO & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

/**
 * Real skills, toolsets, MCP servers and server features of each enabled
 * Hermes agent. Renders nothing until it has agents, so the caller can show
 * its sample instead.
 */
export function LiveAgentCapabilities({ onState }: { onState?: (live: boolean) => void }) {
  const [cards, setCards] = useState<Card[] | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await fetch("/api/agents").catch(() => null);
      const body = (await res?.json().catch(() => null)) as { agents?: AgentRow[] } | null;
      const agents = (res?.ok ? (body?.agents ?? []) : []).filter(
        (a) => a.enabled !== false && (a.runtime ?? "hermes") === "hermes",
      );
      if (!alive) return;
      if (agents.length === 0) {
        setCards([]);
        onState?.(false);
        return;
      }
      const out: Card[] = agents.map((agent) => ({ agent, caps: null }));
      setCards([...out]);
      onState?.(true);
      let next = 0;
      const worker = async () => {
        while (next < agents.length) {
          const i = next++;
          try {
            out[i] = { agent: agents[i], caps: await loadCaps(agents[i].id) };
          } catch (err: unknown) {
            out[i] = { agent: agents[i], caps: null, error: err instanceof Error ? err.message : "Probe failed" };
          }
          if (alive) setCards([...out]);
        }
      };
      await Promise.all(Array.from({ length: Math.min(PARALLEL, agents.length) }, worker));
    })();
    return () => {
      alive = false;
    };
  }, [onState]);

  if (!cards || cards.length === 0) return null;

  return (
    <ul className="grid gap-3 md:grid-cols-3">
      {cards.map(({ agent, caps, error }) => {
        const role = lookRole(agent);
        const mcp = caps?.toolsets.mcp.filter((t) => t.enabled !== false).length ?? 0;
        const tools = caps?.toolsets.core.filter((t) => t.enabled !== false).length ?? 0;
        return (
          <li key={agent.id} className="agent-card space-y-4" data-state="idle" style={agentLook(role)}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 space-y-2">
                <span className="agent-status">
                  <i aria-hidden="true" />
                  {caps ? "Live" : error ? "Unreachable" : "Probing…"}
                </span>
                <p className="agent-name break-words">{agent.name}</p>
                <p className="text-sm text-white/85">{agent.role}</p>
              </div>
              <AgentBot name={agent.name} role={role} asleep={Boolean(error)} working={!caps && !error} />
            </div>
            {caps && (
              <>
                <p className="text-sm text-white/90 tabular-nums">
                  {caps.skills.length} skills · {tools} toolsets · {mcp} MCP
                </p>
                <ul className="flex flex-wrap gap-1.5" aria-label={`${agent.name} server features`}>
                  {FLAGS.map(([flag, label]) => {
                    const on = Boolean(caps.capabilities.features[flag]);
                    return (
                      <li key={flag} className="cap-pill" data-on={on}>
                        {on && <Check className="size-3" aria-hidden="true" />}
                        {label}
                        <span className="sr-only">{on ? ": on" : ": off"}</span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
            {error && <p className="text-xs text-white/85">{error}</p>}
          </li>
        );
      })}
    </ul>
  );
}
