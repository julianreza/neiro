"use client";

import { useState } from "react";
import Link from "next/link";
import { GitBranch, GitPullRequest, ScanSearch, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type WorktreeBarProps = {
  missionId: string;
  branch: string;
  baseBranch: string | null;
  /** Mission status; discarding is allowed only once the mission has stopped. */
  status: string;
  /** Called after the worktree was deleted, so the parent can reload. */
  onDiscarded: () => void;
  /** The mission's draft PR (Build / Fix), once it has one. */
  prUrl?: string | null;
  prNumber?: number | null;
  /** The mission's newest code review on /reviews. */
  reviewHref?: string | null;
};

const STOPPED = new Set(["cancelled", "completed"]);

/**
 * Shows the mission's git branch and the rollback action (option B).
 * Only rendered for missions that run in a worktree.
 */
export function WorktreeBar({ missionId, branch, baseBranch, status, onDiscarded, prUrl, prNumber, reviewHref }: WorktreeBarProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const stopped = STOPPED.has(status);

  async function discard() {
    setBusy(true);
    try {
      const res = await fetch(`/api/missions/${encodeURIComponent(missionId)}/control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "discard_worktree" }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? `Request failed (${res.status})`);
        return;
      }
      toast.success(`Deleted ${branch} and its worktree`);
      setOpen(false);
      onDiscarded();
    } catch {
      toast.error("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3 text-card-foreground">
      <p className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
        <GitBranch className="size-4 text-muted-foreground" aria-hidden="true" />
        <span className="text-muted-foreground">Branch</span>
        <code className="code-chip break-all">{branch}</code>
        {baseBranch && (
          <span className="text-muted-foreground">
            from <code className="code-chip break-all">{baseBranch}</code>
          </span>
        )}
        {prUrl && (
          <a
            href={prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
          >
            <GitPullRequest className="size-4" aria-hidden="true" />
            Draft PR{prNumber ? ` #${prNumber}` : ""} ↗
          </a>
        )}
        {reviewHref && (
          <Link href={reviewHref} className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
            <ScanSearch className="size-4" aria-hidden="true" />
            Open review
          </Link>
        )}
      </p>
      <div className="flex items-center gap-3">
        {!stopped && (
          <span id="discard-worktree-reason" className="text-xs text-muted-foreground">
            Cancel the mission first
          </span>
        )}
        <Button
          size="sm"
          variant="outline"
          className="border-destructive/60 text-destructive hover:bg-destructive/10 hover:text-destructive"
          disabled={!stopped}
          aria-describedby={!stopped ? "discard-worktree-reason" : undefined}
          onClick={() => setOpen(true)}
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
          Discard worktree…
        </Button>
      </div>
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard this worktree?</DialogTitle>
            <DialogDescription>
              This deletes branch <code className="code-chip">{branch}</code> and its folder, including every
              commit the agents made on it. Your own checkout is not touched. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={busy}>
                Keep it
              </Button>
            </DialogClose>
            <Button variant="destructive" disabled={busy} onClick={() => void discard()}>
              {busy ? "Deleting…" : "Delete branch and worktree"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
