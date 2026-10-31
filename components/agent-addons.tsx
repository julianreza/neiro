"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Blocks, KeyRound, RotateCw, Loader2, Plug, Puzzle, Search, Trash2, TriangleAlert, Wrench } from "lucide-react";
import { toast } from "sonner";
import { AgentSkills } from "@/components/agent-skills";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRole } from "@/hooks/use-role";

type Kind = "mcp" | "plugin" | "toolset";
type KeyVar = { name: string; set: boolean };
type Item = { name: string; detail: string; enabled: boolean; removable: boolean; keys?: KeyVar[]; oauth?: boolean };
type Hit = { id: string; name: string; detail: string; description: string };

const KIND: Record<Kind, { label: string; filter: string; find?: string; empty: string; ram?: boolean }> = {
  mcp: { label: "MCP servers", filter: "Filter MCP servers", find: "Find in the MCP catalog", empty: "No MCP server yet.", ram: true },
  plugin: { label: "Plugins", filter: "Filter plugins", find: "Find a plugin", empty: "No plugin.", ram: true },
  toolset: { label: "Toolsets", filter: "Filter toolsets", empty: "No toolset." },
};

type Props = {
  agentId: string;
  profile: string;
  /** Other agents on the same Hermes profile; they get every change too. */
  sharedWith: string[];
  readOnly: boolean;
};

async function readError(res: Response) {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error || `HTTP ${res.status}`;
}

/** Hermes add-ons of an agent's profile in the edit dialog: Skills, MCP, Plugins, Toolsets. */
export function AgentAddons({ agentId, profile, sharedWith, readOnly }: Props) {
  return (
    <section className="agent-skills space-y-3" aria-label="Hermes add-ons">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-sm font-bold">
          <Blocks className="size-4" aria-hidden="true" />
          Hermes add-ons
          <code className="code-chip ml-1 font-normal">{profile}</code>
        </h4>
        {!readOnly && <RestartHermes agentId={agentId} />}
      </div>
      {sharedWith.length > 0 && (
        <p className="flex items-start gap-1.5 rounded-lg bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
          <TriangleAlert className="size-3.5 shrink-0 translate-y-0.5" aria-hidden="true" />
          This profile is shared. {sharedWith.join(", ")} also get these changes.
        </p>
      )}
      <Tabs defaultValue="skill">
        <TabsList className="w-full">
          <TabsTrigger value="skill"><Puzzle aria-hidden="true" />Skills</TabsTrigger>
          <TabsTrigger value="mcp"><Plug aria-hidden="true" />MCP</TabsTrigger>
          <TabsTrigger value="plugin"><Blocks aria-hidden="true" />Plugins</TabsTrigger>
          <TabsTrigger value="toolset"><Wrench aria-hidden="true" />Toolsets</TabsTrigger>
        </TabsList>
        <TabsContent value="skill" className="pt-2">
          <AgentSkills agentId={agentId} profile={profile} sharedWith={[]} readOnly={readOnly} bare />
        </TabsContent>
        {(Object.keys(KIND) as Kind[]).map((kind) => (
          <TabsContent key={kind} value={kind} className="pt-2">
            <AddonPanel kind={kind} agentId={agentId} profile={profile} readOnly={readOnly} />
          </TabsContent>
        ))}
      </Tabs>
    </section>
  );
}

function AddonPanel({ kind, agentId, profile, readOnly }: { kind: Kind; agentId: string; profile: string; readOnly: boolean }) {
  const role = useRole();
  const canEdit = !readOnly && role !== "viewer";
  const meta = KIND[kind];
  const base = `/api/agents/${encodeURIComponent(agentId)}/addons`;
  const [items, setItems] = useState<Item[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [filter, setFilter] = useState("");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [keysFor, setKeysFor] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`${base}?kind=${kind}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(await readError(res));
        return (await res.json()) as { items: Item[] };
      })
      .then((data) => alive && setItems(data.items))
      .catch((err: unknown) => alive && setLoadError(err instanceof Error ? err.message : "Could not load"));
    return () => {
      alive = false;
    };
  }, [base, kind]);

  async function act(key: string, body: Record<string, unknown>, done: string): Promise<boolean> {
    setBusy(key);
    try {
      const res = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, ...body }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const data = (await res.json()) as { items: Item[]; note?: string };
      setItems(data.items);
      if (data.note) setNote(data.note);
      toast.success(done);
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Change failed");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearching(true);
    try {
      const res = await fetch(`${base}?kind=${kind}&q=${encodeURIComponent(query.trim())}`, { cache: "no-store" });
      if (!res.ok) throw new Error(await readError(res));
      setHits(((await res.json()) as { results: Hit[] }).results);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Search failed");
      setHits([]);
    } finally {
      setSearching(false);
    }
  }

  if (loadError) return <p className="rounded-lg bg-destructive/10 p-2 text-xs text-destructive">{loadError}</p>;
  if (!items) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        Reading {meta.label.toLowerCase()}…
      </p>
    );
  }

  const have = new Set(items.map((i) => i.name));
  const shown = items.filter((i) => `${i.name} ${i.detail}`.toLowerCase().includes(filter.trim().toLowerCase()));
  const onCount = items.filter((i) => i.enabled).length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{meta.ram ? "Each one on runs its own process and uses RAM." : "Built-in tool groups for this profile."}</span>
        <span className="shrink-0">{onCount} of {items.length} on</span>
      </div>
      {items.length > 6 && (
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={meta.filter} aria-label={meta.filter} className="h-9 text-xs" />
      )}
      <ul className="agent-skill-list max-h-56 space-y-1 overflow-y-auto pr-1">
        {shown.map((i) => {
          const needsKeys = (i.keys?.length ?? 0) > 0 || i.oauth;
          const missing = i.keys?.filter((k) => !k.set).length ?? 0;
          return (
          <li key={i.name} className="space-y-1">
          <div className="agent-skill-row">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold">{i.name}</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {i.detail}
                {missing > 0 && <span className="text-amber-700 dark:text-amber-300"> · {missing} key{missing > 1 ? "s" : ""} missing</span>}
              </p>
            </div>
            {needsKeys && canEdit && (
              <Button
                variant="ghost"
                className="relative size-8"
                aria-label={`API keys for ${i.name}`}
                aria-expanded={keysFor === i.name}
                onClick={() => setKeysFor(keysFor === i.name ? null : i.name)}
              >
                <KeyRound />
                {missing > 0 && <i className="absolute right-1 top-1 size-2 rounded-full bg-amber-500" aria-hidden="true" />}
              </Button>
            )}
            {i.removable && canEdit && (
              <Button
                variant="ghost"
                className="size-8"
                aria-label={`Remove ${i.name}`}
                disabled={busy !== null}
                onClick={() => act(`rm:${i.name}`, { action: "remove", id: i.name }, `${i.name} removed`)}
              >
                {busy === `rm:${i.name}` ? <Loader2 className="animate-spin" /> : <Trash2 />}
              </Button>
            )}
            <Switch
              checked={i.enabled}
              disabled={!canEdit || busy !== null}
              aria-label={`${i.enabled ? "Turn off" : "Turn on"} ${i.name}`}
              onCheckedChange={(enabled) =>
                act(`t:${i.name}`, { action: "toggle", id: i.name, enabled }, `${i.name} ${enabled ? "on" : "off"}`)
              }
            />
          </div>
          {keysFor === i.name && (
            <McpKeyForm
              item={i}
              profile={profile}
              busy={busy === `k:${i.name}`}
              onSave={async (values) => {
                if (await act(`k:${i.name}`, { action: "keys", id: i.name, values }, `Keys saved for ${i.name}`)) setKeysFor(null);
              }}
            />
          )}
          </li>
          );
        })}
        {shown.length === 0 && <li className="p-2 text-xs text-muted-foreground">{items.length ? "Nothing matches." : meta.empty}</li>}
      </ul>

      {note && (
        <pre className="whitespace-pre-wrap rounded-lg bg-muted p-2 text-[11px] text-muted-foreground">{note}</pre>
      )}

      {canEdit && meta.find && (
        <form onSubmit={search} className="flex gap-1.5">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={meta.find} aria-label={meta.find} className="h-9 text-xs" />
          <Button type="submit" className="h-9 px-3" disabled={searching}>
            {searching ? <Loader2 className="animate-spin" /> : <Search />}
            <span className="sr-only">Search</span>
          </Button>
        </form>
      )}

      {hits && (
        <ul className="max-h-64 space-y-1 overflow-y-auto pr-1" aria-label="Search results">
          {hits.length === 0 && <li className="p-2 text-xs text-muted-foreground">Nothing found.</li>}
          {hits.map((h) => {
            const installed = have.has(h.name);
            const key = `in:${h.id}`;
            return (
              <li key={h.id} className="agent-skill-row">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold">{h.name}</p>
                  <p className="line-clamp-2 text-[11px] text-muted-foreground" title={h.description}>
                    {h.description || h.detail}
                  </p>
                </div>
                <Button
                  variant={installed ? "outline" : "default"}
                  className="h-8 px-3 text-xs"
                  disabled={installed || busy !== null}
                  onClick={() => act(key, { action: "install", id: h.id }, `${h.name} installed on ${profile}`)}
                >
                  {busy === key ? <Loader2 className="animate-spin" /> : installed ? "Installed" : "Install"}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Key form for one MCP server. Values stay in the browser until Save; saved ones are never shown again. */
function McpKeyForm({
  item,
  profile,
  busy,
  onSave,
}: {
  item: Item;
  profile: string;
  busy: boolean;
  onSave: (values: Record<string, string>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const keys = item.keys ?? [];
  const login = `hermes ${profile === "default" ? "" : `-p ${profile} `}mcp login ${item.name}`;
  const filled = Object.values(values).some((v) => v.trim());

  return (
    <form
      className="space-y-2 rounded-xl border border-dashed p-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(values);
      }}
    >
      {keys.map((k) => (
        <div key={k.name} className="space-y-1">
          <label htmlFor={`mcp-key-${item.name}-${k.name}`} className="flex items-center justify-between gap-2 text-[11px] font-semibold">
            <code className="code-chip">{k.name}</code>
            <span className={k.set ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}>
              {k.set ? "Saved" : "Not set"}
            </span>
          </label>
          <Input
            id={`mcp-key-${item.name}-${k.name}`}
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={values[k.name] ?? ""}
            onChange={(e) => setValues({ ...values, [k.name]: e.target.value })}
            placeholder={k.set ? "Type to replace the saved value" : "Paste the key"}
            className="h-9 font-mono text-xs"
          />
        </div>
      ))}
      {item.oauth && (
        <p className="text-[11px] text-muted-foreground">
          This server also signs in through a browser. Run once in a terminal:{" "}
          <code className="code-chip break-all">{login}</code>
        </p>
      )}
      {keys.length > 0 && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">Saved to this profile&apos;s .env. Press Restart Hermes to apply.</span>
          <Button type="submit" className="h-8 px-3 text-xs" disabled={busy || !filled}>
            {busy ? <Loader2 className="animate-spin" /> : "Save keys"}
          </Button>
        </div>
      )}
    </form>
  );
}

/**
 * Restarts the one local Hermes gateway (all profiles). Hermes is offline for a few
 * seconds. While runs are live it asks before interrupting them.
 */
function RestartHermes({ agentId }: { agentId: string }) {
  const role = useRole();
  const [state, setState] = useState<"idle" | "working">("idle");
  const [busyNote, setBusyNote] = useState("");

  if (role === "viewer") return null;

  async function restart(interrupt: boolean) {
    setState("working");
    setBusyNote("");
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/hermes-restart`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interrupt }),
      });
      const data = (await res.json().catch(() => null)) as
        | { error?: string; busy?: boolean; healthy?: boolean; seconds?: number }
        | null;
      if (res.status === 409 && data?.busy) {
        setBusyNote(data.error || "Work is still running.");
        return;
      }
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      if (data?.healthy) toast.success(`Hermes is back (${data.seconds ?? "?"}s)`);
      else toast.warning("Hermes restarted but is not answering yet. Check again in a moment.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Restart failed");
    } finally {
      setState("idle");
    }
  }

  return (
    <>
      <Button variant="outline" className="h-8 px-3 text-xs" disabled={state === "working"} onClick={() => restart(false)}>
        {state === "working" ? <Loader2 className="animate-spin" /> : <RotateCw />}
        {state === "working" ? "Restarting…" : "Restart Hermes"}
      </Button>
      {busyNote && (
        <div role="alert" className="basis-full space-y-2 rounded-lg bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
          <p>{busyNote}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" className="h-8 px-3 text-xs" onClick={() => setBusyNote("")}>
              Wait
            </Button>
            <Button variant="destructive" className="h-8 px-3 text-xs" disabled={state === "working"} onClick={() => restart(true)}>
              Stop runs and restart
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
