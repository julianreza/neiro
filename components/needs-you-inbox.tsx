"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRole } from "@/hooks/use-role";
import { missionHref, sendJson, timeAgo } from "@/lib/client-api";
import type { NeedsYouItem, NeedsYouKind } from "@/lib/needs-you";

type AgentOption = { id: string; name: string };

const KIND: Record<NeedsYouKind, { label: string; dot: string }> = {
  plan_approval: { label: "Approve plan", dot: "bg-amber-400" },
  pick_agent: { label: "Pick an agent", dot: "bg-sky-500" },
  budget: { label: "Budget reached", dot: "bg-orange-500" },
  task_failed: { label: "Task failed", dot: "bg-red-500" },
  mission_error: { label: "Mission stuck", dot: "bg-red-500" },
};

const POLL_MS = 15_000;

function itemKey(item: NeedsYouItem) {
  return `${item.kind}:${item.missionId}:${item.taskId ?? ""}`;
}

export function NeedsYouInbox() {
  const [items, setItems] = useState<NeedsYouItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const role = useRole();
  const canAct = role !== "viewer";

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/needs-you", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : `Couldn't load (${res.status})`);
        return;
      }
      setError(null);
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch {
      setError("Couldn't reach Neiro. Check your connection.");
    }
  }, []);

  useEffect(() => {
    // Polled: there's no push channel yet. Paused while the tab is hidden.
    const first = setTimeout(load, 0);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  useEffect(() => {
    fetch("/api/agents", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { agents?: Record<string, unknown>[] } | null) => {
        const rows = Array.isArray(data?.agents) ? data.agents : [];
        setAgents(
          rows
            .filter((r) => r.enabled !== false)
            .map((r) => ({ id: String(r.id ?? ""), name: String(r.name ?? r.id ?? "") }))
            .filter((a) => a.id)
        );
      })
      .catch(() => setAgents([]));
  }, []);

  async function act(item: NeedsYouItem, run: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    const key = itemKey(item);
    setBusy(key);
    const result = await run();
    setBusy(null);
    if (!result.ok) {
      toast.error(result.error ?? "That didn't work.");
      return;
    }
    toast.success(done);
    setItems((list) => list?.filter((i) => itemKey(i) !== key) ?? null);
    void load();
  }

  const missionUrl = (id: string) => `/api/missions/${encodeURIComponent(id)}`;
  const taskUrl = (item: NeedsYouItem) =>
    `${missionUrl(item.missionId)}/tasks/${encodeURIComponent(item.taskId ?? "")}/control`;

  const oldest = items?.reduce<string | null>(
    (min, i) => (i.since && (!min || i.since < min) ? i.since : min),
    null
  );

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="flex items-center gap-3 text-2xl font-semibold">
          Needs you
          {items && items.length > 0 && (
            <span className="rounded-full border border-primary px-2.5 text-sm font-medium text-primary">
              {items.length}
            </span>
          )}
        </h1>
        {oldest && <p className="text-sm text-muted-foreground">Oldest is waiting since {timeAgo(oldest)}</p>}
      </div>
      {!canAct && (
        <p className="mt-2 text-sm text-muted-foreground">You can view this list. An admin has to take the actions.</p>
      )}

      {error && (
        <p role="alert" className="mt-4 rounded-xl border border-destructive/40 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {items === null && !error && (
        <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </p>
      )}

      {items && items.length === 0 && (
        <div className="mt-6 rounded-2xl border bg-card p-8 text-center text-card-foreground">
          <CheckCircle2 className="mx-auto size-8 text-primary" />
          <p className="mt-2 font-medium">Nothing is waiting on you</p>
          <p className="text-sm text-muted-foreground">New approvals and stuck tasks show up here.</p>
        </div>
      )}

      {items && items.length > 0 && (
        <ul className="mt-4 divide-y overflow-hidden rounded-2xl border bg-card text-card-foreground">
          {items.map((item) => (
            <NeedsYouRow
              key={itemKey(item)}
              item={item}
              agents={agents}
              busy={busy === itemKey(item)}
              canAct={canAct}
              onApprovePlan={() =>
                act(item, () => sendJson(`${missionUrl(item.missionId)}/control`, "POST", { action: "approve_plan" }), "Plan approved")
              }
              onAssign={(agentId) =>
                act(
                  item,
                  () =>
                    sendJson(
                      taskUrl(item),
                      "POST",
                      agentId === item.suggestedAgentId
                        ? { action: "approve_route" }
                        : { action: "override_route", agentId }
                    ),
                  "Agent assigned"
                )
              }
              onRaiseBudget={(limit) =>
                act(
                  item,
                  async () => {
                    const patched = await sendJson(missionUrl(item.missionId), "PATCH", { token_budget: limit });
                    if (!patched.ok) return patched;
                    return sendJson(taskUrl(item), "POST", { action: "retry" });
                  },
                  "Budget raised. The task will run again."
                )
              }
              onRetry={() => act(item, () => sendJson(taskUrl(item), "POST", { action: "retry" }), "Task queued again")}
              onMarkDone={() => act(item, () => sendJson(taskUrl(item), "POST", { action: "mark_done" }), "Task marked done")}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function NeedsYouRow({
  item,
  agents,
  busy,
  canAct,
  onApprovePlan,
  onAssign,
  onRaiseBudget,
  onRetry,
  onMarkDone,
}: {
  item: NeedsYouItem;
  agents: AgentOption[];
  busy: boolean;
  canAct: boolean;
  onApprovePlan: () => void;
  onAssign: (agentId: string) => void;
  onRaiseBudget: (limit: number) => void;
  onRetry: () => void;
  onMarkDone: () => void;
}) {
  const [agentId, setAgentId] = useState(item.suggestedAgentId ?? "");
  const [limit, setLimit] = useState("");
  const kind = KIND[item.kind];
  const pickId = agentId || agents[0]?.id || "";
  const subject = item.taskTitle ? `"${item.taskTitle}"` : item.missionTitle;
  const limitNumber = Number.parseInt(limit, 10);

  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
      <span aria-hidden="true" className={`hidden size-2.5 shrink-0 rounded-full sm:block ${kind.dot}`} />
      <div className="min-w-0 flex-1">
        <p>
          <span className="font-semibold">{kind.label}</span>
          <span className="text-muted-foreground"> · </span>
          <span className="break-words">{subject}</span>
        </p>
        <p className="text-sm text-muted-foreground">
          {item.taskTitle && <>{item.missionTitle} · </>}
          {item.detail}
          {item.since && <> · {timeAgo(item.since)}</>}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          {/* Plain link: /missions/<id> is a redirect, not a page. */}
          <a href={missionHref(item.missionId)}>Open mission</a>
        </Button>
        {canAct && item.kind === "plan_approval" && (
          <Button size="sm" disabled={busy} onClick={onApprovePlan}>
            Approve
          </Button>
        )}
        {canAct && item.kind === "pick_agent" && (
          <>
            <label className="sr-only" htmlFor={`agent-${item.taskId}`}>
              Agent for {subject}
            </label>
            <select
              id={`agent-${item.taskId}`}
              className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
              value={pickId}
              onChange={(e) => setAgentId(e.target.value)}
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.id === item.suggestedAgentId ? " (Laya's pick)" : ""}
                </option>
              ))}
            </select>
            <Button size="sm" disabled={busy || !pickId} onClick={() => onAssign(pickId)}>
              Assign
            </Button>
          </>
        )}
        {canAct && item.kind === "budget" && (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (limitNumber > 0) onRaiseBudget(limitNumber);
            }}
          >
            <label className="sr-only" htmlFor={`limit-${item.taskId}`}>
              New token budget for {item.missionTitle}
            </label>
            <Input
              id={`limit-${item.taskId}`}
              type="number"
              min="1"
              step="1000"
              inputMode="numeric"
              placeholder="New limit"
              className="h-8 w-28"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
            />
            <Button size="sm" type="submit" disabled={busy || !(limitNumber > 0)}>
              Raise and retry
            </Button>
          </form>
        )}
        {canAct && item.kind === "task_failed" && (
          <>
            <Button size="sm" variant="outline" disabled={busy} onClick={onMarkDone}>
              Mark done
            </Button>
            <Button size="sm" disabled={busy} onClick={onRetry}>
              Retry
            </Button>
          </>
        )}
      </div>
    </li>
  );
}
