import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readProfileContextFiles, writeProfileContextFile } from "./hermes-memory";

test("profile context reads and writes within limits, rejects unsafe paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "neiro-memory-"));
  try {
    assert.deepEqual(await readProfileContextFiles("default", root), { soul: "", memory: "", user: "", limits: { soulMax: 8000, memoryMax: 2200, userMax: 1375 } });
    await writeProfileContextFile("default", "soul", "Agent persona", root);
    await writeProfileContextFile("default", "memory", "Project facts", root);
    assert.equal((await readProfileContextFiles("default", root)).memory, "Project facts");
    await assert.rejects(writeProfileContextFile("default", "memory", "x".repeat(2201), root));
    await assert.rejects(writeProfileContextFile("../other", "soul", "x", root));
    await rm(join(root, "memories"), { recursive: true });
    const outside = join(root, "outside");
    await mkdir(outside);
    await symlink(outside, join(root, "memories"));
    await assert.rejects(writeProfileContextFile("default", "memory", "x", root));
    await assert.rejects(readProfileContextFiles("default", root));
  } finally { await rm(root, { recursive: true, force: true }); }
});
