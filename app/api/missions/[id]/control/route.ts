import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { advanceMission, reportAdvanceError } from "@/lib/orchestrator";
import { mapMissionRow } from "@/lib/orchestrator-store";
import { AppConfigError } from "@/lib/types";
import { discardMissionWorktree } from "@/lib/worktree";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const body = await request.json();
    const action = body?.action;

    if (!action || !["approve_plan", "cancel", "resume", "discard_worktree"].includes(action)) {
      return NextResponse.json(
        { error: "Invalid action. Expected 'approve_plan', 'cancel', 'resume' or 'discard_worktree'" },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    if (action === "cancel") {
      const { data, error } = await supabase
        .from("missions")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .maybeSingle();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json({ ok: true, mission: data }, { status: 200 });
    }

    if (action === "approve_plan") {
      // Guarded: only a mission actually waiting for approval can be released.
      const { data, error } = await supabase
        .from("missions")
        .update({ status: "running", updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("status", "awaiting_plan_approval")
        .select()
        .maybeSingle();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      if (!data) {
        return NextResponse.json(
          { error: "Mission is not awaiting plan approval" },
          { status: 409 },
        );
      }

      try {
        await advanceMission(id);
      } catch (err: unknown) {
        await reportAdvanceError(id, err);
      }

      return NextResponse.json(
        { ok: true, mission: data ? mapMissionRow(data as Record<string, unknown>) : null },
        { status: 200 },
      );
    }

    if (action === "resume") {
      const { data, error } = await supabase
        .from("missions")
        .update({ status: "running", updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .maybeSingle();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      try {
        await advanceMission(id);
      } catch (err: unknown) {
        await reportAdvanceError(id, err);
      }

      return NextResponse.json(
        { ok: true, mission: data ? mapMissionRow(data as Record<string, unknown>) : null },
        { status: 200 },
      );
    }

    if (action === "discard_worktree") {
      // Rollback: drop the mission branch and worktree. Only once the mission
      // has stopped, so no agent is still writing into it.
      const { data: row, error } = await supabase
        .from("missions")
        .select("id, status, work_branch, worktree_path, repo_root")
        .eq("id", id)
        .maybeSingle();
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      if (!row) {
        return NextResponse.json({ error: "Mission not found" }, { status: 404 });
      }
      if (!row.work_branch || !row.worktree_path || !row.repo_root) {
        return NextResponse.json({ error: "Mission has no worktree to discard" }, { status: 409 });
      }
      if (!["cancelled", "completed"].includes(String(row.status))) {
        return NextResponse.json(
          { error: "Cancel the mission before discarding its worktree" },
          { status: 409 },
        );
      }

      await discardMissionWorktree({
        repoRoot: String(row.repo_root),
        worktreePath: String(row.worktree_path),
        branch: String(row.work_branch),
      });

      const { data, error: updateErr } = await supabase
        .from("missions")
        .update({
          work_branch: null,
          worktree_path: null,
          agent_workspace_path: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select()
        .maybeSingle();
      if (updateErr) {
        return NextResponse.json({ error: updateErr.message }, { status: 500 });
      }
      return NextResponse.json(
        { ok: true, mission: data ? mapMissionRow(data as Record<string, unknown>) : null },
        { status: 200 },
      );
    }

    return NextResponse.json({ error: "Unhandled action" }, { status: 400 });
  } catch (err: unknown) {
    if (err instanceof AppConfigError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 503 }
      );
    }
    const message = err instanceof Error ? err.message : "Failed to execute mission control action";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
