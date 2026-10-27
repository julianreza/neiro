import assert from "node:assert/strict";
import { test } from "node:test";
import { initialMissions, updateDemoTask } from "./demo-missions";

test("demo transitions clear approvals, count retries, and complete only after all tasks finish", () => {
  const original = initialMissions[0];
  const retry = updateDemoTask(original, "T6", "Queued");
  assert.equal(retry.tasks.find((task) => task.id === "T6")?.retries, 1);
  assert.equal(retry.tasks.find((task) => task.id === "T6")?.approval, false);
  assert.equal(original.tasks.find((task) => task.id === "T6")?.approval, true);
  let mission = retry;
  for (const task of mission.tasks)
    mission = updateDemoTask(mission, task.id, "Done");
  assert.equal(mission.status, "completed");
  assert.equal(updateDemoTask(mission, "T1", "Queued").status, "running");
});
