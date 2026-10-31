/**
 * Formatting rules added to agent prompts, so replies use the shapes the
 * chat draws as cards (components/reply-extras.tsx, lib/reply-text.ts).
 */

/** Shapes any agent reply may use. */
export const REPLY_SHAPES = [
  "Formatting the chat understands (use only when it fits):",
  "- A plan or checklist: a task list, `- [x] done` / `- [ ] todo`.",
  "- A code change: a ```diff block per file with `--- a/path` and `+++ b/path` headers.",
  "- A command you ran: a ```sh block, first line `$ command`, then the output, then `exit N`.",
  "- A note or risk: a quote that starts with [!NOTE], [!TIP], [!WARNING] or [!CAUTION].",
  "- A flow or structure: a ```mermaid diagram.",
  "- A source: a footnote like [^1] with the link at the end.",
  "- Paths as `path/to/file.ts:42` in backticks.",
].join("\n");

/** For chats with a person who can click: suggested next steps as buttons. */
export const FOLLOW_UP_RULE =
  "When there are clear next steps, add one line `[OPTIONS: step one | step two]` with 2-4 short steps written as the user's own words.";
