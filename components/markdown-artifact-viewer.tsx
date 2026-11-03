"use client";

import { useState } from "react";
import Markdown from "react-markdown";
import { StepTrail, took } from "@/components/reply-parts";
import { ThinkingBlock, WorkSummary, reasoningOf } from "@/components/reply-extras";
import { useSavedSteps } from "@/hooks/use-saved-steps";
import remarkGfm from "remark-gfm";
import { Copy, Download, FileText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export type ArtifactFile = {
  id?: string;
  kind?: string;
  name: string;
  label: string;
  content: string;
  /** The run that wrote it (plan, PRD): its saved steps show above the text. */
  runId?: string | null;
  startedAt?: string | null;
  at?: string;
};

/** "Worked 1m 12s · 9 steps" for the run that wrote this artifact. */
function ArtifactWork({ file }: { file: ArtifactFile }) {
  const steps = useSavedSteps(file.runId);
  const spent = file.startedAt && file.at ? took(file.startedAt, file.at) : "";
  if (steps.length === 0) return null;
  return (
    <div className="px-6 pt-4 md:px-8">
      <WorkSummary steps={steps} spent={spent}>
        <StepTrail steps={steps} live={false} all />
      </WorkSummary>
      <ThinkingBlock text={reasoningOf(steps)} />
    </div>
  );
}

/**
 * Shows mission artifacts. Pass `files` for real artifacts; without it the
 * component renders clearly-labelled demo documents.
 */
export function MarkdownArtifactViewer({
  title,
  files,
  initialArtifactId,
  agentIds,
  missionId,
  onInstalled,
}: {
  title: string;
  files?: ArtifactFile[];
  initialArtifactId?: string | null;
  agentIds?: { id: string; name: string; available?: boolean; reason?: string }[];
  missionId?: string;
  onInstalled?: () => void;
}) {
  const demoArtifacts: ArtifactFile[] = [
    {
      name: "PRD.md",
      label: "Product requirements",
      content: `# ${title}\n\n> Demo artifact. No agent has generated or verified this document.\n\n## Objective\nGive customers a clear way to submit feedback, vote on ideas, and follow the roadmap.\n\n## Requirements\n- Authenticated customers can create feedback.\n- One vote per customer and idea.\n- Administrators can moderate submissions.\n- Keyboard navigation works throughout.\n\n## Acceptance criteria\n| Area | Expected behavior |\n| --- | --- |\n| Voting | Duplicate votes are rejected |\n| Moderation | Only administrators can change status |\n| Accessibility | Controls have visible labels and focus |\n\n## Out of scope\nPayments, notifications, and third-party integrations.`,
    },
    {
      name: "TASK_PLAN.md",
      label: "Execution plan",
      content:
        "# Execution plan\n\nDemo plan for previewing the artifact reader.\n\n1. Define requirements and schema.\n2. Build API and interface in parallel.\n3. Verify behavior at the QA gate.\n4. Review and summarize deliverables.\n\n```text\nT1: Specification\nT2: Backend (depends on T1)\nT3: Frontend (depends on T1)\nT4: QA (depends on T2, T3)\n```",
    },
  ];
  const artifacts = (files ?? demoArtifacts).filter((file) => file.kind !== "skill_installation");
  const [installAgent, setInstallAgent] = useState("");
  const [installing, setInstalling] = useState(false);
  const [selected, setSelected] = useState(() => Math.max(0, artifacts.findIndex((file) => file.id === initialArtifactId)));
  const artifact = artifacts[Math.min(selected, artifacts.length - 1)];
  if (!artifact) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        No artifacts yet. They appear here as agents finish planning, QA and review.
      </div>
    );
  }
  return (
    <div className="grid min-h-96 overflow-hidden rounded-lg border md:grid-cols-[220px_1fr]">
      <div className="border-b bg-secondary/20 p-3 md:border-r md:border-b-0">
        <p className="eyebrow px-3 py-2">
          Workspace files
        </p>
        {artifacts.map((item, index) => (
          <button
            key={`${item.name}-${index}`}
            onClick={() => setSelected(index)}
            className={`flex w-full items-center gap-3 rounded-md px-3 py-3 text-left text-xs ${selected === index ? "bg-secondary" : "hover:bg-secondary/50"}`}
          >
            <FileText className="size-4 shrink-0 text-primary" />
            <span>
              <span className="block font-mono">{item.name}</span>
              <span className="mt-1 block text-muted-foreground">
                {item.label}
              </span>
            </span>
          </button>
        ))}
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
          <span className="font-mono text-xs text-muted-foreground">
            {artifact.name}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {artifact.kind === "learned_skill" && agentIds && agentIds.length > 0 && <>
              <label className="sr-only" htmlFor="install-skill-agent">Hermes agent</label>
              <select id="install-skill-agent" value={installAgent} onChange={(event) => setInstallAgent(event.target.value)} className="max-w-40 rounded-md border bg-background px-2 py-1 text-xs">
                <option value="">Select agent</option>
                {agentIds.map((agent) => <option key={agent.id} value={agent.id} disabled={agent.available === false}>{agent.name}{agent.available === false ? ` · ${agent.reason}` : ""}</option>)}
              </select>
              <Button variant="outline" size="sm" disabled={!installAgent || installing} onClick={async () => {
                if (!missionId || !artifact.id) { toast.error("Skill artifact is unavailable"); return; }
                setInstalling(true);
                try {
                  const response = await fetch(`/api/agents/${encodeURIComponent(installAgent)}/skills`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "install_artifact", missionId, artifactId: artifact.id }) });
                  const data = await response.json().catch(() => ({}));
                  if (!response.ok) toast.error(typeof data.error === "string" ? data.error : "Could not install skill");
                  else if (typeof data.warning === "string") toast.warning(data.warning);
                  else toast.success("Skill installed to Hermes");
                  onInstalled?.();
                } catch { toast.error("Could not reach Neiro"); }
                finally { setInstalling(false); }
              }}>{installing ? "Installing…" : "Install to Hermes Profile"}</Button>
            </>}
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(artifact.content);
                  toast.success("Markdown copied");
                } catch {
                  toast.error(
                    "Clipboard unavailable. Download the file instead.",
                  );
                }
              }}
            >
              <Copy className="size-3" />
              Copy
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const url = URL.createObjectURL(
                  new Blob([artifact.content], { type: "text/markdown" }),
                );
                const link = document.createElement("a");
                link.href = url;
                link.download = artifact.name;
                link.click();
                URL.revokeObjectURL(url);
              }}
            >
              <Download className="size-3" />
              Download
            </Button>
          </div>
        </div>
        {artifact.kind === "learned_skill" && files?.filter((file) => file.kind === "skill_installation").map((record) => {
          try {
            const result = JSON.parse(record.content) as { sourceArtifactId?: string; profile?: string; status?: string; at?: string; error?: string };
            if (result.sourceArtifactId !== artifact.id) return null;
            return <p key={record.id} className="px-6 pt-3 text-xs text-muted-foreground">{result.status === "installed" ? "Installed" : "Installation failed"} · {result.profile} · {result.at}{result.error ? ` · ${result.error}` : ""}</p>;
          } catch { return null; }
        })}
        <ArtifactWork file={artifact} />
        <article className="prose prose-sm dark:prose-invert max-w-[72ch] overflow-x-auto p-6 md:p-8">
          <Markdown remarkPlugins={[remarkGfm]}>{artifact.content}</Markdown>
        </article>
      </div>
    </div>
  );
}
