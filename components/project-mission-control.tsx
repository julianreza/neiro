"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { MissionWorkspace } from "@/components/mission-workspace";
import { StoryEmpty } from "@/components/history-story";
import type { SavedProject } from "@/lib/projects";

type Load = { state: "loading" } | { state: "missing" } | { state: "error"; message: string } | { state: "ready"; project: SavedProject };

/** /projects/<id>: loads the project, then shows its Mission control. */
export function ProjectMissionControl({ id }: { id: string }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/projects", { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : `Couldn't load (${res.status})`);
        const list: SavedProject[] = Array.isArray(data.projects) ? data.projects : [];
        const project = list.find((p) => p.id === id);
        if (!cancelled) setLoad(project ? { state: "ready", project } : { state: "missing" });
      })
      .catch((e: Error) => !cancelled && setLoad({ state: "error", message: e.message }));
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (load.state === "ready") {
    // Keyed so moving between projects starts a fresh composer and selection.
    return <MissionWorkspace key={load.project.id} project={load.project} />;
  }
  return (
    <div className="p-4 md:p-8">
      {load.state === "loading" && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading project…
        </p>
      )}
      {load.state === "error" && (
        <p className="text-sm text-destructive" role="alert">
          {load.message}
        </p>
      )}
      {load.state === "missing" && (
        <StoryEmpty
          title="Project not found"
          body={
            <>
              It may have been removed. Pick one on{" "}
              <Link href="/projects" className="text-primary hover:underline">
                Projects
              </Link>
              .
            </>
          }
        />
      )}
    </div>
  );
}
