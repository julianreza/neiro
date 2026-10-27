"use client";

import { ChevronDown } from "lucide-react";
import type { DemoTask, RouteAgentOption } from "@/lib/demo-missions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Router fields the two views read; a board task carries all of them. */
type RoutedTask = Pick<
  DemoTask,
  | "id"
  | "title"
  | "agent"
  | "routingStatus"
  | "layaAgentId"
  | "routeUrgency"
  | "routeNeedsHuman"
  | "routeConfidence"
  | "routeReason"
>;

const URGENCY_LABEL = ["Rendah", "Sedang", "Tinggi"] as const;

function urgencyLabel(urgency: number | null | undefined): string | null {
  return urgency === 0 || urgency === 1 || urgency === 2 ? URGENCY_LABEL[urgency] : null;
}

function agentLabel(id: string | null | undefined, agents: RouteAgentOption[]): string {
  if (!id) return "—";
  return agents.find((a) => a.id === id)?.name ?? id;
}

function Chip({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "primary" | "warning" }) {
  const toneClass =
    tone === "primary"
      ? "border-primary/30 bg-primary/10 text-primary"
      : tone === "warning"
        ? "border-status-warning/40 bg-status-warning/10 text-status-warning"
        : "border-border bg-secondary text-muted-foreground";
  return (
    <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${toneClass}`}>
      {children}
    </span>
  );
}

/**
 * "Alur tugas": Tugas → Laya → Agen. A dot travels the line only while Laya is
 * choosing (routing_status = routing); it stops once the route is stored.
 */
export function TaskRouteFlow({
  task,
  agents,
}: {
  task: RoutedTask;
  agents: RouteAgentOption[];
}) {
  if (!task.routingStatus) return null;

  const choosing = task.routingStatus === "routing";
  const target =
    task.routingStatus === "awaiting"
      ? `${agentLabel(task.layaAgentId, agents)}?`
      : choosing
        ? "…"
        : task.agent;
  const urgency = urgencyLabel(task.routeUrgency);

  return (
    <div className="mt-3 space-y-2">
      <div
        className="route-flow flex items-center gap-1.5 text-[9px] text-muted-foreground"
        data-routing={choosing ? "true" : "false"}
        role="img"
        aria-label={
          choosing
            ? "Laya sedang memilih agen untuk tugas ini"
            : `Alur tugas: Tugas ke Laya ke ${target}`
        }
      >
        <span className="route-flow-node">Tugas</span>
        <span className="route-flow-line" aria-hidden="true">
          <span className="route-flow-dot" />
        </span>
        <span className="route-flow-node route-flow-node-laya">Laya</span>
        <span className="route-flow-line" aria-hidden="true">
          <span className="route-flow-dot route-flow-dot-late" />
        </span>
        <span className="route-flow-node max-w-[7rem] truncate" title={target}>
          {target}
        </span>
      </div>
      {(urgency || task.routeNeedsHuman === false || task.routingStatus === "fallback" || task.routingStatus === "overridden") && (
        <div className="flex flex-wrap gap-1">
          {urgency && <Chip tone={task.routeUrgency === 2 ? "warning" : "muted"}>Urgensi {urgency.toLowerCase()}</Chip>}
          {task.routeNeedsHuman === false && <Chip tone="primary">tanpa manusia</Chip>}
          {task.routingStatus === "fallback" && <Chip tone="warning">fallback</Chip>}
          {task.routingStatus === "overridden" && <Chip>diganti manusia</Chip>}
        </div>
      )}
    </div>
  );
}

const STAGE_ORDER = ["workers", "orchestrator", "spec", "qa", "reviewer"];

/**
 * "Gerbang manusia": a task Laya held back. "Setujui" keeps Laya's pick;
 * "Ganti agen" assigns another enabled agent (both picks are stored).
 */
export function RoutingGateCard({
  task,
  agents,
  busy,
  onApprove,
  onOverride,
}: {
  task: RoutedTask;
  agents: RouteAgentOption[];
  busy: boolean;
  onApprove: () => void;
  onOverride: (agent: RouteAgentOption) => void;
}) {
  const layaAgent = agents.find((a) => a.id === task.layaAgentId) ?? null;
  const confidence =
    typeof task.routeConfidence === "number" ? task.routeConfidence.toFixed(2) : null;
  const urgency = urgencyLabel(task.routeUrgency);

  const groups = [...new Set(agents.map((a) => a.stage))].sort(
    (a, b) =>
      (STAGE_ORDER.indexOf(a) + 1 || 99) - (STAGE_ORDER.indexOf(b) + 1 || 99),
  );

  return (
    <article
      className="rounded-lg border border-l-4 border-l-status-warning bg-card p-4 text-card-foreground"
      aria-labelledby={`gate-${task.id}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="eyebrow">Gerbang manusia</span>
        <span className="code-chip">{task.id}</span>
        {urgency && <Chip tone={task.routeUrgency === 2 ? "warning" : "muted"}>Urgensi {urgency.toLowerCase()}</Chip>}
      </div>
      <h4 id={`gate-${task.id}`} className="mt-2 text-sm font-medium">
        {task.title}
      </h4>
      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-[auto_1fr] sm:gap-x-4">
        <dt className="text-muted-foreground">Usulan Laya</dt>
        <dd className="flex flex-wrap items-center gap-1.5">
          {task.layaAgentId ? <span className="code-chip">{task.layaAgentId}</span> : "—"}
          {layaAgent && <span>{layaAgent.name}</span>}
        </dd>
        <dt className="text-muted-foreground">Keyakinan</dt>
        <dd className="font-mono">{confidence ?? "—"}</dd>
        <dt className="text-muted-foreground">Alasan</dt>
        <dd>{task.routeReason || "Laya meminta keputusan manusia"}</dd>
      </dl>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" disabled={busy || !layaAgent} onClick={onApprove}>
          Setujui
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" disabled={busy || agents.length === 0}>
              Ganti agen
              <ChevronDown className="size-3.5" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-60">
            {groups.map((stage, index) => (
              <DropdownMenuGroup key={stage}>
                {index > 0 && <DropdownMenuSeparator />}
                <DropdownMenuLabel className="eyebrow">{stage}</DropdownMenuLabel>
                {agents
                  .filter((a) => a.stage === stage)
                  .map((agent) => (
                    <DropdownMenuItem
                      key={agent.id}
                      onSelect={() => onOverride(agent)}
                      disabled={agent.id === task.layaAgentId}
                    >
                      <span className="truncate">{agent.name}</span>
                      <span className="code-chip ml-auto text-[10px]">{agent.id}</span>
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuGroup>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {!layaAgent && task.layaAgentId && (
        <p className="mt-2 text-xs text-status-warning">
          Agen usulan Laya sudah tidak aktif. Pilih agen lain.
        </p>
      )}
    </article>
  );
}
