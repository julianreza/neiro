/**
 * Wrap git-ish tokens in plain agent text with backticks so the markdown
 * renderer shows them as coloured code chips: commit hashes, branch names,
 * file names. Existing code, links and URLs are left untouched.
 */

// Parts of the text that must not be rewritten.
const SKIP = /(```[\s\S]*?```|`[^`\n]+`|\[[^\]]*\]\([^)]*\)|https?:\/\/\S+)/g;

const BRANCH_PREFIX = "(?:feat|feature|fix|hotfix|chore|docs|release|neiro|codex|kiro)";
const FILE_EXT = "(?:tsx?|jsx?|mjs|css|md|json|sql|ya?ml|py|sh|toml|lock)";

const TOKEN = new RegExp(
  [
    `\\b[0-9a-f]{7,40}\\b`, // commit hash
    `\\b${BRANCH_PREFIX}\\/[\\w.-]*\\w(?:\\/[\\w.-]*\\w)*`, // branch name (no trailing dot)
    `(?:\\.{0,2}\\/)?(?:[\\w-]+\\/)*[\\w-]+\\.${FILE_EXT}\\b`, // file or path
    `\\b(?:main|master|HEAD|origin\\/main|worktree)\\b`, // git words
  ].join("|"),
  "g",
);

function isHash(token: string): boolean {
  return /^[0-9a-f]{7,40}$/.test(token) && /[0-9]/.test(token) && /[a-f]/.test(token);
}

function chipPlain(text: string): string {
  return text.replace(TOKEN, (token) => {
    if (/^[0-9a-f]+$/.test(token) && !isHash(token)) return token;
    return `\`${token}\``;
  });
}

export function chipTokens(markdown: string): string {
  if (!markdown) return markdown;
  let out = "";
  let last = 0;
  for (const match of markdown.matchAll(SKIP)) {
    const start = match.index ?? 0;
    out += chipPlain(markdown.slice(last, start)) + match[0];
    last = start + match[0].length;
  }
  return out + chipPlain(markdown.slice(last));
}
