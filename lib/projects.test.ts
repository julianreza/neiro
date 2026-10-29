import assert from "node:assert/strict";
import { test } from "node:test";
import { findProjectFor, groupProjects, inProject } from "./projects";
import type { SavedProject } from "./projects";
import type { MissionSummaryDTO } from "./types";

function mission(over: Partial<MissionSummaryDTO>): MissionSummaryDTO {
  return {
    id: "m",
    title: "t",
    prompt: "p",
    status: "completed",
    phase: "done",
    pauseAfterPlanning: false,
    maxParallelWorkers: 3,
    maxRetries: 2,
    workspacePath: null,
    baseBranch: null,
    agentWorkspacePath: null,
    workBranch: null,
    worktreePath: null,
    repoRoot: null,
    runId: null,
    runAgentId: null,
    runStartedAt: null,
    lastError: null,
    lastErrorAt: null,
    totalTasks: 0,
    completedTasks: 0,
    totalTokens: 0,
    ...over,
  };
}

function row(id: string, path = `/x/${id}`, git = false): SavedProject {
  return { id, path, name: "", git, createdAt: "2020-01-01T00:00:00Z" };
}

test("only saved projects are listed; linked missions join them", () => {
  const projects = groupProjects(
    [
      mission({ id: "1", projectId: "p1", workBranch: "neiro/one", status: "running", createdAt: "2026-10-02T00:00:00Z", baseBranch: "main" }),
      mission({ id: "2", projectId: "p1", status: "completed", createdAt: "2026-10-01T00:00:00Z" }),
      mission({ id: "3", projectId: "gone" }),
      mission({ id: "4", workspacePath: "/x/neiro" }),
    ],
    [row("p1", "/x/neiro", true)],
  );
  assert.equal(projects.length, 1);
  const [neiro] = projects;
  assert.equal(neiro.name, "neiro");
  assert.equal(neiro.running, 1);
  assert.equal(neiro.done, 1);
  assert.equal(neiro.git, true);
  assert.equal(neiro.baseBranch, "main");
  assert.deepEqual(neiro.branches.map((b) => b.name), ["neiro/one"]);
  assert.deepEqual(neiro.missions.map((m) => m.id), ["1", "2"]);
});

test("busy projects come first, then the newest", () => {
  const projects = groupProjects(
    [
      mission({ id: "1", projectId: "old", createdAt: "2026-01-01T00:00:00Z" }),
      mission({ id: "2", projectId: "new", createdAt: "2026-09-01T00:00:00Z" }),
      mission({ id: "3", projectId: "busy", status: "awaiting_plan_approval", createdAt: "2025-01-01T00:00:00Z" }),
    ],
    [row("old"), row("new"), row("busy")],
  );
  assert.deepEqual(projects.map((p) => p.id), ["busy", "new", "old"]);
});

test("a project with no missions is still listed", () => {
  const [site] = groupProjects([], [row("s1", "/x/site", true)]);
  assert.equal(site.missions.length, 0);
  assert.equal(site.git, true);
});

test("a folder inside the project counts, a sibling folder does not", () => {
  assert.equal(inProject("/x/neiro", "/x/neiro"), true);
  assert.equal(inProject("/x/neiro", "/x/neiro/app/"), true);
  assert.equal(inProject("/x/neiro", "/x/neiro-old"), false);
  assert.equal(inProject("/x/neiro", null), false);
});

test("a new mission links to the deepest project folder that holds it", () => {
  const projects = [row("mono", "/x/mono"), row("app", "/x/mono/app")];
  assert.equal(findProjectFor(projects, "/x/mono/app/src")?.id, "app");
  assert.equal(findProjectFor(projects, "/x/mono/lib")?.id, "mono");
  assert.equal(findProjectFor(projects, "/x/other"), undefined);
});
