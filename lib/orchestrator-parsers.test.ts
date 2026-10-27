import test from "node:test";
import assert from "node:assert/strict";
import {
  extractPlanFromOrchestratorOutput,
  extractGateVerdict,
  breakDependencyCycles,
  truncateMiddle,
  type ParsedPlanTask,
} from "./orchestrator-parsers";

test("truncateMiddle preserves head and tail and tags length", () => {
  const shortText = "hello world";
  assert.equal(truncateMiddle(shortText, 20), "hello world");

  const longText = "A".repeat(100) + "B".repeat(100);
  const truncated = truncateMiddle(longText, 50);
  assert.ok(truncated.includes("…[truncated"));
  assert.ok(truncated.startsWith("AAAA"));
  assert.ok(truncated.endsWith("BBBB"));
});

test("extractGateVerdict finds verdict in last 15 lines", () => {
  const passOutput = `
Running checks...
Checking security boundaries...
All tests passed.
VERDICT: PASS
`;
  assert.deepEqual(extractGateVerdict(passOutput, "PASS", "FAIL"), {
    verdict: "PASS",
  });

  const failOutput = `
Running tests...
Found 2 broken endpoints.
VERDICT: FAIL
`;
  assert.deepEqual(extractGateVerdict(failOutput, "PASS", "FAIL"), {
    verdict: "FAIL",
  });
});

test("extractGateVerdict supports APPROVED and CHANGES_REQUESTED", () => {
  const approvedOutput = `
Code review summary:
Everything looks clean and follows contracts.
VERDICT: APPROVED
`;
  assert.deepEqual(extractGateVerdict(approvedOutput, "APPROVED", "CHANGES_REQUESTED"), {
    verdict: "APPROVED",
  });

  const changesOutput = `
Security risk identified in endpoint.
VERDICT: CHANGES_REQUESTED
`;
  assert.deepEqual(extractGateVerdict(changesOutput, "APPROVED", "CHANGES_REQUESTED"), {
    verdict: "CHANGES_REQUESTED",
  });
});

test("extractGateVerdict falls back safely to failToken when missing", () => {
  const vagueOutput = "I finished looking at the code. Looks nice!";
  const res = extractGateVerdict(vagueOutput, "PASS", "FAIL");
  assert.equal(res.verdict, "FAIL");
  assert.ok(res.reason);
});

test("breakDependencyCycles breaks cyclic dependencies (T1 -> T2 -> T1)", () => {
  const cyclicTasks: ParsedPlanTask[] = [
    {
      taskKey: "T1",
      title: "Task 1",
      description: "First",
      specialty: "backend",
      dependsOn: ["T2"],
    },
    {
      taskKey: "T2",
      title: "Task 2",
      description: "Second",
      specialty: "frontend",
      dependsOn: ["T1"],
    },
  ];

  const resolved = breakDependencyCycles(cyclicTasks);
  assert.equal(resolved.length, 2);

  // At least one dependency edge should have been broken to eliminate cycle
  const hasCycle =
    resolved.find((t) => t.taskKey === "T1")?.dependsOn.includes("T2") &&
    resolved.find((t) => t.taskKey === "T2")?.dependsOn.includes("T1");

  assert.equal(hasCycle, false);
});

test("extractPlanFromOrchestratorOutput extracts fenced JSON plan", () => {
  const raw = `
Here is the mission plan:

\`\`\`json
{
  "missionTitle": "Customer Feedback System",
  "summary": "Plan breakdown",
  "tasks": [
    {
      "taskKey": "T1",
      "title": "Database schema",
      "description": "Create feedback and votes tables",
      "specialty": "backend",
      "dependsOn": []
    },
    {
      "taskKey": "T2",
      "title": "Feedback UI",
      "description": "Build voting buttons",
      "specialty": "frontend",
      "dependsOn": ["T1"]
    }
  ]
}
\`\`\`

Let's begin!
`;

  const plan = extractPlanFromOrchestratorOutput(raw, "Fallback prompt");
  assert.equal(plan.missionTitle, "Customer Feedback System");
  assert.equal(plan.tasks.length, 2);
  assert.equal(plan.tasks[0].taskKey, "T1");
  assert.equal(plan.tasks[1].taskKey, "T2");
  assert.deepEqual(plan.tasks[1].dependsOn, ["T1"]);
});

test("extractPlanFromOrchestratorOutput falls back cleanly on malformed input", () => {
  const malformed = "Sorry, I am just an AI and cannot plan this today.";
  const plan = extractPlanFromOrchestratorOutput(malformed, "Build auth service");

  assert.equal(plan.tasks.length, 1);
  assert.equal(plan.tasks[0].taskKey, "T1");
  assert.equal(plan.tasks[0].title, "Build auth service");
  assert.deepEqual(plan.tasks[0].dependsOn, []);
});
