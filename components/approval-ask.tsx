"use client";

import { useState } from "react";
import { Hand } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { approvalQuestion, type PendingApproval } from "@/lib/approvals";

/**
 * Allow / Deny inside the agent's own bubble: the agent asks, in the chat,
 * before it changes a file or runs a command. Shows the oldest waiting call;
 * the rest follow one by one. `send` returns an error message, or null.
 */
export function ApprovalAsk({
  agentName,
  approvals,
  send,
  readOnly = false,
}: {
  agentName: string;
  approvals: PendingApproval[];
  send: (approval: PendingApproval, approve: boolean) => Promise<string | null>;
  readOnly?: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const ask = approvals[0];
  if (!ask) return null;
  const more = approvals.length - 1;

  async function decide(approve: boolean) {
    setBusy(ask.requestId);
    const error = await send(ask, approve);
    setBusy(null);
    if (error) toast.error(error);
    else toast.success(approve ? `${agentName} can go on` : `${agentName} was told no`);
  }

  return (
    <div className="ask-perm" role="group" aria-label={`${agentName} asks permission`}>
      <span className="story-meta">{agentName} · asks permission</span>
      <p className="text-sm">{approvalQuestion(ask.tool)}</p>
      <p className="ask-perm-code">
        <span className="ask-perm-tool">{ask.tool}</span>
        {ask.detail && <span className="ask-perm-detail">{ask.detail}</span>}
      </p>
      {readOnly ? (
        <p className="text-xs text-muted-foreground">Waiting for someone who can allow it.</p>
      ) : (
        <div className="ask-perm-actions">
          <Button onClick={() => void decide(true)} disabled={busy !== null}>
            Allow
          </Button>
          <Button variant="outline" onClick={() => void decide(false)} disabled={busy !== null}>
            Deny
          </Button>
        </div>
      )}
      {more > 0 && (
        <p className="text-xs text-muted-foreground">
          {more} more {more === 1 ? "request" : "requests"} after this one.
        </p>
      )}
    </div>
  );
}

/** The raised hand on a bot that is waiting for you. */
export function AskHand() {
  return (
    <span className="ask-hand" aria-hidden="true">
      <Hand className="size-3" />
    </span>
  );
}
