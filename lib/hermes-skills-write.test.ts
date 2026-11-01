import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, symlink, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveLearnedSkillFile } from "./hermes-skills";

const content = "---\nname: ship-safely\ndescription: Safe process\n---\n\n1. Run tests.\n";

test("learned skills save in the chosen profile and never overwrite existing files", async () => {
  const root = await mkdtemp(join(tmpdir(), "neiro-skills-"));
  try {
    const file = await saveLearnedSkillFile("dev", "ship-safely", content, root);
    assert.equal(file, join(root, "profiles", "dev", "skills", "ship-safely", "SKILL.md"));
    assert.equal(await readFile(file, "utf8"), content);
    await assert.rejects(saveLearnedSkillFile("dev", "ship-safely", content, root));
    await assert.rejects(saveLearnedSkillFile("../escape", "ship-safely", content, root));
    await assert.rejects(saveLearnedSkillFile("dev", "../escape", content, root));
    await assert.rejects(saveLearnedSkillFile("dev", "different", content, root));
    await mkdir(join(root, "profiles", "other"), { recursive: true });
    await symlink(root, join(root, "profiles", "other", "skills"));
    await assert.rejects(saveLearnedSkillFile("other", "ship-safely", content, root));
  } finally { await rm(root, { recursive: true, force: true }); }
});
