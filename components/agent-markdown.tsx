"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import Markdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, ChevronDown, Copy, FileCode, FolderGit2, GitBranch, GitCommitHorizontal, GitPullRequest, Link2 } from "lucide-react";
import { toast } from "sonner";
import { chipTokens } from "@/lib/chip-tokens";
import {
  ChangedFiles,
  CommandCard,
  FollowUps,
  MermaidBlock,
  Quote,
  TaskList,
  TestStrip,
  ThinkingBlock,
  diffAnchor,
  plainCallout,
} from "@/components/reply-extras";
import { diffCounts, diffFileName, diffFiles, pathLine, shellRun, splitOptions, splitThinking, testCounts } from "@/lib/reply-text";

type ChipKind = "hash" | "branch" | "file" | "tree";

const BRANCH = /^(?:(?:feat|feature|fix|hotfix|chore|docs|release|neiro|codex|kiro)\/|(?:main|master|HEAD|origin\/main)$)/;
const FILE = /\.(?:tsx?|jsx?|mjs|css|md|json|sql|ya?ml|py|sh|toml|lock)(?::\d+(?:[-–]\d+)?){0,2}$/;

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

const FOLD_LINES = 14;
const HASH_LANGS = /^(py|python|sh|bash|shell|zsh|ya?ml|toml|diff|patch)$/;

/**
 * A fenced code block as a card, like Kiro Crew's file view: a header with
 * the language and line count (or +/- for a diff), line numbers, and long
 * blocks folded to their first lines. The header folds the whole block.
 */
export function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const lines = code.split("\n");
  const diff = lang === "diff" || lang === "patch";
  const long = lines.length > FOLD_LINES;
  const [all, setAll] = useState(false);
  const [shut, setShut] = useState(false);
  const shown = long && !all ? lines.slice(0, FOLD_LINES) : lines;
  const { adds, dels } = diff ? diffCounts(code) : { adds: 0, dels: 0 };
  const file = diff ? diffFileName(code) : null;
  const hash = HASH_LANGS.test(lang);
  return (
    <div className="code-card" data-shut={shut || undefined} id={file ? diffAnchor(file) : undefined}>
      <div className="code-card-head">
        <button type="button" className="code-card-toggle" aria-expanded={!shut} onClick={() => setShut((v) => !v)}>
          <ChevronDown aria-hidden="true" className="code-card-chevron" />
          <FileCode aria-hidden="true" />
          <span>{file ?? (lang || "code")}</span>
        </button>
        <span className="code-card-count">
          {diff ? (
            <>
              <span data-tone="add">+{adds}</span>
              {dels > 0 && <span data-tone="del">−{dels}</span>}
            </>
          ) : (
            `${lines.length} ${lines.length === 1 ? "line" : "lines"}`
          )}
        </span>
        <CopyButton text={code} label="Copy code" />
      </div>
      {!shut && (
        <div className="code-card-body" data-folded={long && !all ? "" : undefined}>
          <pre>
            <code>
              {shown.map((line, i) => {
                const mark = diff ? (line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : line.startsWith("@@") ? "hunk" : undefined) : undefined;
                const parts = diff ? [] : highlight(line, hash);
                return (
                  <span key={i} className="code-line" data-diff={mark}>
                    <span className="code-ln" aria-hidden="true">
                      {i + 1}
                    </span>
                    <span className="code-text">{diff ? line || " " : parts.length ? parts : " "}</span>
                  </span>
                );
              })}
            </code>
          </pre>
        </div>
      )}
      {long && !shut && (
        <button type="button" className="code-card-more" aria-expanded={all} onClick={() => setAll((v) => !v)}>
          <ChevronDown aria-hidden="true" data-up={all || undefined} />
          {all ? "Show less" : `Show ${lines.length - FOLD_LINES} more lines`}
        </button>
      )}
    </div>
  );
}

type HastNode = { type?: string; value?: string; children?: HastNode[]; properties?: { className?: unknown } };
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

export function AgentMarkdown({
  text,
  onOption,
  optionsDisabled,
  thinkingSpent,
}: {
  text: string;
  /** Show the reply's "[OPTIONS: …]" line as buttons; without it the line is dropped. */
  onOption?: (option: string) => void;
  optionsDisabled?: boolean;
  /** "12s" for the thinking block's "Thought for 12s". */
  thinkingSpent?: string;
}) {
  const { thinking, body: unthought } = splitThinking(text);
  const { body, options } = splitOptions(unthought);
  const changed = diffFiles(body);
  const source = chipTokens(body);
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
    pre({ node }) {
      const hast = node as HastNode | undefined;
      const code = hastText(hast).replace(/\n$/, "");
      const cls = hast?.children?.[0]?.properties?.className;
      const names = Array.isArray(cls) ? cls.map(String) : typeof cls === "string" ? [cls] : [];
      const lang = (names.map((n) => /^language-([\w+-]+)/.exec(n)?.[1]).find(Boolean) ?? "").toLowerCase();
      const card = <CodeBlock code={code} lang={lang} />;
      if (lang === "mermaid") return <MermaidBlock code={code} fallback={card} />;
      const run = shellRun(code, lang);
      const tests = lang === "diff" || lang === "patch" ? null : testCounts(code);
      const strip = tests ? <TestStrip pass={tests.pass} fail={tests.fail} /> : null;
      if (run) {
        return (
          <>
            <CommandCard run={run} />
            {strip}
          </>
        );
      }
      return (
        <>
          {strip}
          {card}
        </>
      );
    },
    blockquote({ node, children }) {
      void node;
      return <Quote>{children}</Quote>;
    },
    ul({ node, className, children, ...rest }) {
      if (className?.includes("contains-task-list")) return <TaskList node={node}>{children}</TaskList>;
      return (
        <ul className={className} {...rest}>
          {children}
        </ul>
      );
    },
    p({ node, children, ...rest }) {
      // "Warning: …" written as a plain paragraph still gets the warning box.
      const boxed = plainCallout(children);
      if (boxed) return boxed;
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
      if (kind === "file") return <FileChip text={raw} />;
      return (
        <code className={className} data-kind={kind ?? undefined} {...rest}>
          {Icon && <Icon aria-hidden="true" className="chat-chip-icon" />}
          {children}
        </code>
      );
    },
  };

  return (
    <>
      <ThinkingBlock text={thinking} spent={thinkingSpent} />
      <ChangedFiles files={changed} />
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {source}
      </Markdown>
      {onOption && <FollowUps options={options} onPick={onOption} disabled={optionsDisabled} />}
    </>
  );
}

/** A file path chip ("lib/x.ts:42"): click copies the path and line. */
export function FileChip({ text, label }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const { path } = pathLine(text);
  const where = text.slice(path.length);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1200);
    } catch {
      toast.error("Clipboard unavailable. Select and copy the path instead.");
    }
  }
  return (
    <button
      type="button"
      className="file-chip"
      data-done={done || undefined}
      title={done ? "Copied" : `Copy ${text}`}
      aria-label={done ? `Copied ${text}` : `Copy path ${text}`}
      onClick={() => void copy()}
    >
      {done ? <Check aria-hidden="true" /> : <FileCode aria-hidden="true" />}
      <span>{label ?? path}</span>
      {where && <span className="file-chip-line">{where}</span>}
    </button>
  );
}
