"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type RefObject } from "react";
import { toast } from "sonner";
import { MissionComposer } from "@/components/mission-composer";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { PreflightCheck } from "@/lib/mission-preflight";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { projectHref } from "@/lib/client-api";
import type { ProjectDefaults } from "@/lib/project-defaults";
import type { ImageAttachment } from "@/lib/types";

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
  defaults,
  inputRef,
  onChanged,
  onOpen,
}: {
  projectId: string;
  path: string;
  defaults: ProjectDefaults;
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
  const [pause, setPause] = useState(defaults.pause_after_planning === true);
  const [baseBranch, setBaseBranch] = useState(typeof defaults.base_branch === "string" ? defaults.base_branch : "");
  const [isolate, setIsolate] = useState(defaults.isolate_workspace !== false);
  const [workers, setWorkers] = useState(String(defaults.max_parallel_workers ?? 3));
  const [retries, setRetries] = useState(String(defaults.max_retries ?? 2));
  const [tokenBudget, setTokenBudget] = useState(defaults.token_budget == null ? "" : String(defaults.token_budget));
  const [learnSkill, setLearnSkill] = useState(false);
  const [autoApproveSafeTools, setAutoApproveSafeTools] = useState(false);
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [launching, setLaunching] = useState(false);
  const [pending, setPending] = useState<{ checks: PreflightCheck[]; body: Record<string, unknown>; pause: boolean; signature: string } | null>(null);
  const inputSignature = JSON.stringify([projectId, prompt, workspace, pause, baseBranch, isolate, workers, retries, tokenBudget, learnSkill, autoApproveSafeTools, images]);
  const latestInput = useRef(inputSignature);
  useEffect(() => { latestInput.current = inputSignature; }, [inputSignature]);

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
      const body = {
          project_id: projectId,
          title: objective.split("\n")[0].slice(0, 80),
          prompt: brief,
          pause_after_planning: pauseForPlan,
          mode,
          workspace_path: workspace.trim() || undefined,
          base_branch: baseBranch.trim() || null,
          isolate_workspace: isolate,
          max_parallel_workers: parseIntOr(workers, 3),
          max_retries: parseIntOr(retries, 2),
          token_budget: parseIntOr(tokenBudget, 0),
          learn_skill_on_done: learnSkill || undefined,
          auto_approve_safe_tools: autoApproveSafeTools || undefined,
          attachments: images.length ? images : undefined,
        };
      const check = await fetch("/api/missions/preflight", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const readiness = await check.json().catch(() => ({})) as { error?: string; checks?: PreflightCheck[] };
      if (!check.ok || !readiness.checks) { toast.error(readiness.error ?? "Could not check readiness"); return; }
      if (latestInput.current !== inputSignature) { toast.error("Mission settings changed. Check readiness again."); return; }
      if (readiness.checks.some((item) => item.status !== "pass")) {
        setPending({ checks: readiness.checks, body, pause: pauseForPlan, signature: inputSignature });
        return;
      }
      await createMission(body, pauseForPlan);

    } catch {
      toast.error("Network error");
    } finally {
      setLaunching(false);
    }
  }

  async function createMission(body: Record<string, unknown>, pauseForPlan: boolean) {
    setLaunching(true);
    try {
      const res = await fetch("/api/missions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json().catch(() => ({}))) as { error?: string; mission?: { id?: string }; checks?: PreflightCheck[] };
      if (!res.ok) {
        if (data.checks) setPending({ checks: data.checks, body, pause: pauseForPlan, signature: latestInput.current });
        else toast.error(data.error ?? `Request failed (${res.status})`);
        return;
      }
      setPending(null);
      setPrompt("");
      setImages([]);
      onChanged?.();
      toast.success(pauseForPlan ? "Mission launched. It will pause for plan approval." : "Mission launched.");
      const id = data.mission?.id;
      if (onOpen && id) { onOpen({ kind: "mission", id }); return; }
      router.push(projectHref(projectId, id ? { mission: id } : {}));
    } catch { toast.error("Network error"); }
    finally { setLaunching(false); }
  }

  return (
    <>
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
      images={images}
      onImagesChange={setImages}
      answerElsewhere={Boolean(onOpen)}
      onAskChange={(runId) => {
        onChanged?.();
        if (runId) onOpen?.({ kind: "question", id: runId });
      }}
      advanced={
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
              <Switch id="auto-approve-safe-tools" checked={autoApproveSafeTools} onCheckedChange={setAutoApproveSafeTools} aria-describedby="auto-approve-help" />
              <div><Label htmlFor="auto-approve-safe-tools">Auto-approve safe checks</Label><p id="auto-approve-help" className="text-xs text-muted-foreground">Only narrowly allowed read-only commands with a confident System One assessment; other requests still need approval.</p></div>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="learn-skill"
                checked={learnSkill}
                onCheckedChange={setLearnSkill}
                aria-describedby="learn-skill-help"
              />
              <div>
                <Label htmlFor="learn-skill">Learn a skill when done</Label>
                <p id="learn-skill-help" className="text-xs text-muted-foreground">
                  The summary drafts a SKILL.md and attempts to install it in the local Hermes profile without overwriting an existing skill.
                </p>
              </div>
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
    <Dialog open={pending !== null} onOpenChange={(open) => { if (!open && !launching) setPending(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Mission readiness</DialogTitle><DialogDescription>Review the checks before starting this mission.</DialogDescription></DialogHeader>
        <ul className="max-h-80 space-y-3 overflow-y-auto text-sm">
          {pending?.checks.map((check) => <li key={check.id} className="border-b pb-2"><strong className="capitalize">{check.status}</strong>: {check.reason} {check.href && <a className="text-primary underline" href={check.href}>Open</a>}</li>)}
        </ul>
        {pending && pending.signature !== inputSignature && <p className="text-sm text-destructive">Mission settings changed. Close this dialog and check again.</p>}
        <DialogFooter>
          <Button variant="outline" disabled={launching} onClick={() => setPending(null)}>Close</Button>
          <Button disabled={launching || !pending || pending.signature !== inputSignature || pending.checks.some((check) => check.status === "blocked")} onClick={() => {
            if (!pending || latestInput.current !== pending.signature) return;
            const skip = pending.checks.some((check) => (check.id === "qa" || check.id === "reviewer") && check.status === "warning");
            void createMission({ ...pending.body, ...(skip ? { allow_skipped_verification: true } : {}) }, pending.pause);
          }}>{pending?.checks.some((check) => (check.id === "qa" || check.id === "reviewer") && check.status === "warning") ? "Continue without verification" : "Continue with warnings"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
