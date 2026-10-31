import type { MissionDetailDTO, MissionTask } from "@/lib/types";

export function taskActivity(task: MissionTask, tasks: MissionTask[], activity: MissionDetailDTO["activity"], now = Date.now()) {
  const dependencies = task.depends.some((key) => !tasks.some((item) => item.taskKey === key && item.stage === "Done"));
  let label: string;
  if (task.stage === "Done") label = "Done";
  else if (task.approval || task.pendingControls?.length || task.stage === "Awaiting routing") label = "Waiting for approval";
  else if (task.stage === "Needs you") label = "Needs attention";
  else if (!task.runId && dependencies) label = "Waiting for dependencies";
  else if (task.runId && task.retries > 0) label = "Retrying";
  else if (task.runId) label = "Working";
  else label = "Queued";
  const observed = task.runId ? activity?.[task.runId] : undefined;
  const at = observed?.at ?? null;
  const stale = Boolean((label === "Working" || label === "Retrying") && at && !observed?.terminal && now - Date.parse(at) >= 10 * 60_000);
  return { id: task.id, title: task.title, label, at, stale, unavailable: Boolean(task.runId && !observed) };
}
