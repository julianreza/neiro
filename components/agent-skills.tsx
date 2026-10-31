"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Loader2, Puzzle, Search, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useRole } from "@/hooks/use-role";

type Skill = {
  name: string;
  category: string;
  source: string;
  trust: string;
  enabled: boolean;
  removable: boolean;
};

type Hit = { name: string; identifier: string; source: string; trust: string; description: string };

type Props = {
  agentId: string;
  profile: string;
  /** Other agents on the same Hermes profile; they get every skill change too. */
  sharedWith: string[];
  readOnly: boolean;
  /** Inside the add-ons tabs: no own heading or top border. */
  bare?: boolean;
};

async function readError(res: Response) {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error || `HTTP ${res.status}`;
}

/** Skill tab on a Hermes agent card: turn installed skills on/off, find and install new ones. */
export function AgentSkills({ agentId, profile, sharedWith, readOnly, bare = false }: Props) {
  const role = useRole();
  const canEdit = !readOnly && role !== "viewer";
  const base = `/api/agents/${encodeURIComponent(agentId)}/skills`;
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [filter, setFilter] = useState("");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(base, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(await readError(res));
        return (await res.json()) as { skills: Skill[] };
      })
      .then((data) => alive && setSkills(data.skills))
      .catch((err: unknown) => alive && setLoadError(err instanceof Error ? err.message : "Could not load skills"));
    return () => {
      alive = false;
    };
  }, [base]);

  async function act(key: string, body: Record<string, unknown>, done: string) {
    setBusy(key);
    try {
      const res = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await readError(res));
      const data = (await res.json()) as { skills: Skill[] };
      setSkills(data.skills);
      toast.success(done);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Skill change failed");
    } finally {
      setBusy(null);
    }
  }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`${base}?q=${encodeURIComponent(query.trim())}`, { cache: "no-store" });
      if (!res.ok) throw new Error(await readError(res));
      setHits(((await res.json()) as { results: Hit[] }).results);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Search failed");
      setHits([]);
    } finally {
      setSearching(false);
    }
  }

  const installed = new Set(skills?.map((s) => s.name));
  const shown = (skills ?? []).filter((s) =>
    `${s.name} ${s.category}`.toLowerCase().includes(filter.trim().toLowerCase()),
  );
  const onCount = skills?.filter((s) => s.enabled).length ?? 0;

  return (
    <section className={bare ? "space-y-2" : "agent-skills space-y-2"} aria-label="Skills">
      <div className="flex items-center justify-between gap-2">
        {bare ? (
          <span className="text-xs text-muted-foreground">Instructions the agent can load.</span>
        ) : (
          <h4 className="flex items-center gap-1.5 text-sm font-bold">
            <Puzzle className="size-4" aria-hidden="true" />
            Skills
          </h4>
        )}
        {skills && (
          <span className="text-xs text-muted-foreground">
            {onCount} of {skills.length} on
          </span>
        )}
      </div>

      {sharedWith.length > 0 && (
        <p className="flex items-start gap-1.5 rounded-lg bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
          <TriangleAlert className="size-3.5 shrink-0 translate-y-0.5" aria-hidden="true" />
          Profile <code className="code-chip">{profile}</code> is shared. {sharedWith.join(", ")} also get these
          changes.
        </p>
      )}

      {loadError ? (
        <p className="rounded-lg bg-destructive/10 p-2 text-xs text-destructive">{loadError}</p>
      ) : !skills ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          Reading skills…
        </p>
      ) : (
        <>
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter installed skills"
            aria-label="Filter installed skills"
            className="agent-skill-input h-9 text-xs"
          />
          <ul className="agent-skill-list max-h-56 space-y-1 overflow-y-auto pr-1">
            {shown.map((s) => (
              <li key={s.name} className="agent-skill-row">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold">{s.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {s.category || "general"} · {s.source}
                  </p>
                </div>
                {s.removable && canEdit && (
                  <Button
                    variant="ghost"
                    className="size-8"
                    aria-label={`Remove ${s.name}`}
                    disabled={busy !== null}
                    onClick={() => act(`rm:${s.name}`, { action: "uninstall", name: s.name }, `${s.name} removed`)}
                  >
                    {busy === `rm:${s.name}` ? <Loader2 className="animate-spin" /> : <Trash2 />}
                  </Button>
                )}
                <Switch
                  checked={s.enabled}
                  disabled={!canEdit || busy !== null}
                  aria-label={`${s.enabled ? "Turn off" : "Turn on"} ${s.name}`}
                  onCheckedChange={(enabled) =>
                    act(`t:${s.name}`, { action: "toggle", name: s.name, enabled }, `${s.name} ${enabled ? "on" : "off"}`)
                  }
                />
              </li>
            ))}
            {shown.length === 0 && <li className="p-2 text-xs text-muted-foreground">No skill matches.</li>}
          </ul>

          {canEdit && (
            <form onSubmit={search} className="flex gap-1.5">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find a new skill"
                aria-label="Find a new skill"
                className="agent-skill-input h-9 text-xs"
              />
              <Button type="submit" className="h-9 px-3" disabled={searching || !query.trim()}>
                {searching ? <Loader2 className="animate-spin" /> : <Search />}
                <span className="sr-only">Search</span>
              </Button>
            </form>
          )}

          {hits && (
            <ul className="space-y-1" aria-label="Search results">
              {hits.length === 0 && <li className="p-2 text-xs text-muted-foreground">Nothing found.</li>}
              {hits.map((h) => {
                const have = installed.has(h.name);
                const key = `in:${h.identifier}`;
                return (
                  <li key={h.identifier} className="agent-skill-row">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold">{h.name}</p>
                      <p className="truncate text-[11px] text-muted-foreground" title={h.description}>
                        {h.source} · {h.trust}
                      </p>
                    </div>
                    <Button
                      variant={have ? "outline" : "default"}
                      className="h-8 px-3 text-xs"
                      disabled={have || busy !== null}
                      onClick={() =>
                        act(key, { action: "install", identifier: h.identifier }, `${h.name} installed on ${profile}`)
                      }
                    >
                      {busy === key ? <Loader2 className="animate-spin" /> : have ? "Installed" : "Install"}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
