"use client";

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
}: {
  project: Project;
  canDelete: boolean;
  onDeleted: () => void;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" className="min-h-10">
          <Settings aria-hidden="true" />
          Settings
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
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
