import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseMissionCreateBody } from "@/lib/mission-input";
import { missionPreflight, choosePreflightAgent } from "@/lib/mission-preflight";
import type { Agent } from "@/lib/types";

function agent(id: string, specialty: string, enabled = true): Agent {
  return { id, name: id, specialty, enabled, stage: "workers", role: "worker", model: "", profile: "default", prompt: "", url: "", activeRun: false };
}

test("preflight selects agents like the orchestrator", () => {
  const agents = [agent("disabled", "fullstack", false), agent("backend", "backend"), agent("full", "Fullstack")];
  assert.equal(choosePreflightAgent(agents, "workers")?.id, "full");
  assert.equal(choosePreflightAgent(agents, "qa"), undefined);
  assert.equal(choosePreflightAgent(agents.slice(0, 2), "workers")?.id, "backend");
});


test("preflight blocks a missing branch and planner without changing the workspace", async () => {
  const dir = await mkdtemp(join(tmpdir(), "neiro-preflight-"));
  try {
    const parsed = parseMissionCreateBody({ prompt: "test", workspace_path: dir, base_branch: "missing", mode: "plan" });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const result = await missionPreflight(parsed.value, []);
    assert.equal(result.checks.find((check) => check.id === "branch")?.status, "blocked");
    assert.equal(result.checks.find((check) => check.id === "planner")?.status, "blocked");
    assert.equal(result.checks.find((check) => check.id === "qa")?.status, "warning");
    assert.deepEqual(await readdir(dir), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
