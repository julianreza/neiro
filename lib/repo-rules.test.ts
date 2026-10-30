import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_RULES_CHARS, readRepoRules } from "./repo-rules";

test("readRepoRules takes the first rule file, cut to size", async () => {
  const files: Record<string, string> = {
    "/repo/CLAUDE.md": "Claude rules",
    "/other/AGENTS.md": "x".repeat(MAX_RULES_CHARS + 10),
  };
  const read = async (file: string) => {
    if (file in files) return files[file];
    throw new Error("ENOENT");
  };
  assert.deepEqual(await readRepoRules("/repo", read), { file: "CLAUDE.md", text: "Claude rules", truncated: false });
  const cut = await readRepoRules("/other", read);
  assert.equal(cut?.truncated, true);
  assert.equal(cut?.text.length, MAX_RULES_CHARS + 2);
  assert.equal(await readRepoRules("/none", read), null);
  assert.equal(await readRepoRules("relative/path", read), null);
  assert.equal(await readRepoRules(null, read), null);
});
