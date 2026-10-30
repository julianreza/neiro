"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type RefObject } from "react";
import { toast } from "sonner";
import { MissionComposer } from "@/components/mission-composer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { projectHref } from "@/lib/client-api";

function parseIntOr(value: string, fallback: number): number {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * The composer for one project, on the Projects page. Ask answers inline;
 * a mission opens in the project's Mission control once it is created.
 */
export function ProjectComposer({
  projectId,
  path,
  inputRef,
  onChanged,
  onOpen,
}: {
  projectId: string;
  path: string;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  /** Called when a question or mission starts or finishes, so lists can refresh. */
  onChanged?: () => void;
  /** Show a new question or mission on this page instead of leaving it. */
  onOpen?: (item: { kind: "question" | "mission"; id: string }) => void;
}) {
  const router = useRouter();
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const input = inputRef ?? ownRef;
  const [prompt, setPrompt] = useState("");
  const [workspace, setWorkspace] = useState(path);
  const [pause, setPause] = useState(false);
  const [baseBranch, setBaseBranch] = useState("");
  const [isolate, setIsolate] = useState(true);
  const [workers, setWorkers] = useState("3");
  const [retries, setRetries] = useState("2");
  const [tokenBudget, setTokenBudget] = useState("");
  const [launching, setLaunching] = useState(false);

  async function launch(mode: "build" | "fix" | "plan" = "build", context?: string) {
    if (!prompt.trim()) {
      input.current?.focus();
      toast.error("Describe the mission objective first");
      return;
    }
    const objective = prompt.trim();
    const task =
      mode === "fix"
        ? `Bug fix. First reproduce the problem and find the root cause, then fix it and prove the fix.\n\nBug report:\n${objective}`
        : mode === "plan"
          ? `Quick plan. Keep the plan and the spec short: the goal and a small task list.\n\nGoal:\n${objective}`
          : objective;
    const brief = context ? `${task}\n\n${context}` : task;
    const pauseForPlan = mode === "plan" || pause;
    setLaunching(true);
    try {
      const res = await fetch("/api/missions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: objective.split("\n")[0].slice(0, 80),
          prompt: brief,
          pause_after_planning: pauseForPlan,
          workspace_path: workspace.trim() || undefined,
          base_branch: baseBranch.trim() || undefined,
          isolate_workspace: isolate,
          max_parallel_workers: parseIntOr(workers, 3),
          max_retries: parseIntOr(retries, 2),
          token_budget: parseIntOr(tokenBudget, 0) || undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: unknown; mission?: { id?: string } };
      if (!res.ok) {
        toast.error(typeof data.error === "string" ? data.error : `Request failed (${res.status})`);
        return;
      }
      setPrompt("");
      toast.success(pauseForPlan ? "Mission launched. It will pause for plan approval." : "Mission launched.");
      onChanged?.();
      const id = data.mission?.id;
      router.push(projectHref(projectId, id ? { mission: id } : {}));
      if (onOpen && id) {
        onOpen({ kind: "mission", id });
        return;
      }
    } catch {
      toast.error("Network error");
    } finally {
      setLaunching(false);
    }
  }

  return (
    <MissionComposer
      prompt={prompt}
      onPromptChange={setPrompt}
      workspace={workspace}
      onWorkspaceChange={setWorkspace}
      folderLocked
      compact
      inputRef={input}
      isLive
      launching={launching}
      onLaunch={launch}
      advanced={
      answerElsewhere={Boolean(onOpen)}
      onAskChange={(runId) => {
        onChanged?.();
        if (runId) onOpen?.({ kind: "question", id: runId });
      }}
        <>
          <div className="grid gap-5 p-5 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="base-branch">Base branch</Label>
              <Input
                id="base-branch"
                value={baseBranch}
                onChange={(event) => setBaseBranch(event.target.value)}
                placeholder="Current branch"
                disabled={!isolate}
                maxLength={200}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                aria-describedby="base-branch-help"
              />
              <p id="base-branch-help" className="text-xs text-muted-foreground">
                The new mission branch starts here.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="worker-limit">Parallel workers</Label>
              <Input
                id="worker-limit"
                type="number"
                min="1"
                max="10"
                value={workers}
                onChange={(event) => setWorkers(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="retry-limit">Max auto-fix retries</Label>
              <Input
                id="retry-limit"
                type="number"
                min="0"
                max="5"
                value={retries}
                onChange={(event) => setRetries(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="token-budget">Token budget</Label>
              <Input
                id="token-budget"
                type="number"
                min="0"
                step="1000"
                inputMode="numeric"
                placeholder="No limit"
                value={tokenBudget}
                onChange={(event) => setTokenBudget(event.target.value)}
                aria-describedby="token-budget-help"
              />
              <p id="token-budget-help" className="text-xs text-muted-foreground">
                Tasks stop at Needs you when the mission uses this many tokens. Empty or 0 means no limit.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Switch id="pause-plan" checked={pause} onCheckedChange={setPause} />
              <Label htmlFor="pause-plan">Pause after PRD review</Label>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="isolate-workspace"
                checked={isolate}
                onCheckedChange={setIsolate}
                aria-describedby="isolate-workspace-help"
              />
              <div>
                <Label htmlFor="isolate-workspace">Work on a new branch</Label>
                <p id="isolate-workspace-help" className="text-xs text-muted-foreground">
                  Git worktree on neiro/&lt;mission&gt;. Your checkout stays untouched.
                </p>
              </div>
            </div>
          </div>
          <p className="border-t px-5 py-3 text-xs text-muted-foreground">
            Applied to this mission: the orchestrator enforces the pause, worker cap and retry cap.
          </p>
        </>
      }
    />
  );
}
