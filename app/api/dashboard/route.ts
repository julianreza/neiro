import { NextResponse } from "next/server";
import { connection } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildDashboard, TOKEN_DAYS } from "@/lib/dashboard";
import { cliRuntimeOfRunId } from "@/lib/cli-runtime";
import type { PipeTask } from "@/lib/dashboard";
import { AppConfigError } from "@/lib/types";
import type { MissionPhase, MissionStatus, TaskStage } from "@/lib/types";

const TASK_COLUMNS = "id, mission_id, title, stage, tokens, updated_at";
const RECENT_LIMIT = 300;
/** Supabase caps a select at 1000 rows by default. */
const TOKEN_LIMIT = 1000;
const ASK_COLUMNS = "id, tokens, created_at, finished_at, agent_id, agent_name";

/** Chat/Ask questions with tokens; model and runtime once their migration ran. */
async function askTokenRows(
  db: ReturnType<typeof getSupabaseAdmin>,
  since: string,
): Promise<{ data: Record<string, unknown>[] | null; error: { message: string } | null }> {
  const read = async (columns: string) => {
    const { data, error } = await db
      .from("ask_questions")
      .select(columns)
      .gte("created_at", since)
      .gt("tokens", 0)
      .order("created_at", { ascending: false })
      .limit(TOKEN_LIMIT);
    return { data: (data ?? null) as Record<string, unknown>[] | null, error: error ? { message: error.message } : null };
  };
  const full = await read(`${ASK_COLUMNS}, model, runtime`);
  // Before 20261030000300_ask_model.sql those two columns are missing.
  return full.error ? read(ASK_COLUMNS) : full;
}

function toTask(r: Record<string, unknown>): PipeTask {
  return {
    id: String(r.id),
    missionId: String(r.mission_id),
    title: String(r.title ?? ""),
    stage: r.stage as TaskStage,
    updatedAt: typeof r.updated_at === "string" ? r.updated_at : null,
    tokens: Number(r.tokens) || 0,
  };
}

/** The Dashboard: pipe, active missions, activity feed and recent tokens. */
export async function GET() {
  await connection();
  try {
    const db = getSupabaseAdmin();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    // A day longer than the chart, so the oldest local day is whole in any timezone.
    const tokenSince = new Date(Date.now() - (TOKEN_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString();
    const missionsRes = await db
      .from("missions")
      .select("id, title, status, phase")
      .in("status", ["running", "awaiting_plan_approval"])
      .order("updated_at", { ascending: false });
    if (missionsRes.error) return NextResponse.json({ error: missionsRes.error.message }, { status: 500 });

    const missions = (missionsRes.data ?? []).map((r) => ({
      id: String(r.id),
      title: String(r.title ?? ""),
      status: r.status as MissionStatus,
      phase: r.phase as MissionPhase,
    }));
    const openIds = missions.map((m) => m.id);

    const [openTasks, recentTasks, tokenRows, usageRows, askRows] = await Promise.all([
      openIds.length === 0
        ? Promise.resolve({ data: [], error: null })
        : db.from("mission_tasks").select(TASK_COLUMNS).in("mission_id", openIds),
      db
        .from("mission_tasks")
        .select(TASK_COLUMNS)
        .gte("updated_at", since)
        .order("updated_at", { ascending: false })
        .limit(RECENT_LIMIT),
      db
        .from("mission_tasks")
        .select("tokens, updated_at")
        .gte("updated_at", tokenSince)
        .gt("tokens", 0)
        .order("updated_at", { ascending: false })
        .limit(TOKEN_LIMIT),
      db
        .from("agent_token_usage")
        // "*" so the model column is read once its migration ran, and skipped before.
        .select("*")
        .gte("created_at", tokenSince)
        .order("created_at", { ascending: false })
        .limit(TOKEN_LIMIT),
      // Chat and Ask questions are runs too; their tokens live on the question.
      askTokenRows(db, tokenSince),
    ]);
    if (openTasks.error) return NextResponse.json({ error: openTasks.error.message }, { status: 500 });
    if (recentTasks.error) return NextResponse.json({ error: recentTasks.error.message }, { status: 500 });
    if (tokenRows.error) return NextResponse.json({ error: tokenRows.error.message }, { status: 500 });

    // A task can be both open and recent; count it once.
    const tasks = new Map<string, PipeTask>();
    for (const row of [...(openTasks.data ?? []), ...(recentTasks.data ?? [])]) {
      const task = toTask(row as Record<string, unknown>);
      tasks.set(task.id, task);
    }
    const tokenTasks = (tokenRows.data ?? []).map((r) => ({
      updatedAt: typeof r.updated_at === "string" ? r.updated_at : null,
      tokens: Number(r.tokens) || 0,
    }));
    // The usage table is newer than the rest; a missing table only blanks the donut.
    // Runs from before the model column, and chat questions, use the agent's current model.
    // Each run's own model/runtime, as recorded when it started. The agent may
    // have changed since, so its current settings are never used here.
    // Older rows have no model ("Not recorded"); their runtime is in the run id.
    const modelOf = (r: Record<string, unknown>) => (typeof r.model === "string" && r.model) || null;
    const runtimeOf = (r: Record<string, unknown>, runId: unknown) =>
      (typeof r.runtime === "string" && r.runtime) ||
      (typeof runId === "string" ? cliRuntimeOfRunId(runId) ?? "hermes" : null);

    const usage = (usageRows.data ?? []).map((r) => ({
      updatedAt: typeof r.created_at === "string" ? r.created_at : null,
      tokens: Number(r.tokens) || 0,
      agentId: typeof r.agent_id === "string" ? r.agent_id : null,
      agentName: typeof r.agent_name === "string" ? r.agent_name : "",
      model: modelOf(r),
      runtime: runtimeOf(r, r.run_id),
    }));
    if (askRows.error) console.warn("[dashboard] ask_questions tokens unavailable", askRows.error.message);
    const asks = (askRows.data ?? []).map((r) => ({
      updatedAt: typeof r.finished_at === "string" ? r.finished_at : typeof r.created_at === "string" ? r.created_at : null,
      tokens: Number(r.tokens) || 0,
      agentId: typeof r.agent_id === "string" ? r.agent_id : null,
      agentName: typeof r.agent_name === "string" ? r.agent_name : "",
      model: modelOf(r),
      runtime: runtimeOf(r, r.id),
    }));

    const snapshot = buildDashboard(
      missions,
      [...tasks.values()],
      Date.now(),
      [...tokenTasks, ...asks],
      [...usage, ...asks],
    );
    // Without the usage table the donut would show chat agents only; say why instead.
    if (usageRows.error) snapshot.agentTokensError = usageRows.error.message;
    return NextResponse.json(snapshot, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof AppConfigError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 503 });
    }
    const message = err instanceof Error ? err.message : "Failed to load the dashboard";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
