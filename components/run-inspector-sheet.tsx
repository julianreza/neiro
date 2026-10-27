"use client";

import { useState } from "react";
import { Check, Terminal } from "lucide-react";
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

export function RunInspectorSheet({
  task,
  onClose,
  onUpdate,
}: {
  task: DemoTask | null;
  onClose: () => void;
  onUpdate: (id: string, stage: TaskStage) => void;
}) {
  const mobile = useIsMobile();
  const [reply, setReply] = useState("");
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
            Run inspector · demo
          </p>
          <SheetTitle>
            {task?.id} / {task?.title}
          </SheetTitle>
          <SheetDescription>
            Sample transcript. No live stream or VPS session is connected.
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
            {task.stage === "Needs you" && (
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
