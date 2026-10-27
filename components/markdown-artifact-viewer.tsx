"use client";

import { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Copy, Download, FileText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function MarkdownArtifactViewer({ title }: { title: string }) {
  const artifacts = [
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
  const [selected, setSelected] = useState(0);
  const artifact = artifacts[selected];
  return (
    <div className="grid min-h-96 overflow-hidden rounded-lg border md:grid-cols-[220px_1fr]">
      <div className="border-b bg-secondary/20 p-3 md:border-r md:border-b-0">
        <p className="px-3 py-2 text-[10px] tracking-widest text-muted-foreground">
          WORKSPACE FILES
        </p>
        {artifacts.map((item, index) => (
          <button
            key={item.name}
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
          <div className="flex gap-2">
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
        <article className="prose prose-sm dark:prose-invert max-w-[72ch] overflow-x-auto p-6 md:p-8">
          <Markdown remarkPlugins={[remarkGfm]}>{artifact.content}</Markdown>
        </article>
      </div>
    </div>
  );
}
