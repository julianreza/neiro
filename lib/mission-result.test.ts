import { test } from "node:test";
import assert from "node:assert/strict";
import { missionResult } from "@/lib/mission-result";
import type { MissionDetailDTO, MissionArtifact, MissionTask } from "@/lib/types";

const task = { id: "t1", title: "Build", retries: 1 } as MissionTask;
const artifact = (kind: string, dedupeKey: string, content: string): MissionArtifact => ({ id: dedupeKey, missionId: "m", taskId: "t1", title: "", kind, content, dedupeKey });
test("result uses only the current attempt and does not infer verification from completion", () => {
  const mission = { tasks: [task], createdAt: "2026-01-01T00:00:00Z", completedAt: "2026-01-01T01:00:00Z", artifacts: [artifact("qa_report", "qa:t1:0", "VERDICT: FAIL"), artifact("qa_report", "qa:t1:1", "VERDICT: PASS"), artifact("gate_skipped", "review:t1:1", "No reviewer")] } as MissionDetailDTO;
  const result = missionResult(mission);
  assert.equal(result.tasks[0].qa, "Passed");
  assert.equal(result.tasks[0].review, "Skipped");
  assert.equal(result.durationMs, 3600000);
  assert.equal(missionResult({ ...mission, artifacts: [] }).tasks[0].qa, "Unknown");
  assert.equal(missionResult({ ...mission, artifacts: [] }).tasks[0].review, "Unknown");
});
test("unparseable reports are unknown and recorded files are deduplicated", () => {
  const diff = "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n+hello";
  const result = missionResult({ tasks: [task], artifacts: [artifact("qa_report", "qa:t1:1", "maybe"), artifact("code_diff", "d1", diff), artifact("code_diff", "d2", diff)] } as MissionDetailDTO);
  assert.equal(result.tasks[0].qa, "Unknown");
  assert.deepEqual(result.files, ["src/a.ts"]);
});

test("cost coverage makes missing run prices visible", () => {
  const mission = { tasks: [], artifacts: [], runUsage: [{ costUsd: 0.12 }, { costUsd: null }] } as unknown as MissionDetailDTO;
  assert.deepEqual(missionResult(mission).cost, { cost: 0.12, priced: 1, total: 2 });
  assert.equal(missionResult({ ...mission, runUsage: undefined }).cost, null);
});
