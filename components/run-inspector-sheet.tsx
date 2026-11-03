"use client";

import { useState } from "react";
import { Check, GitBranch, Terminal } from "lucide-react";
import { toast } from "sonner";
import type { DemoTask, TaskStage } from "@/lib/demo-missions";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatTokens } from "@/lib/client-api";
import type { SubagentRun } from "@/lib/types";
import { SubagentTranscript } from "@/components/subagent-transcript";

/** What the live task row knows about its runs (live missions only). */
export type InspectorFacts = {
  cacheReadTokens: number;
  cacheWriteTokens: number;
  runtimeProvider: string | null;
  runtimeModel: string | null;
  subagentRuns: SubagentRun[];
  /** The task has a Hermes session that can be forked. */
  canFork: boolean;
  runAgentId: string | null;
};

export function RunInspectorSheet({
  task,
  onClose,
  onUpdate,
  facts,
  onFork,
  onSteer,
}: {
  task: DemoTask | null;
  onClose: () => void;
  onUpdate: (id: string, stage: TaskStage) => void;
  /** Present on a live mission: real run facts instead of the demo transcript. */
  facts?: InspectorFacts | null;
  /** Branch the task's session and retry Coding with these instructions. */
  onFork?: (id: string, instructions: string, keepOriginal: boolean) => Promise<boolean>;
  onSteer?: (id: string, instructions: string) => Promise<boolean>;
}) {
  const mobile = useIsMobile();
  const [reply, setReply] = useState("");
  const [forkNote, setForkNote] = useState("");
  const [steerNote, setSteerNote] = useState("");
  const [steering, setSteering] = useState(false);
  const [keepOriginal, setKeepOriginal] = useState(false);
  const [forking, setForking] = useState(false);
  const live = Boolean(facts);
  return (
    <Sheet
      open={!!task}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        side={mobile ? "bottom" : "right"}
        className="max-h-[92dvh] overflow-y-auto sm:max-w-xl"
      >
        <SheetHeader>
          <p className="eyebrow mb-2">
            {live ? "Run inspector" : "Run inspector · demo"}
          </p>
          <SheetTitle>
            {task?.id} / {task?.title}
          </SheetTitle>
          <SheetDescription>
            {live
              ? "What this task's runs used, and what they handed to sub-agents."
              : "Sample transcript. No live stream or VPS session is connected."}
          </SheetDescription>
        </SheetHeader>
        {task && (
          <div className="space-y-6 px-4 pb-6">
            <div className="flex justify-between border-y py-4 text-xs">
              <span>{task.agent}</span>
              <span className="font-mono text-muted-foreground">
                {task.model}
              </span>
            </div>
            {facts && (
              <div className="space-y-4">
                <dl className="grid grid-cols-2 gap-3 text-xs">
                  <div className="rounded-md bg-secondary/30 p-3">
                    <dt className="eyebrow">Ran on</dt>
                    <dd className="mt-1 font-mono">
                      {facts.runtimeModel
                        ? `${facts.runtimeProvider ? `${facts.runtimeProvider}/` : ""}${facts.runtimeModel}`
                        : "Not reported yet"}
                    </dd>
                  </div>
                  <div className="rounded-md bg-secondary/30 p-3">
                    <dt className="eyebrow">Cache</dt>
                    <dd className="mt-1 font-mono">
                      {formatTokens(facts.cacheReadTokens)} read · {formatTokens(facts.cacheWriteTokens)} written
                    </dd>
                  </div>
                </dl>
                <section aria-labelledby="inspector-subagents">
                  <h3 id="inspector-subagents" className="eyebrow mb-2">Sub-agents</h3>
                  {facts.subagentRuns.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No sub-agents yet.</p>
                  ) : (
                    <ul className="space-y-2">
                      {facts.subagentRuns.map((run) => (
                        <li key={run.delegationId} className="flex items-start gap-3 rounded-md bg-secondary/30 p-3 text-xs">
                          <GitBranch className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" />
                          <div className="min-w-0 flex-1">
                            <p className="flex flex-wrap items-center gap-2">
                              <span className="code-chip">{run.delegationId.slice(0, 8)}</span>
                              <span>{run.status === "running" ? "Running" : run.status === "failed" ? "Failed" : "Finished"}</span>
                              {run.durationSec !== undefined && <span className="text-muted-foreground">{run.durationSec}s</span>}
                              {run.tokens !== undefined && <span className="text-muted-foreground">{formatTokens(run.tokens)} tokens</span>}
                            </p>
                            {run.summary && <p className="mt-1 text-muted-foreground">{run.summary}</p>}
                            <div className="mt-2"><SubagentTranscript key={`${run.sourceAgentId ?? facts.runAgentId}:${run.childSessionId}`} run={run} agentId={run.sourceAgentId ?? facts.runAgentId} /></div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            )}
            {!live && (
            <>
            <div>
              <h3 className="mb-4 text-xs font-medium">Sample activity</h3>
              {[
                "Session created in isolated workspace",
                "Read requirements and task dependencies",
                "Inspect repository structure",
                "Prepare implementation and validation plan",
              ].map((line, index) => (
                <div
                  className="flex gap-3 border-l pb-6 pl-4 text-xs"
                  key={line}
                >
                  <Check className="size-3.5 shrink-0 text-primary" />
                  <div>
                    <p>{line}</p>
                    <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                      sample event 0{index + 1}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <div className="rounded-md border bg-secondary/30 p-4">
              <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
                <Terminal className="size-3.5" />
                Sample assistant output
              </div>
              <pre className="whitespace-pre-wrap font-mono text-xs leading-7">{`Task: ${task.title}\nStage: ${task.stage}\n\nI will inspect the requirements before changing code.\nBackend execution is unavailable in this UI preview.`}</pre>
            </div>
            </>
            )}
            {onSteer && (
              <form className="space-y-3 border-t pt-4" onSubmit={async (event) => {
                event.preventDefault();
                if (!steerNote.trim() || steering) return;
                setSteering(true);
                try { if (await onSteer(task.id, steerNote.trim())) setSteerNote(""); }
                finally { setSteering(false); }
              }}>
                <Label htmlFor="steer-note">Steer agent</Label>
                <Textarea id="steer-note" maxLength={4000} required value={steerNote} onChange={(event) => setSteerNote(event.target.value)} placeholder="What should the agent do next?" aria-describedby="steer-note-help" />
                <p id="steer-note-help" className="text-xs text-muted-foreground">Hermes applies this instruction after the next tool call.</p>
                <Button type="submit" disabled={steering || !steerNote.trim()}>{steering ? "Sending…" : "Send instruction"}</Button>
              </form>
            )}
            {facts?.canFork && onFork && (
              <form
                className="space-y-3 border-t pt-4"
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (!forkNote.trim() || forking) return;
                  setForking(true);
                  const ok = await onFork(task.id, forkNote.trim(), keepOriginal);
                  setForking(false);
                  if (ok) setForkNote("");
                }}
              >
                <Label htmlFor="fork-note">Fork and try another way</Label>
                <Textarea
                  id="fork-note"
                  required
                  maxLength={4000}
                  placeholder="What should the agent try instead?"
                  value={forkNote}
                  onChange={(event) => setForkNote(event.target.value)}
                  aria-describedby="fork-note-help"
                />
                <p id="fork-note-help" className="text-xs text-muted-foreground">
                  Copies this task&apos;s session so far, then codes again with your note.
                </p>
                <div className="flex items-center gap-3">
                  <Switch id="fork-keep" checked={keepOriginal} onCheckedChange={setKeepOriginal} />
                  <Label htmlFor="fork-keep">Keep the original task (make a new one)</Label>
                </div>
                <Button type="submit" disabled={forking || !forkNote.trim()}>
                  <GitBranch aria-hidden="true" /> {forking ? "Forking…" : "Fork & retry"}
                </Button>
              </form>
            )}
            {!live && task.stage === "Needs you" && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!reply.trim()) return;
                  toast.success("Demo reply recorded locally");
                  setReply("");
                  onUpdate(task.id, "Coding");
                }}
                className="space-y-3"
              >
                <Label htmlFor="clarify-reply">Clarification reply</Label>
                <Textarea
                  id="clarify-reply"
                  required
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                />
                <Button type="submit">Submit demo reply</Button>
              </form>
            )}
            <div className="flex flex-wrap gap-2 border-t pt-4">
              <Button
                variant="outline"
                onClick={() => onUpdate(task.id, "Needs you")}
              >
                Stop run
              </Button>
              <Button
                variant="outline"
                onClick={() => onUpdate(task.id, "Queued")}
              >
                Retry task
              </Button>
              <Button onClick={() => onUpdate(task.id, "Done")}>
                Mark done
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
