import { getSupabaseAdmin } from "@/lib/supabase";
import {
  Agent,
  Mission,
  MissionStatus,
  MissionTask,
  MissionArtifact,
  MissionDetailDTO,
  TaskStage,
  AgentStage,
} from "@/lib/types";
import {
  startHermesRun,
  getHermesRun,
  createHermesSession,
} from "@/lib/hermes";
import {
  extractPlanFromOrchestratorOutput,
  extractGateVerdict,
} from "@/lib/orchestrator-parsers";

export type AdvanceActiveMissionsResult = {
  advancedCount: number;
  errors: string[];
};

// Database row mappings
function mapAgentRow(row: Record<string, unknown>): Agent {
  return {
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    role: String(row.role ?? ""),
    stage: (row.stage as AgentStage) || "workers",
    specialty: String(row.specialty ?? ""),
    model: String(row.model ?? "Claude Sonnet 4.6"),
    profile: String(row.profile ?? "default"),
    prompt: String(row.prompt ?? ""),
    url: String(row.url ?? ""),
    key_enc: typeof row.key_enc === "string" ? row.key_enc : null,
    enabled: Boolean(row.enabled ?? true),
    activeRun: Boolean(row.active_run ?? false),
    createdAt: typeof row.created_at === "string" ? row.created_at : undefined,
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : undefined,
  };
}

function mapMissionRow(row: Record<string, unknown>): Mission {
  return {
    id: String(row.id ?? ""),
    title: String(row.title ?? ""),
    prompt: String(row.prompt ?? ""),
    status: (row.status as MissionStatus) || "running",
    createdAt: typeof row.created_at === "string" ? row.created_at : undefined,
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : undefined,
  };
}

function mapTaskRow(row: Record<string, unknown>): MissionTask {
  const rawDepends = row.depends;
  const depends = Array.isArray(rawDepends)
    ? rawDepends.map((d) => String(d))
    : [];

  return {
    id: String(row.id ?? ""),
    missionId: String(row.mission_id ?? ""),
    title: String(row.title ?? ""),
    stage: (row.stage as TaskStage) || "Queued",
    agentId: typeof row.agent_id === "string" ? row.agent_id : null,
    agentName: String(row.agent_name ?? ""),
    model: String(row.model ?? ""),
    tokens: Number(row.tokens ?? 0),
    depends,
    approval: Boolean(row.approval ?? false),
    retries: Number(row.retries ?? 0),
    result: typeof row.result === "string" ? row.result : null,
    createdAt: typeof row.created_at === "string" ? row.created_at : undefined,
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : undefined,
  };
}

function mapArtifactRow(row: Record<string, unknown>): MissionArtifact {
  return {
    id: String(row.id ?? ""),
    missionId: String(row.mission_id ?? ""),
    taskId: typeof row.task_id === "string" ? row.task_id : null,
    title: String(row.title ?? ""),
    kind: String(row.kind ?? "document"),
    content: String(row.content ?? ""),
    createdAt: typeof row.created_at === "string" ? row.created_at : undefined,
  };
}

export async function pickStageAgent(
  stage: string,
  specialty?: string,
): Promise<Agent | null> {
  const supabase = getSupabaseAdmin();
  const { data: rows, error } = await supabase
    .from("agents")
    .select("*")
    .eq("enabled", true)
    .eq("stage", stage);

  if (error || !rows || rows.length === 0) {
    return null;
  }

  const agents = rows.map((r) => mapAgentRow(r as Record<string, unknown>));

  if (specialty) {
    const exact = agents.find(
      (a) => a.specialty.toLowerCase() === specialty.toLowerCase(),
    );
    if (exact) return exact;
  }

  const fullstack = agents.find(
    (a) => a.specialty.toLowerCase() === "fullstack" || a.specialty.toLowerCase().includes("fullstack"),
  );
  if (fullstack) return fullstack;

  return agents[0];
}

export async function getMissionDetail(missionId: string): Promise<MissionDetailDTO> {
  const supabase = getSupabaseAdmin();

  const [mRes, tRes, aRes] = await Promise.all([
    supabase.from("missions").select("*").eq("id", missionId).single(),
    supabase.from("mission_tasks").select("*").eq("mission_id", missionId).order("created_at", { ascending: true }),
    supabase.from("mission_artifacts").select("*").eq("mission_id", missionId).order("created_at", { ascending: true }),
  ]);

  if (mRes.error || !mRes.data) {
    throw new Error(`Mission ${missionId} not found`);
  }

  const mission = mapMissionRow(mRes.data as Record<string, unknown>);
  const tasks = (tRes.data || []).map((r) => mapTaskRow(r as Record<string, unknown>));
  const artifacts = (aRes.data || []).map((r) => mapArtifactRow(r as Record<string, unknown>));

  return {
    ...mission,
    tasks,
    artifacts,
  };
}

export async function advanceMission(missionId: string): Promise<MissionDetailDTO> {
  const supabase = getSupabaseAdmin();
  const detail = await getMissionDetail(missionId);

  // If already terminal, return
  if (detail.status === "completed" || detail.status === "cancelled") {
    return detail;
  }

  // 1. Planning stage: mission has no tasks yet
  if (detail.tasks.length === 0) {
    const pmAgent = await pickStageAgent("orchestrator");
    if (!pmAgent) {
      return detail;
    }

    const planRunResult = await startHermesRun(pmAgent, {
      prompt: `Break down the following mission into sequential/parallel execution tasks in JSON format with fields: tasks: [{ taskKey: "T1", title: string, description: string, specialty: string, dependsOn: string[] }].\n\nMission Objective: ${detail.prompt}`,
      idempotencyKey: `plan-${detail.id}`,
    });

    if (planRunResult.kind === "deferred") {
      return detail;
    }

    const runStatus = await getHermesRun(pmAgent, planRunResult.runId);
    const outputText = runStatus.output || "";

    if (!outputText && runStatus.status !== "completed") {
      return detail;
    }

    const parsedPlan = extractPlanFromOrchestratorOutput(outputText, detail.prompt);

    // Insert task_plan artifact
    await supabase.from("mission_artifacts").insert({
      id: crypto.randomUUID(),
      mission_id: detail.id,
      title: "Task Breakdown Plan",
      kind: "task_plan",
      content: outputText || JSON.stringify(parsedPlan, null, 2),
    });

    // Insert tasks into mission_tasks
    const taskInserts = parsedPlan.tasks.map((t) => ({
      id: crypto.randomUUID(),
      mission_id: detail.id,
      title: t.title,
      stage: "Queued",
      agent_name: t.specialty,
      model: pmAgent.model,
      tokens: 0,
      depends: t.dependsOn,
      approval: false,
      retries: 0,
      result: t.description,
    }));

    if (taskInserts.length > 0) {
      await supabase.from("mission_tasks").insert(taskInserts);
    }

    // Try spec writer stage if spec agent exists
    const specAgent = await pickStageAgent("spec");
    if (specAgent) {
      const specRun = await startHermesRun(specAgent, {
        prompt: `Write a Product Requirements Document (PRD) for this mission:\n\nMission Objective: ${detail.prompt}\n\nTasks:\n${JSON.stringify(parsedPlan.tasks, null, 2)}`,
        idempotencyKey: `spec-${detail.id}`,
      });

      if (specRun.kind === "started") {
        const specStatus = await getHermesRun(specAgent, specRun.runId);
        if (specStatus.output) {
          await supabase.from("mission_artifacts").insert({
            id: crypto.randomUUID(),
            mission_id: detail.id,
            title: "Product Requirements Document (PRD)",
            kind: "prd",
            content: specStatus.output,
          });
        }
      }
    }

    return getMissionDetail(missionId);
  }

  // 2. Running stage: reconcile active tasks

  // Check if all tasks are Done
  if (detail.tasks.length > 0 && detail.tasks.every((t) => t.stage === "Done")) {
      // Create mission summary artifact
      const summaryAgent = (await pickStageAgent("reviewer")) || (await pickStageAgent("orchestrator"));
      if (summaryAgent) {
        const summaryOutput = `Mission completed successfully. All ${detail.tasks.length} tasks passed QA and final review.`;
        await supabase.from("mission_artifacts").insert({
          id: crypto.randomUUID(),
          mission_id: detail.id,
          title: "Mission Summary",
          kind: "mission_summary",
          content: summaryOutput,
        });
      }

      await supabase
        .from("missions")
        .update({ status: "completed", updated_at: new Date().toISOString() })
        .eq("id", detail.id);
    return getMissionDetail(missionId);
  }

  // Process tasks
  for (const task of detail.tasks) {
    if (task.stage === "Done" || task.stage === "Needs you") {
      continue;
    }

    // Check dependencies
    const depsDone = task.depends.every((dep) => {
      // dep can be title or key, check matches
      return detail.tasks.some(
        (t) => (t.id === dep || t.title.includes(dep)) && t.stage === "Done",
      );
    });

    if (!depsDone && task.depends.length > 0) {
      continue;
    }

    if (task.stage === "Queued") {
      // Start Coding stage
      const workerAgent = (await pickStageAgent("workers")) || (await pickStageAgent("orchestrator"));
      if (!workerAgent) continue;

      let sessionId: string | undefined;
      try {
        sessionId = await createHermesSession(workerAgent, `Task: ${task.title}`);
      } catch {
        // Fallback without session
      }

      const runResult = await startHermesRun(workerAgent, {
        prompt: `Execute the following task:\nTitle: ${task.title}\nRequirements: ${task.result || task.title}`,
        sessionId,
        idempotencyKey: `code-${task.id}-${task.retries}`,
      });

      if (runResult.kind === "started") {
        await supabase
          .from("mission_tasks")
          .update({
            stage: "Coding",
            agent_id: workerAgent.id,
            agent_name: workerAgent.name,
            model: workerAgent.model,
            updated_at: new Date().toISOString(),
          })
          .eq("id", task.id);
      }
    } else if (task.stage === "Coding") {
      // Check Coding result -> transition to QA check
      const qaAgent = await pickStageAgent("qa");
      if (qaAgent) {
        const qaRun = await startHermesRun(qaAgent, {
          prompt: `Verify the deliverables for task "${task.title}". End your response with VERDICT: PASS or VERDICT: FAIL.`,
          idempotencyKey: `qa-${task.id}-${task.retries}`,
        });

        if (qaRun.kind === "started") {
          const runStatus = await getHermesRun(qaAgent, qaRun.runId);
          if (runStatus.output) {
            const verdict = extractGateVerdict(runStatus.output, "PASS", "FAIL");
            await supabase.from("mission_artifacts").insert({
              id: crypto.randomUUID(),
              mission_id: detail.id,
              task_id: task.id,
              title: `QA Report: ${task.title}`,
              kind: "qa_report",
              content: runStatus.output,
            });

            if (verdict.verdict === "PASS") {
              await supabase
                .from("mission_tasks")
                .update({
                  stage: "QA check",
                  agent_id: qaAgent.id,
                  agent_name: qaAgent.name,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", task.id);
            } else {
              // Retry or Needs you
              if (task.retries < 2) {
                await supabase
                  .from("mission_tasks")
                  .update({
                    stage: "Queued",
                    retries: task.retries + 1,
                    updated_at: new Date().toISOString(),
                  })
                  .eq("id", task.id);
              } else {
                await supabase
                  .from("mission_tasks")
                  .update({
                    stage: "Needs you",
                    updated_at: new Date().toISOString(),
                  })
                  .eq("id", task.id);
              }
            }
          }
        }
      } else {
        // No QA agent -> advance directly to Final review or Done
        await supabase
          .from("mission_tasks")
          .update({ stage: "Final review", updated_at: new Date().toISOString() })
          .eq("id", task.id);
      }
    } else if (task.stage === "QA check") {
      // QA Check -> Final Review
      const reviewAgent = await pickStageAgent("reviewer");
      if (reviewAgent) {
        const reviewRun = await startHermesRun(reviewAgent, {
          prompt: `Review security, accessibility, and quality for task "${task.title}". End with VERDICT: APPROVED or VERDICT: CHANGES_REQUESTED.`,
          idempotencyKey: `review-${task.id}-${task.retries}`,
        });

        if (reviewRun.kind === "started") {
          const runStatus = await getHermesRun(reviewAgent, reviewRun.runId);
          if (runStatus.output) {
            const verdict = extractGateVerdict(runStatus.output, "APPROVED", "CHANGES_REQUESTED");
            await supabase.from("mission_artifacts").insert({
              id: crypto.randomUUID(),
              mission_id: detail.id,
              task_id: task.id,
              title: `Review Report: ${task.title}`,
              kind: "review_report",
              content: runStatus.output,
            });

            if (verdict.verdict === "APPROVED") {
              await supabase
                .from("mission_tasks")
                .update({ stage: "Done", updated_at: new Date().toISOString() })
                .eq("id", task.id);
            } else {
              if (task.retries < 2) {
                await supabase
                  .from("mission_tasks")
                  .update({
                    stage: "Queued",
                    retries: task.retries + 1,
                    updated_at: new Date().toISOString(),
                  })
                  .eq("id", task.id);
              } else {
                await supabase
                  .from("mission_tasks")
                  .update({
                    stage: "Needs you",
                    updated_at: new Date().toISOString(),
                  })
                  .eq("id", task.id);
              }
            }
          }
        }
      } else {
        await supabase
          .from("mission_tasks")
          .update({ stage: "Done", updated_at: new Date().toISOString() })
          .eq("id", task.id);
      }
    } else if (task.stage === "Final review") {
      await supabase
        .from("mission_tasks")
        .update({ stage: "Done", updated_at: new Date().toISOString() })
        .eq("id", task.id);
    }
  }

  return getMissionDetail(missionId);
}

export async function advanceActiveMissions(): Promise<AdvanceActiveMissionsResult> {
  const supabase = getSupabaseAdmin();
  const { data: missions, error } = await supabase
    .from("missions")
    .select("id")
    .in("status", ["running", "awaiting_plan_approval"]);

  if (error || !missions) {
    return {
      advancedCount: 0,
      errors: error ? [error.message] : [],
    };
  }

  let advancedCount = 0;
  const errors: string[] = [];

  for (const m of missions) {
    try {
      const mid = String((m as Record<string, unknown>).id);
      await advanceMission(mid);
      advancedCount++;
    } catch (err: unknown) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return { advancedCount, errors };
}
