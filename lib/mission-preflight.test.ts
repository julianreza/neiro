import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
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

test("unavailable verification agents warn without blocking required runtimes", async () => {
  const parsed = parseMissionCreateBody({ prompt: "test", mode: "plan" });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const agents: Agent[] = [
    { ...agent("planner", "fullstack"), stage: "orchestrator" },
    { ...agent("worker", "fullstack"), stage: "workers" },
    { ...agent("qa", "qa"), stage: "qa" },
    { ...agent("review", "review"), stage: "reviewer" },
  ];
  const result = await missionPreflight(parsed.value, agents, { inspectRuntime: async (a) => ({ status: a.id === "qa" ? "unavailable" : "pass", reason: a.id === "qa" ? "QA runtime not installed" : "Ready" }) });
  assert.equal(result.checks.find((check) => check.id === "qa")?.status, "warning");
  assert.equal(result.checks.some((check) => check.status === "blocked"), false);
  assert.equal(result.checks.find((check) => check.id === "reviewer")?.status, "pass");
});

test("parallel worktree preflight blocks a Hermes worker and warns for a Hermes verifier", async () => {
  const dir = await mkdtemp(join(tmpdir(), "neiro-preflight-git-"));
  try {
    execFileSync("git", ["init", "-q", dir]);
    execFileSync("git", ["-C", dir, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-qm", "init"]);
    const parsed = parseMissionCreateBody({ prompt: "test", mode: "plan", workspace_path: dir, max_parallel_workers: 2 });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const planner = { ...agent("planner", "fullstack"), stage: "orchestrator" as const };
    const worker = { ...agent("worker", "fullstack"), runtime: "hermes" as const };
    const qa = { ...agent("qa", "qa"), stage: "qa" as const, runtime: "hermes" as const };
    const probe = { inspectRuntime: async () => ({ status: "pass" as const, reason: "Ready" }) };
    const blocked = await missionPreflight(parsed.value, [planner, worker, qa], probe);
    assert.equal(blocked.checks.find((check) => check.id === "task_runtime_isolation")?.status, "blocked");
    const optional = await missionPreflight(parsed.value, [planner, { ...worker, runtime: "ohmypi" }, qa], probe);
    assert.equal(optional.checks.find((check) => check.id === "qa")?.status, "warning");
    assert.equal(optional.checks.some((check) => check.status === "blocked"), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
