export type ParsedPlanTask = {
  taskKey: string;
  title: string;
  description: string;
  specialty: string;
  dependsOn: string[];
};

export type ParsedPlan = {
  missionTitle?: string;
  summary?: string;
  tasks: ParsedPlanTask[];
};

export function truncateMiddle(text: string, maxChars: number): string {
  if (!text || text.length <= maxChars) {
    return text;
  }
  const ellipsisTag = `\n…[truncated ${text.length - maxChars} chars]…\n`;
  const availableChars = Math.max(0, maxChars - ellipsisTag.length);
  const headLength = Math.ceil(availableChars / 2);
  const tailLength = Math.floor(availableChars / 2);

  return text.slice(0, headLength) + ellipsisTag + text.slice(text.length - tailLength);
}

export function extractGateVerdict(
  raw: string,
  passToken: "PASS" | "APPROVED",
  failToken: "FAIL" | "CHANGES_REQUESTED",
): { verdict: "PASS" | "FAIL" | "APPROVED" | "CHANGES_REQUESTED"; reason?: string } {
  if (!raw || typeof raw !== "string") {
    return { verdict: failToken, reason: "No output received" };
  }

  // Scan last 15 lines first
  const lines = raw.trim().split("\n");
  const last15 = lines.slice(-15).join("\n");

  const verdictRegex = /VERDICT:\s*(PASS|APPROVED|FAIL|CHANGES_REQUESTED)/i;
  let match = last15.match(verdictRegex);

  // If not in last 15 lines, scan entire output
  if (!match) {
    match = raw.match(verdictRegex);
  }

  if (match && match[1]) {
    const token = match[1].toUpperCase();
    if (token === passToken) {
      return { verdict: passToken };
    }
    if (token === failToken) {
      return { verdict: failToken };
    }
    if (token === "PASS" || token === "APPROVED") {
      return { verdict: passToken };
    }
    if (token === "FAIL" || token === "CHANGES_REQUESTED") {
      return { verdict: failToken };
    }
  }

  // Fallback conservatively to failToken
  return { verdict: failToken, reason: "No explicit VERDICT found in output" };
}

/**
 * Break cyclic dependencies using Kahn's topological sort algorithm.
 * Any dependency causing a cycle will be removed.
 */
export function breakDependencyCycles(tasks: ParsedPlanTask[]): ParsedPlanTask[] {
  const taskMap = new Map<string, ParsedPlanTask>();
  const inDegree = new Map<string, number>();
  const adj = new Map<string, Set<string>>(); // u -> Set of v (where v depends on u)

  for (const t of tasks) {
    taskMap.set(t.taskKey, { ...t, dependsOn: [...t.dependsOn] });
    inDegree.set(t.taskKey, 0);
    adj.set(t.taskKey, new Set());
  }

  // Clean dependencies to only known existing tasks and strip self-dependencies
  for (const [key, t] of taskMap.entries()) {
    const validDeps = t.dependsOn.filter((dep) => dep !== key && taskMap.has(dep));
    t.dependsOn = validDeps;
    inDegree.set(key, validDeps.length);
  }

  for (const [key, t] of taskMap.entries()) {
    for (const dep of t.dependsOn) {
      adj.get(dep)?.add(key);
    }
  }

  // Kahn's algorithm: queue of tasks with inDegree === 0
  const queue: string[] = [];
  for (const [key, deg] of inDegree.entries()) {
    if (deg === 0) {
      queue.push(key);
    }
  }

  const visited = new Set<string>();
  while (queue.length > 0) {
    const u = queue.shift()!;
    visited.add(u);

    const neighbors = adj.get(u) || new Set();
    for (const v of neighbors) {
      const currentDeg = inDegree.get(v) || 0;
      const nextDeg = currentDeg - 1;
      inDegree.set(v, nextDeg);
      if (nextDeg === 0) {
        queue.push(v);
      }
    }
  }

  // If all tasks were visited, there are no cycles
  if (visited.size === tasks.length) {
    return Array.from(taskMap.values());
  }

  // Cycle detected! Unvisited tasks are part of or downstream of a cycle.
  // Break cycle by pruning unvisited dependency edges
  for (const [key, t] of taskMap.entries()) {
    if (!visited.has(key)) {
      // Keep only dependencies that were successfully visited (part of valid DAG before cycle)
      t.dependsOn = t.dependsOn.filter((dep) => visited.has(dep));
    }
  }

  return Array.from(taskMap.values());
}

export function extractPlanFromOrchestratorOutput(
  raw: string,
  fallbackPrompt: string,
): ParsedPlan {
  if (!raw || typeof raw !== "string") {
    return createFallbackPlan(fallbackPrompt);
  }

  let jsonStr = "";

  // 1. Try markdown fenced code blocks ```json ... ```
  const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch && fencedMatch[1]) {
    jsonStr = fencedMatch[1].trim();
  } else {
    // 2. Try outermost { ... }
    const firstBrace = raw.indexOf("{");
    const lastBrace = raw.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      jsonStr = raw.slice(firstBrace, lastBrace + 1).trim();
    }
  }

  if (!jsonStr) {
    return createFallbackPlan(fallbackPrompt);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return createFallbackPlan(fallbackPrompt);
  }

  if (!parsed || typeof parsed !== "object") {
    return createFallbackPlan(fallbackPrompt);
  }

  const root = parsed as Record<string, unknown>;
  const rawTasks = Array.isArray(root.tasks)
    ? root.tasks
    : Array.isArray(root.plan)
      ? root.plan
      : null;

  if (!rawTasks || rawTasks.length === 0) {
    return createFallbackPlan(fallbackPrompt);
  }

  const rawTitle = typeof root.missionTitle === "string" ? root.missionTitle : typeof root.title === "string" ? root.title : undefined;
  const rawSummary = typeof root.summary === "string" ? root.summary : undefined;

  const validTasks: ParsedPlanTask[] = [];
  let index = 1;

  for (const item of rawTasks) {
    if (!item || typeof item !== "object") continue;
    const taskObj = item as Record<string, unknown>;

    const defaultKey = `T${index}`;
    const rawKey =
      typeof taskObj.taskKey === "string"
        ? taskObj.taskKey
        : typeof taskObj.id === "string"
          ? taskObj.id
          : typeof taskObj.key === "string"
            ? taskObj.key
            : defaultKey;

    const normalizedKey = rawKey.trim().toUpperCase().startsWith("T")
      ? rawKey.trim().toUpperCase()
      : `T${rawKey.trim()}`;

    const title =
      typeof taskObj.title === "string" && taskObj.title.trim()
        ? taskObj.title.trim()
        : `Execute task ${normalizedKey}`;

    const description =
      typeof taskObj.description === "string" && taskObj.description.trim()
        ? taskObj.description.trim()
        : title;

    const specialty =
      typeof taskObj.specialty === "string" && taskObj.specialty.trim()
        ? taskObj.specialty.trim()
        : "fullstack";

    const rawDeps = Array.isArray(taskObj.dependsOn)
      ? taskObj.dependsOn
      : Array.isArray(taskObj.depends)
        ? taskObj.depends
        : [];

    const dependsOn = rawDeps
      .filter((d): d is string => typeof d === "string")
      .map((d) => d.trim().toUpperCase())
      .filter((d) => d !== normalizedKey);

    validTasks.push({
      taskKey: normalizedKey,
      title,
      description,
      specialty,
      dependsOn,
    });

    index++;
  }

  if (validTasks.length === 0) {
    return createFallbackPlan(fallbackPrompt);
  }

  const acyclicTasks = breakDependencyCycles(validTasks);

  return {
    missionTitle: rawTitle,
    summary: rawSummary,
    tasks: acyclicTasks,
  };
}

function createFallbackPlan(fallbackPrompt: string): ParsedPlan {
  const title = fallbackPrompt
    ? fallbackPrompt.split("\n")[0].slice(0, 80).trim()
    : "Primary Implementation Task";

  return {
    missionTitle: title,
    tasks: [
      {
        taskKey: "T1",
        title: title || "Primary Implementation Task",
        description: fallbackPrompt || "Implement requested mission objective.",
        specialty: "fullstack",
        dependsOn: [],
      },
    ],
  };
}
