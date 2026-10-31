"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ProjectDefaults } from "@/lib/project-defaults";
import { Settings } from "lucide-react";
import { DeleteButton } from "@/components/delete-button";
import { CopyButton } from "@/components/agent-markdown";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { Project } from "@/lib/projects";

/** One project's settings: where it lives, and the red Delete at the bottom. */
export function ProjectSettings({
  project,
  canDelete,
  onDeleted,
  onDefaultsChanged,
}: {
  project: Project;
  canDelete: boolean;
  onDeleted: () => void;
  onDefaultsChanged: (defaults: ProjectDefaults) => void;
}) {
  const [defaults, setDefaults] = useState<ProjectDefaults>(project.defaults);
  const [saving, setSaving] = useState(false);
  async function saveDefaults() {
    setSaving(true);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ defaults }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save defaults");
      onDefaultsChanged(data.defaults);
      toast.success("Project defaults saved");
    } catch (err) { toast.error(err instanceof Error ? err.message : "Could not save defaults"); } finally { setSaving(false); }
  }
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" className="min-h-10">
          <Settings aria-hidden="true" />
          Settings
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{project.name} settings</DialogTitle>
          <DialogDescription>Where this project lives.</DialogDescription>
        </DialogHeader>

        <dl className="project-settings">
          <div>
            <dt>Folder</dt>
            <dd className="flex items-center gap-2">
              <span className="code-chip min-w-0 flex-1 break-all">{project.path}</span>
              <CopyButton text={project.path} label="Copy path" />
            </dd>
          </div>
          <div>
            <dt>Git</dt>
            <dd>{project.git ? "Yes, a git repo" : "No, a plain folder"}</dd>
          </div>
          {project.baseBranch && (
            <div>
              <dt>Base branch</dt>
              <dd>
                <span className="code-chip">{project.baseBranch}</span>
              </dd>
            </div>
          )}
        </dl>

        <section className="space-y-3" aria-labelledby="defaults-title">
          <h3 id="defaults-title" className="font-semibold">Mission defaults</h3>
          <p className="text-xs text-muted-foreground">Applied to new missions in this project. Each mission can override them.</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label htmlFor="project-default-branch">Base branch</Label><Input id="project-default-branch" value={String(defaults.base_branch ?? "")} disabled={!canDelete} placeholder="Current branch" onChange={(e) => setDefaults({ ...defaults, base_branch: e.target.value || null })} /></div>
            <div className="space-y-1"><Label htmlFor="project-default-budget">Token budget</Label><Input id="project-default-budget" type="number" min="0" max="1000000000" value={String(defaults.token_budget ?? "")} disabled={!canDelete} placeholder="No limit" onChange={(e) => setDefaults({ ...defaults, token_budget: e.target.value === "" ? null : Number(e.target.value) })} /></div>
            <div className="space-y-1"><Label htmlFor="project-default-workers">Parallel workers</Label><Input id="project-default-workers" type="number" min="1" max="10" value={String(defaults.max_parallel_workers ?? 3)} disabled={!canDelete} onChange={(e) => setDefaults({ ...defaults, max_parallel_workers: Number(e.target.value) })} /></div>
            <div className="space-y-1"><Label htmlFor="project-default-retries">Max auto-fix retries</Label><Input id="project-default-retries" type="number" min="0" max="5" value={String(defaults.max_retries ?? 2)} disabled={!canDelete} onChange={(e) => setDefaults({ ...defaults, max_retries: Number(e.target.value) })} /></div>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!canDelete} checked={defaults.pause_after_planning === true} onChange={(e) => setDefaults({ ...defaults, pause_after_planning: e.target.checked })} />Pause after PRD review</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!canDelete} checked={defaults.isolate_workspace !== false} onChange={(e) => setDefaults({ ...defaults, isolate_workspace: e.target.checked })} />Work on a new branch</label>
          {canDelete && <Button type="button" size="sm" disabled={saving} onClick={() => void saveDefaults()}>{saving ? "Saving…" : "Save defaults"}</Button>}
        </section>

        {canDelete && (
          <section className="project-danger" aria-labelledby="project-danger-title">
            <div className="min-w-0">
              <h3 id="project-danger-title" className="text-sm font-semibold">
                Delete project
              </h3>
              <p className="text-xs text-muted-foreground">
                Removes it from the list. The folder, missions and chats stay.
              </p>
            </div>
            <DeleteButton
              tone="danger"
              label="Delete project"
              url={`/api/projects/${encodeURIComponent(project.id)}`}
              what="Project"
              title={`Delete ${project.name}?`}
              body={
                <>
                  <p>It leaves the Projects list. The folder on disk is not touched.</p>
                  <p>Its missions and chats are kept. Add the folder again to get them back.</p>
                </>
              }
              onDeleted={onDeleted}
            />
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
}
