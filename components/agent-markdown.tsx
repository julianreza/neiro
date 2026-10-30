"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import Markdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy, FileCode, FolderGit2, GitBranch, GitCommitHorizontal, GitPullRequest, Link2 } from "lucide-react";
import { toast } from "sonner";
import { chipTokens } from "@/lib/chip-tokens";

type ChipKind = "hash" | "branch" | "file" | "tree";

const BRANCH = /^(?:(?:feat|feature|fix|hotfix|chore|docs|release|neiro|codex|kiro)\/|(?:main|master|HEAD|origin\/main)$)/;
const FILE = /\.(?:tsx?|jsx?|mjs|css|md|json|sql|ya?ml|py|sh|toml|lock)$/;

function chipKind(text: string): ChipKind | null {
  if (/^[0-9a-f]{7,40}$/.test(text) && /[0-9]/.test(text) && /[a-f]/.test(text)) return "hash";
  if (text === "worktree") return "tree";
  if (BRANCH.test(text)) return "branch";
  if (FILE.test(text)) return "file";
  return null;
}

const ICONS = { hash: GitCommitHorizontal, branch: GitBranch, file: FileCode, tree: FolderGit2 } as const;

// A small, dependency-free highlighter: keywords, strings, numbers, comments.
const TOKENS =
  /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|\b(\d[\d_.]*)\b|\b(const|let|var|function|return|if|else|for|while|import|from|export|default|class|new|await|async|type|interface|extends|true|false|null|undefined|def|in|of|try|catch|throw)\b/g;

function highlight(code: string, hashComments: boolean): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of code.matchAll(TOKENS)) {
    const start = m.index ?? 0;
    if (m[1]?.startsWith("#") && !hashComments) continue;
    if (start > last) out.push(code.slice(last, start));
    const kind = m[1] ? "c" : m[2] ? "s" : m[3] ? "n" : "k";
    out.push(
      <span key={start} className={`tok-${kind}`}>
        {m[0]}
      </span>,
    );
    last = start + m[0].length;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}

function textOf(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(textOf).join("");
  return "";
}

/** Split the first sentence of the reply's first paragraph into a lead span. */
function leadParagraph(children: ReactNode): ReactNode {
  const parts = Array.isArray(children) ? [...children] : [children];
  const first = parts[0];
  if (typeof first !== "string") return children;
  const match = /^([\s\S]+?[.!?])(\s+|$)/.exec(first);
  const lead = match ? match[1] : first;
  const rest = first.slice(lead.length);
  return [
    <span key="lead" className="chat-lead">
      {lead}
    </span>,
    rest,
    ...parts.slice(1),
  ];
}

/** Copy button: an icon that turns into a tick for a moment after copying. */
export function CopyButton({ text, label, className = "" }: { text: string; label: string; className?: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1400);
    } catch {
      toast.error("Clipboard unavailable. Select and copy the text instead.");
    }
  }
  return (
    <button
      type="button"
      className={`chat-copy ${className}`.trim()}
      data-done={done || undefined}
      aria-label={done ? "Copied" : label}
      title={done ? "Copied" : label}
      onClick={() => void copy()}
    >
      {done ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
    </button>
  );
}

type HastNode = { type?: string; value?: string; children?: HastNode[] };
function hastText(node: HastNode | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(hastText).join("");
}

const PR_URL = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/;

/** A bare URL or a GitHub pull request, shown as a small card. */
function LinkCard({ href }: { href: string }) {
  const pr = PR_URL.exec(href);
  let title = href;
  let sub = "";
  if (pr) {
    title = `PR #${pr[3]}`;
    sub = `${pr[1]}/${pr[2]} · github.com`;
  } else {
    try {
      const url = new URL(href);
      title = url.hostname.replace(/^www\./, "");
      sub = url.pathname === "/" ? "" : url.pathname;
    } catch {
      // Keep the raw text.
    }
  }
  const Icon = pr ? GitPullRequest : Link2;
  return (
    <a className="chat-link-card" href={href} target="_blank" rel="noopener noreferrer" data-pr={pr ? "" : undefined}>
      <Icon aria-hidden="true" className="chat-link-icon" />
      <span className="min-w-0">
        <span className="chat-link-title">{title}</span>
        {sub && <span className="chat-link-sub">{sub}</span>}
      </span>
    </a>
  );
}

export function AgentMarkdown({ text }: { text: string }) {
  const source = chipTokens(text);
  const firstLine = source.split("\n").findIndex((line) => line.trim() !== "") + 1;

  const components: Components = {
    a({ node, href, children, ...rest }) {
      void node;
      const url = typeof href === "string" ? href : "";
      const external = /^https?:\/\//.test(url);
      if (external && (PR_URL.test(url) || textOf(children) === url)) return <LinkCard href={url} />;
      return (
        <a href={href} {...rest} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
          {children}
        </a>
      );
    },
    pre({ node, children, ...rest }) {
      const code = hastText(node as HastNode | undefined).replace(/\n$/, "");
      return (
        <div className="chat-pre">
          <pre {...rest}>{children}</pre>
          <CopyButton text={code} label="Copy code" className="chat-pre-copy" />
        </div>
      );
    },
    p({ node, children, ...rest }) {
      const isLead = node?.position?.start.line === firstLine;
      return <p {...rest}>{isLead ? leadParagraph(children) : children}</p>;
    },
    code({ node, className, children, ...rest }) {
      void node;
      const raw = textOf(children);
      const lang = /language-(\w+)/.exec(className ?? "")?.[1] ?? "";
      if (lang || raw.includes("\n")) {
        const hashComments = /^(py|python|sh|bash|shell|zsh|ya?ml|toml)$/.test(lang);
        return (
          <code className={className} {...rest}>
            {highlight(raw, hashComments)}
          </code>
        );
      }
      const kind = chipKind(raw);
      const Icon = kind ? ICONS[kind] : null;
      return (
        <code className={className} data-kind={kind ?? undefined} {...rest}>
          {Icon && <Icon aria-hidden="true" className="chat-chip-icon" />}
          {children}
        </code>
      );
    },
  };

  return (
    <Markdown remarkPlugins={[remarkGfm]} components={components}>
      {source}
    </Markdown>
  );
}
