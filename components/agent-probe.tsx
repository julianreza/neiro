"use client";

import { useEffect, useState } from "react";
import { CircleCheck, CircleX, Loader2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AgentProbeDTO } from "@/lib/agent-capabilities";

/** Feature flags worth showing first; the rest follow alphabetically. */
const KEY_FLAGS = ["run_approval", "run_unknown_resolution", "reasoning_streaming", "run_events_sse", "session_key_header"];

type State =
  | { phase: "loading" }
  | { phase: "done"; probe: AgentProbeDTO }
  | { phase: "failed"; error: string };

function Mark({ ok }: { ok: boolean | undefined }) {
  return ok ? (
    <CircleCheck className="size-3.5 text-[var(--status-success)]" aria-label="yes" />
  ) : (
    <CircleX className="size-3.5 text-muted-foreground" aria-label="no" />
  );
}

/** A real probe of one Hermes agent: health, server features, skills and toolsets. */
export function AgentProbe({ agentId }: { agentId: string }) {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    fetch(`/api/agents/${encodeURIComponent(agentId)}/probe`, { method: "POST" })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as Partial<AgentProbeDTO> & { error?: string; flags?: AgentProbeDTO["capabilities"] };
        if (!alive) return;
        if (!res.ok) return setState({ phase: "failed", error: body.error ?? `HTTP ${res.status}` });
        setState({
          phase: "done",
          probe: {
            ok: Boolean(body.ok),
            latencyMs: Number(body.latencyMs) || 0,
            error: body.error,
            readiness: body.readiness ?? null,
            inventory: body.inventory ?? [],
            capabilities: body.flags ?? { available: false, features: {}, endpoints: [] },
            skills: body.skills ?? [],
            toolsets: body.toolsets ?? { core: [], mcp: [] },
          },
        });
      })
      .catch(() => alive && setState({ phase: "failed", error: "Network error" }));
    return () => {
      alive = false;
    };
  }, [agentId, nonce]);

  if (state.phase === "loading") {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Probing the agent…
      </p>
    );
  }
  if (state.phase === "failed") {
    return (
      <div role="alert" className="space-y-2 text-sm">
        <p className="text-[var(--status-danger)]">{state.error}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setState({ phase: "loading" });
            setNonce((n) => n + 1);
          }}
        >
          <RotateCw aria-hidden="true" /> Try again
        </Button>
      </div>
    );
  }

  const { probe } = state;
  const r = probe.readiness;
  const flags = Object.entries(probe.capabilities.features).sort(([a], [b]) => {
    const ia = KEY_FLAGS.indexOf(a);
    const ib = KEY_FLAGS.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });

  return (
    <div className="space-y-4 text-sm" role="status">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-md bg-secondary/30 p-2">
          <dt className="eyebrow">Health</dt>
          <dd className="mt-1 flex items-center gap-1.5">
            <Mark ok={probe.ok} /> {probe.ok ? (r?.status ?? "ok") : "down"}
          </dd>
        </div>
        <div className="rounded-md bg-secondary/30 p-2">
          <dt className="eyebrow">Latency</dt>
          <dd className="mt-1 tabular-nums">{probe.latencyMs} ms</dd>
        </div>
        <div className="rounded-md bg-secondary/30 p-2">
          <dt className="eyebrow">Active runs</dt>
          <dd className="mt-1 tabular-nums">{r?.activeRuns ?? "–"}</dd>
        </div>
        <div className="rounded-md bg-secondary/30 p-2">
          <dt className="eyebrow">Delegations</dt>
          <dd className="mt-1 tabular-nums">{r?.activeDelegations ?? "–"}</dd>
        </div>
      </dl>
      {probe.error && <p className="text-[var(--status-danger)]">{probe.error}</p>}

      <section aria-labelledby="probe-flags">
        <h3 id="probe-flags" className="eyebrow mb-2">Server features</h3>
        {probe.capabilities.available ? (
          <ul className="flex flex-wrap gap-1.5">
            {flags.map(([name, on]) => (
              <li key={name} className="code-chip inline-flex items-center gap-1" data-on={on}>
                <Mark ok={on} /> {name}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">This Hermes has no /v1/capabilities (older version).</p>
        )}
      </section>

      <section aria-labelledby="probe-skills">
        <h3 id="probe-skills" className="eyebrow mb-2">Skills · {probe.skills.length}</h3>
        {probe.skills.length === 0 ? (
          <p className="text-xs text-muted-foreground">No skills installed.</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {probe.skills.map((s) => (
              <li key={s.name} className="code-chip" title={s.description}>{s.name}</li>
            ))}
          </ul>
        )}
      </section>

      {(["core", "mcp"] as const).map((group) => (
        <section key={group} aria-labelledby={`probe-${group}`}>
          <h3 id={`probe-${group}`} className="eyebrow mb-2">
            {group === "core" ? "Toolsets" : "MCP servers"} · {probe.toolsets[group].length}
          </h3>
          {probe.toolsets[group].length === 0 ? (
            <p className="text-xs text-muted-foreground">None.</p>
          ) : (
            <ul className="space-y-1">
              {probe.toolsets[group].map((t) => (
                <li key={t.name}>
                  <details>
                    <summary className="flex cursor-pointer items-center gap-2 text-xs">
                      <Mark ok={t.enabled !== false} />
                      <span className="font-mono">{t.label ?? t.name}</span>
                      {t.configured === false && <span className="text-[var(--status-warning)]">needs key</span>}
                      {t.tools && <span className="text-muted-foreground">{t.tools.length} tools</span>}
                    </summary>
                    {t.tools && t.tools.length > 0 && (
                      <p className="mt-1 pl-6 font-mono text-[11px] text-muted-foreground">{t.tools.join(", ")}</p>
                    )}
                  </details>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
