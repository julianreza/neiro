/** Validate the editable task DAG without silently dropping invalid edges. */
export function validateTaskPlan(tasks: { taskKey: string | null; depends: string[] }[]): string | null {
  const keys = tasks.map((task) => task.taskKey).filter((key): key is string => Boolean(key));
  const known = new Set(keys);
  if (known.size !== keys.length) return "Duplicate task key.";
  for (const task of tasks) {
    for (const dep of task.depends) {
      if (!known.has(dep)) return `Unknown dependency: ${dep}.`;
    }
  }
  const remaining = new Map(tasks.filter((task) => task.taskKey).map((task) => [task.taskKey!, new Set(task.depends)]));
  while (remaining.size) {
    const ready = [...remaining].filter(([, deps]) => deps.size === 0).map(([key]) => key);
    if (!ready.length) return "Task dependencies contain a cycle.";
    for (const key of ready) remaining.delete(key);
    for (const deps of remaining.values()) for (const key of ready) deps.delete(key);
  }
  return null;
}

export type TaskPlanEdit = { task_key?: string; title: string; result: string; agent_name: string; depends: string[] };

export function parseTaskPlanEdit(value: unknown, creating: boolean): TaskPlanEdit | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.title !== "string" || !row.title.trim() || row.title.trim().length > 200) return null;
  if (row.result !== undefined && (typeof row.result !== "string" || row.result.length > 8000)) return null;
  if (row.agent_name !== undefined && (typeof row.agent_name !== "string" || row.agent_name.length > 200)) return null;
  if (!Array.isArray(row.depends) || row.depends.length > 100 || row.depends.some((dep) => typeof dep !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(dep))) return null;
  if (creating && (typeof row.task_key !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(row.task_key))) return null;
  return { ...(creating ? { task_key: row.task_key as string } : {}), title: row.title.trim(), result: typeof row.result === "string" ? row.result : "", agent_name: typeof row.agent_name === "string" ? row.agent_name : "", depends: [...new Set(row.depends)] };
}
