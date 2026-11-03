import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { workspaceReservationKey } from "@/lib/workspace-reservation";

test("repository subfolders and symlinks use the same reservation", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "neiro-reservation-"));
  try {
    const repo = path.join(dir, "repo");
    await mkdir(path.join(repo, "nested"), { recursive: true });
    execFileSync("git", ["init", "-q", repo]);
    const alias = path.join(dir, "alias");
    await symlink(repo, alias);
    assert.equal(await workspaceReservationKey(repo), await workspaceReservationKey(path.join(alias, "nested")));
    assert.notEqual(await workspaceReservationKey(repo), await workspaceReservationKey(dir));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
