import assert from "node:assert/strict";
import { test } from "node:test";
import { parseMissionCreateBody } from "./mission-input";

test("parseMissionCreateBody applies defaults", () => {
  const result = parseMissionCreateBody({ prompt: "  Build a login page  " });
  assert.deepEqual(result, {
    ok: true,
    value: {
      title: "Build a login page",
      prompt: "Build a login page",
      pauseAfterPlanning: false,
      maxParallelWorkers: 3,
      maxRetries: 2,
      workspacePath: null,
      baseBranch: null,
      isolateWorkspace: true,
    },
  });
});

test("parseMissionCreateBody keeps valid operator controls", () => {
  const result = parseMissionCreateBody({
    title: "Login",
    prompt: "Build it",
    pause_after_planning: true,
    max_parallel_workers: 1,
    max_retries: 0,
    workspace_path: " /srv/app ",
    base_branch: " main ",
    isolate_workspace: false,
  });
  assert.ok(result.ok);
  assert.equal(result.value.pauseAfterPlanning, true);
  assert.equal(result.value.maxParallelWorkers, 1);
  assert.equal(result.value.maxRetries, 0);
  assert.equal(result.value.workspacePath, "/srv/app");
  assert.equal(result.value.baseBranch, "main");
  assert.equal(result.value.isolateWorkspace, false);
});

test("parseMissionCreateBody rejects invalid input", () => {
  const cases: Array<[Record<string, unknown>, RegExp]> = [
    [{}, /prompt/],
    [{ prompt: "   " }, /prompt/],
    [{ prompt: "x", pause_after_planning: "yes" }, /pause_after_planning/],
    [{ prompt: "x", max_parallel_workers: 0 }, /max_parallel_workers/],
    [{ prompt: "x", max_parallel_workers: 11 }, /max_parallel_workers/],
    [{ prompt: "x", max_parallel_workers: 2.5 }, /max_parallel_workers/],
    [{ prompt: "x", max_retries: -1 }, /max_retries/],
    [{ prompt: "x", max_retries: 6 }, /max_retries/],
    [{ prompt: "x", workspace_path: 42 }, /workspace_path/],
    [{ prompt: "x", workspace_path: "a".repeat(501) }, /workspace_path/],
    [{ prompt: "x", base_branch: 7 }, /base_branch/],
    [{ prompt: "x", base_branch: "--force" }, /base_branch/],
    [{ prompt: "x", base_branch: "a..b" }, /base_branch/],
    [{ prompt: "x", base_branch: "has space" }, /base_branch/],
    [{ prompt: "x", isolate_workspace: "yes" }, /isolate_workspace/],
  ];
  for (const [body, pattern] of cases) {
    const result = parseMissionCreateBody(body);
    assert.equal(result.ok, false, JSON.stringify(body));
    if (!result.ok) assert.match(result.error, pattern);
  }
});
