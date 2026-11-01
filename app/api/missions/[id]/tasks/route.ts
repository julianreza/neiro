import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { parseTaskPlanEdit, validateTaskPlan } from "@/lib/task-plan";
import { usersAdminSession } from "@/lib/users-api";

type Context = { params: Promise<{ id: string }> };
const VALID_ID = /^[A-Za-z0-9_.:-]{1,120}$/;

async function edit(request: NextRequest, context: Context, action: "create" | "update" | "delete") {
  if (!(await usersAdminSession(request))) return NextResponse.json({ error: "Only an admin can edit task plans." }, { status: 403 });
  const { id } = await context.params;
  if (!VALID_ID.test(id)) return NextResponse.json({ error: "Invalid mission id." }, { status: 400 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const taskId = action === "create" ? crypto.randomUUID() : typeof body?.taskId === "string" ? body.taskId : "";
  if (!VALID_ID.test(taskId)) return NextResponse.json({ error: "Invalid task id." }, { status: 400 });
  const input = action === "delete" ? null : parseTaskPlanEdit(body, action === "create");
  if (action !== "delete" && !input) return NextResponse.json({ error: "Invalid task fields." }, { status: 400 });
  try {
    const db = getSupabaseAdmin();
    const { data: rows, error: readError } = await db.from("mission_tasks").select("id,task_key,depends").eq("mission_id", id);
    if (readError) throw new Error(readError.message);
    const tasks = (rows ?? []).map((row) => ({ id: String(row.id), taskKey: typeof row.task_key === "string" ? row.task_key : null, depends: Array.isArray(row.depends) ? row.depends.filter((dep: unknown): dep is string => typeof dep === "string") : [] }));
    if (action !== "create" && !tasks.some((task) => task.id === taskId)) return NextResponse.json({ error: "Task not found." }, { status: 404 });
    const next = tasks.filter((task) => action !== "delete" || task.id !== taskId).map((task) => action === "update" && task.id === taskId ? { ...task, depends: input!.depends } : task);
    if (action === "create" && input) next.push({ id: taskId, taskKey: input.task_key ?? null, depends: input.depends });
    const invalid = validateTaskPlan(next);
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
    const { error } = await db.rpc("neiro_edit_task_plan", { p_mission_id: id, p_action: action, p_task_id: taskId, p_payload: input });
    if (error) {
      if (error.code === "PGRST202" || error.code === "42883") return NextResponse.json({ error: "Apply the Neiro v2 SQL migration first." }, { status: 503 });
      if (error.code === "23505") return NextResponse.json({ error: "That task key already exists." }, { status: 409 });
      return NextResponse.json({ error: error.message }, { status: error.code === "P0001" ? 409 : 500 });
    }
    return NextResponse.json({ ok: true, taskId });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not edit task plan." }, { status: 500 });
  }
}

export const POST = (request: NextRequest, context: Context) => edit(request, context, "create");
export const PATCH = (request: NextRequest, context: Context) => edit(request, context, "update");
export const DELETE = (request: NextRequest, context: Context) => edit(request, context, "delete");
