"use client";

import { useState, type ReactNode } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * A trash button that asks first. `url` gets a DELETE; `onDeleted` runs when
 * it worked. `disabledReason` shows instead of deleting (e.g. still running).
 */
export function DeleteButton({
  url,
  what,
  title,
  body,
  onDeleted,
  disabledReason,
  label = "Delete",
  tone = "ghost",
}: {
  url: string;
  /** Short name for the toast, e.g. "Mission". */
  what: string;
  title: string;
  body: ReactNode;
  onDeleted: () => void;
  disabledReason?: string;
  label?: string;
  /** "danger" = a solid red button (for settings panels). */
  tone?: "ghost" | "danger";
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch(url, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? `Couldn't delete (${res.status})`);
        return;
      }
      toast.success(`${what} deleted`);
      setOpen(false);
      onDeleted();
    } catch {
      toast.error("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
      <DialogTrigger asChild>
        <Button
          variant={tone === "danger" ? "destructive" : "ghost"}
          size={tone === "danger" ? "default" : "sm"}
          className={tone === "danger" ? "min-h-10" : "delete-trigger"}
          aria-label={label === "Delete" ? `Delete ${what.toLowerCase()}` : undefined}
        >
          <Trash2 aria-hidden="true" />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2">{disabledReason ?? body}</div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            {disabledReason ? "OK" : "Keep it"}
          </Button>
          {!disabledReason && (
            <Button variant="destructive" onClick={() => void remove()} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
              Delete
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
