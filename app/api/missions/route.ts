import { NextResponse } from "next/server";
import { connection } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { advanceMission, reportAdvanceError } from "@/lib/orchestrator";
import { mapMissionRow } from "@/lib/orchestrator-store";
import { parseMissionCreateBody } from "@/lib/mission-input";
import { prepareMissionWorkspace } from "@/lib/worktree";
import { AppConfigError } from "@/lib/types";
import type { MissionSummaryDTO } from "@/lib/types";

const HISTORY_STATUSES = new Set(["running", "awaiting_plan_approval", "completed", "cancelled"]);

/**
 * Missions, newest first. Optional history filters:
 * `?status=completed,cancelled` `&q=text` (title search) `&limit=1-200`
 * `&before=<created_at ISO>` (next page). No params = every mission, as before.
 */
export async function GET(request: NextRequest) {
  await connection();

  try {
    const supabase = getSupabaseAdmin();
    const params = request.nextUrl.searchParams;

    let query = supabase.from("missions").select("*").order("created_at", { ascending: false });

    const statuses = (params.get("status") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (statuses.some((s) => !HISTORY_STATUSES.has(s))) {
      return NextResponse.json({ error: `status must be among: ${[...HISTORY_STATUSES].join(", ")}` }, { status: 400 });
    }
    if (statuses.length > 0) query = query.in("status", statuses);

    const q = (params.get("q") ?? "").trim().slice(0, 100);
    if (q) query = query.ilike("title", `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);

    const before = params.get("before");
    if (before) {
      if (Number.isNaN(Date.parse(before))) {
        return NextResponse.json({ error: "before must be an ISO timestamp" }, { status: 400 });
      }
      query = query.lt("created_at", before);
    }

    const rawLimit = Number(params.get("limit"));
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : null;
    if (limit !== null) query = query.limit(limit);

    const { data: missions, error: missionsErr } = await query;

    if (missionsErr) {
      return NextResponse.json({ error: missionsErr.message }, { status: 500 });
    }

    const missionIds = (missions || []).map((m: Record<string, unknown>) => String(m.id));
    const { data: tasks, error: tasksErr } =
      missionIds.length === 0
        ? { data: [], error: null }
        : missionIds.length > 200
          ? // Too many ids for one URL: read all task stats, as before filters existed.
            await supabase.from("mission_tasks").select("mission_id, stage, tokens")
          : await supabase.from("mission_tasks").select("mission_id, stage, tokens").in("mission_id", missionIds);

    if (tasksErr) {
      return NextResponse.json({ error: tasksErr.message }, { status: 500 });
    }

    const statsByMission = new Map<
      string,
      { totalTasks: number; completedTasks: number; totalTokens: number }
    >();

    for (const task of tasks || []) {
      const current = statsByMission.get(task.mission_id) || {
        totalTasks: 0,
        completedTasks: 0,
        totalTokens: 0,
      };
      current.totalTasks += 1;
      if (task.stage === "Done") {
        current.completedTasks += 1;
      }
      current.totalTokens += Number(task.tokens) || 0;
      statsByMission.set(task.mission_id, current);
    }

    const summaries: MissionSummaryDTO[] = (missions || []).map((row: Record<string, unknown>) => {
      const m = mapMissionRow(row);
      const stats = statsByMission.get(m.id) || {
        totalTasks: 0,
        completedTasks: 0,
        totalTokens: 0,
      };
      return {
        ...m,
        totalTasks: stats.totalTasks,
        completedTasks: stats.completedTasks,
        totalTokens: stats.totalTokens,
      };
    });

    return NextResponse.json(
      {
        missions: summaries,
        // Cursor for the next history page, when a page limit was asked for.
        nextBefore:
          limit !== null && summaries.length === limit ? summaries[summaries.length - 1].createdAt ?? null : null,
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    if (err instanceof AppConfigError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 503 }
      );
    }
    const message = err instanceof Error ? err.message : "Failed to load missions";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const parsed = parseMissionCreateBody(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const input = parsed.value;

    const missionId = `mission-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    // Resolve the workspace before the mission exists, so a bad path or
    // branch is a 400 the user sees now, not a mission that fails later.
    let workspaceColumns: Record<string, string | null> = {};
    if (input.workspacePath) {
      try {
        const ws = await prepareMissionWorkspace({
          workspacePath: input.workspacePath,
          missionId,
          baseBranch: input.baseBranch,
          isolate: input.isolateWorkspace,
        });
        workspaceColumns =
          ws.kind === "worktree"
            ? {
                agent_workspace_path: ws.path,
                base_branch: ws.baseRef,
                work_branch: ws.branch,
                worktree_path: ws.worktreePath,
                repo_root: ws.repoRoot,
              }
            : { agent_workspace_path: ws.path };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Could not prepare the workspace";
        return NextResponse.json({ error: message }, { status: 400 });
      }
    }

    const supabase = getSupabaseAdmin();

    const { data: newMission, error: createErr } = await supabase
      .from("missions")
      .insert({
        id: missionId,
        title: input.title,
        prompt: input.prompt,
        // Always starts running; pause_after_planning stops it after the
        // spec phase (status -> awaiting_plan_approval).
        status: "running",
        phase: "planning",
        pause_after_planning: input.pauseAfterPlanning,
        max_parallel_workers: input.maxParallelWorkers,
        max_retries: input.maxRetries,
        workspace_path: input.workspacePath,
        // Only sent when set, so a database without the budget migration
        // still accepts missions that don't use it.
        ...(input.tokenBudget !== null ? { token_budget: input.tokenBudget } : {}),
        ...workspaceColumns,
      })
      .select()
      .single();

    if (createErr) {
      const hint = /agent_workspace_path|work_branch|worktree_path|repo_root|base_branch|token_budget/.test(createErr.message)
        ? " Run the Supabase migrations (bun run db:push) first."
        : "";
      return NextResponse.json({ error: createErr.message + hint }, { status: 500 });
    }

    // Start planning eagerly; on failure the next tick retries.
    try {
      await advanceMission(missionId);
    } catch (err: unknown) {
      await reportAdvanceError(missionId, err);
    }

    return NextResponse.json(
      { mission: mapMissionRow(newMission as Record<string, unknown>) },
      { status: 201 },
    );
  } catch (err: unknown) {
    if (err instanceof AppConfigError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 503 }
      );
    }
    const message = err instanceof Error ? err.message : "Failed to create mission";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
