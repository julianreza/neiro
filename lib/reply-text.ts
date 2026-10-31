/**
 * Pure helpers that read structure out of an agent's reply text, so the
 * reply can show it as cards: follow-up buttons, a thinking block, the files
 * a diff changes, test counts and shell commands. Shared by the UI and tests.
 */

const OPTIONS_LINE = /^[ \t]*\[OPTIONS:\s*([^\]\n]*)\][ \t]*$/gim;

/** Pull every "[OPTIONS: a | b]" line out of the reply; the last one wins. */
export function splitOptions(text: string): { body: string; options: string[] } {
  let options: string[] = [];
  const body = text.replace(OPTIONS_LINE, (_line, list: string) => {
    options = list
      .split("|")
      .map((o) => o.trim())
      .filter(Boolean)
      .slice(0, 6);
    return "";
  });
  return { body: options.length ? body.replace(/\n{3,}/g, "\n\n").trim() : text, options };
}

const THINK = /^\s*<(think|thinking)>([\s\S]*?)<\/\1>\s*/i;

/** A leading <think>…</think> block, split off the answer. */
export function splitThinking(text: string): { thinking: string; body: string } {
  const match = THINK.exec(text);
  if (!match) return { thinking: "", body: text };
  return { thinking: match[2].trim(), body: text.slice(match[0].length) };
}

export type DiffFile = { file: string; adds: number; dels: number };

const FENCE = /```(\w+)?[^\n]*\n([\s\S]*?)```/g;

/** The file a diff block changes, from its "+++ b/x" or "--- a/x" header. */
export function diffFileName(code: string): string | null {
  const plus = /^\+\+\+ (?:b\/)?(\S+)/m.exec(code)?.[1];
  if (plus && plus !== "/dev/null") return plus;
  const minus = /^--- (?:a\/)?(\S+)/m.exec(code)?.[1];
  return minus && minus !== "/dev/null" ? minus : null;
}

/** Count added and removed lines in a diff, skipping the file headers. */
export function diffCounts(code: string): { adds: number; dels: number } {
  let adds = 0;
  let dels = 0;
  for (const line of code.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) adds++;
    else if (line.startsWith("-") && !line.startsWith("---")) dels++;
  }
  return { adds, dels };
}

/** Every file the reply's ```diff blocks change, merged by name. */
export function diffFiles(text: string): DiffFile[] {
  const byName = new Map<string, DiffFile>();
  for (const m of text.matchAll(FENCE)) {
    const lang = (m[1] ?? "").toLowerCase();
    if (lang !== "diff" && lang !== "patch") continue;
    // One block may hold several files: each starts at a "--- x" line that
    // a "+++ y" line follows (a removed "-- comment" line has no such pair).
    const lines = m[2].split("\n");
    const starts: number[] = [];
    lines.forEach((line, i) => {
      if (line.startsWith("--- ") && lines[i + 1]?.startsWith("+++ ")) starts.push(i);
    });
    if (starts.length === 0) starts.push(0);
    const parts = starts.map((s, k) => lines.slice(s, starts[k + 1] ?? lines.length).join("\n"));
    for (const part of parts) {
      const file = diffFileName(part);
      if (!file) continue;
      const { adds, dels } = diffCounts(part);
      const cur = byName.get(file) ?? { file, adds: 0, dels: 0 };
      cur.adds += adds;
      cur.dels += dels;
      byName.set(file, cur);
    }
  }
  return [...byName.values()];
}

/** "22 pass 1 fail", "Tests: 3 passed, 1 failed", "5 passing" -> counts. */
export function testCounts(text: string): { pass: number; fail: number } | null {
  const pass = /(\d+)\s+(?:pass(?:ed|ing)?|✓\s*passed)\b/i.exec(text);
  const fail = /(\d+)\s+(?:fail(?:ed|ing|ures?)?)\b/i.exec(text);
  if (!pass && !fail) return null;
  return { pass: pass ? Number(pass[1]) : 0, fail: fail ? Number(fail[1]) : 0 };
}

const SHELL = /^(?:sh|bash|zsh|shell|console|terminal|shellsession)$/;

export type ShellRun = { command: string; output: string; exit: number | null };

/**
 * A shell block written as "$ command" then its output, as a command card.
 * The exit code comes from an "exit 0" / "exit code: 1" / "[exit 2]" line.
 */
export function shellRun(code: string, lang: string): ShellRun | null {
  if (!SHELL.test(lang)) return null;
  const lines = code.split("\n");
  if (!/^\s*\$\s+\S/.test(lines[0] ?? "")) return null;
  const commands: string[] = [];
  let i = 0;
  while (i < lines.length && /^\s*\$\s+/.test(lines[i])) commands.push(lines[i++].replace(/^\s*\$\s+/, ""));
  let exit: number | null = null;
  const output = lines.slice(i).filter((line) => {
    const m = /^\s*\[?(?:exit(?:\s+code)?|exited with)\s*:?\s*(\d+)\]?\s*$/i.exec(line);
    if (m) {
      exit = Number(m[1]);
      return false;
    }
    return true;
  });
  return { command: commands.join("\n"), output: output.join("\n").trim(), exit };
}

export type CalloutKind = "note" | "tip" | "important" | "warning" | "caution";

const CALLOUT = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i;

/** GitHub-style "> [!WARNING]" marker at the start of a quote. */
export function calloutKind(text: string): CalloutKind | null {
  const m = CALLOUT.exec(text);
  return m ? (m[1].toLowerCase() as CalloutKind) : null;
}

export function stripCallout(text: string): string {
  return text.replace(CALLOUT, "");
}

/** "lib/x.ts:42", "lib/x.ts:42:7" or "lib/x.ts:94-106" -> path and first line. */
export function pathLine(text: string): { path: string; line: number | null } {
  const m = /^(.*?):(\d+)(?:[-–]\d+)?(?::\d+)?$/.exec(text);
  return m ? { path: m[1], line: Number(m[2]) } : { path: text, line: null };
}

const WORD_CALLOUT: [RegExp, CalloutKind][] = [
  [/^(?:warning|peringatan|perhatian|awas)\s*:\s*/i, "warning"],
  [/^(?:caution|danger|bahaya|hati-hati)\s*:\s*/i, "caution"],
  [/^(?:important|penting)\s*:\s*/i, "important"],
  [/^(?:note|catatan)\s*:\s*/i, "note"],
  [/^(?:tip|tips|saran)\s*:\s*/i, "tip"],
];

/** A paragraph that opens with "Warning:" / "Peringatan:" etc. -> its kind and marker. */
export function wordCallout(text: string): { kind: CalloutKind; marker: string } | null {
  for (const [re, kind] of WORD_CALLOUT) {
    const m = re.exec(text);
    if (m) return { kind, marker: m[0] };
  }
  return null;
}

/** A long absolute path cut to its last parts: "/Users/x/p/lib/a.ts" -> "…/lib/a.ts". */
export function shortPath(path: string, keep = 3): string {
  if (!path.startsWith("/")) return path;
  const parts = path.split("/").filter(Boolean);
  return parts.length <= keep ? path : `…/${parts.slice(-keep).join("/")}`;
}
