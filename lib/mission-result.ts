import { extractGateVerdict } from "@/lib/orchestrator-parsers";
import { parseReviewOutput, reviewPassed } from "@/lib/code-review";
import { diffFileName } from "@/lib/reply-text";
import type { MissionArtifact, MissionDetailDTO, MissionTask } from "@/lib/types";

export type Verification = "Passed" | "Failed" | "Skipped" | "Unknown";

function verification(task: MissionTask, artifacts: MissionArtifact[], gate: "qa" | "review"): Verification {
  const report = artifacts.find((a) => a.taskId === task.id && a.dedupeKey === `${gate}:${task.id}:${task.retries}`);
  if (!report) return "Unknown";
  if (report.kind === "gate_skipped") return "Skipped";
  if (gate === "review") {
    const parsed = parseReviewOutput(report.content);
    if (parsed.ok) return reviewPassed(parsed.verdict, parsed.findings) ? "Passed" : "Failed";
  }
  const verdict = extractGateVerdict(report.content, gate === "qa" ? "PASS" : "APPROVED", gate === "qa" ? "FAIL" : "CHANGES_REQUESTED");
  if (verdict.reason) return "Unknown";
  return verdict.verdict === "PASS" || verdict.verdict === "APPROVED" ? "Passed" : "Failed";
}

export function missionResult(mission: MissionDetailDTO) {
  const tasks = mission.tasks.map((task) => ({ id: task.id, title: task.title, qa: verification(task, mission.artifacts, "qa"), review: verification(task, mission.artifacts, "review") }));
  const files = [...new Set(mission.artifacts.filter((a) => a.kind === "code_diff").flatMap((a) => a.content.split(/^(?=diff --git )/m).map(diffFileName).filter((name): name is string => Boolean(name))))].sort();
  const start = Date.parse(mission.createdAt ?? "");
  const end = Date.parse(mission.completedAt ?? "");
  return {
    summary: mission.artifacts.find((a) => a.kind === "mission_summary")?.content ?? null,
    tasks, files,
    retries: mission.tasks.reduce((sum, task) => sum + task.retries, 0),
    durationMs: Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null,
    qaPassed: tasks.filter((task) => task.qa === "Passed").length,
    qaKnown: tasks.filter((task) => task.qa === "Passed" || task.qa === "Failed").length,
    filesMayBeIncomplete: mission.artifacts.some((a) => a.kind === "code_diff" && a.content.includes("diff cut, too long to show")),
  };
}

export type MissionResult = ReturnType<typeof missionResult>;
