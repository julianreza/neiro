"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { SubagentRun } from "@/lib/types";

export function SubagentTranscript({ run, agentId }: { run: SubagentRun; agentId: string | null }) {
  const [open, setOpen] = useState(false);
  const [includeCompacted, setIncludeCompacted] = useState(false);
  const [retry, setRetry] = useState(0);
  const [messages, setMessages] = useState<{ role: string; content: string }[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open || !run.childSessionId || !agentId) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ agentId, include_compacted: String(includeCompacted), inline_images: "false" });
    fetch(`/api/hermes/sessions/${encodeURIComponent(run.childSessionId)}/messages?${query}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Could not load transcript.");
        if (!Array.isArray(data.messages)) throw new Error("Invalid transcript response.");
        if (!controller.signal.aborted) { setMessages(data.messages); setError(""); }
      })
      .catch((err: unknown) => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Could not load transcript."); });
    return () => controller.abort();
  }, [open, run.childSessionId, agentId, includeCompacted, retry]);

  if (!run.childSessionId || !agentId) return <span className="text-xs text-muted-foreground">Transcript unavailable: {!run.childSessionId ? "session ID missing" : "source agent missing"}.</span>;
  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) { setMessages(null); setError(""); } }}>
      <DialogTrigger asChild><Button type="button" variant="outline" size="sm">View transcript</Button></DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>Subagent transcript</DialogTitle><DialogDescription>Delegation {run.delegationId} · Agent {agentId}</DialogDescription></DialogHeader>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeCompacted} onChange={(event) => { setMessages(null); setError(""); setIncludeCompacted(event.target.checked); }} /> Include compacted history</label>
        {error ? <div role="alert"><p>{error}</p><Button variant="outline" size="sm" onClick={() => { setError(""); setMessages(null); setRetry((n) => n + 1); }}>Retry</Button></div>
          : messages === null ? <p role="status">Loading transcript…</p>
          : messages.length === 0 ? <p>No messages available.</p>
          : <ol className="space-y-3">{messages.map((message, i) => <li key={i} className="min-w-0 rounded-lg bg-secondary/30 p-3"><p className="text-xs font-semibold">{message.role}</p><pre className="mt-1 whitespace-pre-wrap break-words font-sans text-sm">{message.content}</pre></li>)}</ol>}
      </DialogContent>
    </Dialog>
  );
}
