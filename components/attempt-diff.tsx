"use client";

import { CodeBlock } from "@/components/agent-markdown";
import { ChangedFiles } from "@/components/reply-extras";
import { diffCounts, diffFileName, type DiffFile } from "@/lib/reply-text";

/** A git patch cut into one chunk per file. */
export function splitPatch(patch: string): { file: string; code: string; adds: number; dels: number }[] {
  return patch
    .split(/^(?=diff --git )/m)
    .map((chunk) => chunk.replace(/\n+$/, ""))
    .filter((chunk) => chunk.trim())
    .map((code) => {
      const fromHeader = /^diff --git a\/(\S+) b\/(\S+)/.exec(code);
      const file = diffFileName(code) ?? fromHeader?.[2] ?? "file";
      return { file, code, ...diffCounts(code) };
    });
}

/**
 * What a coding attempt really changed, read from git (not the agent's own
 * words): "N files changed +A −D", each file a diff card, folded under it.
 */
export function AttemptDiff({ patch }: { patch: string }) {
  const files = splitPatch(patch);
  if (files.length === 0) return null;
  const summary: DiffFile[] = files.map(({ file, adds, dels }) => ({ file, adds, dels }));
  return (
    <div className="attempt-diff">
      <ChangedFiles files={summary} />
      <details>
        <summary>Show the diff</summary>
        {files.map((f) => (
          <CodeBlock key={f.file} code={f.code} lang="diff" />
        ))}
      </details>
    </div>
  );
}
