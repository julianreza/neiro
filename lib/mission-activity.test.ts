import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createStepCollector } from "./run-steps";
import { taskActivity } from "./mission-activity";
import type { MissionTask } from "./types";

describe("mission activity", () => {
  it("observes message events as well as terminal frames", () => {
    const events: { terminal: boolean }[] = [];
    const collector = createStepCollector((event) => events.push(event));
    collector.feed('data: {"type":"message","content":"hello"}\n\ndata: [DONE]\n\n');
    assert.equal(events.length, 2);
    assert.equal(events[1].terminal, true);
  });
  it("prioritizes approval and does not mark unavailable activity stale", () => {
    const task = { id: "1", title: "task", stage: "Coding", approval: true, runId: "a", retries: 0, depends: [] } as unknown as MissionTask;
    assert.equal(taskActivity(task, [task], {}, 1000000).label, "Waiting for approval");
    assert.equal(taskActivity({ ...task, approval: false }, [task], {}, 1000000).unavailable, true);
    const result = taskActivity({ ...task, approval: false }, [task], { a: { at: new Date(0).toISOString(), terminal: false } }, 600000);
    assert.equal(result.stale, true);
  });
});
