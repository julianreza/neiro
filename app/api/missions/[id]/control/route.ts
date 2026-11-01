import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { advanceMission, reportAdvanceError } from "@/lib/orchestrator";
import { mapArtifactRow, mapMissionRow } from "@/lib/orchestrator-store";
import { AppConfigError } from "@/lib/types";
import { discardMissionWorktree, missionWorktreeHead, planWorktreeDiscard } from "@/lib/worktree";
import { mergeMissionPr, parsePrUrl } from "@/lib/github-pr";
import { usersAdminSession } from "@/lib/users-api";
import { formatPrdNotes, parsePrdNotes, prdNotesKey, prdVersions } from "@/lib/prd";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const body = await request.json();
    const action = body?.action;

    if (!action || !["approve_plan", "revise_prd", "cancel", "resume", "discard_worktree", "merge_pr"].includes(action)) {
      return NextResponse.json(
        { error: "Invalid mission control action." },
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

    if (action === "revise_prd") {
      return revisePrd(id, body?.notes, body?.version);
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

    if (action === "merge_pr") {
      if (!(await usersAdminSession(request))) return NextResponse.json({ error: "Only an admin can merge a mission PR." }, { status: 403 });
      const method = body?.method ?? "squash";
      if (method !== "squash" && method !== "merge" && method !== "rebase") return NextResponse.json({ error: "Invalid merge method." }, { status: 400 });
      const { data: row, error: readError } = await supabase.from("missions").select("id,status,pr_url,work_branch,worktree_path,repo_root,pr_merged_at").eq("id", id).maybeSingle();
      if (readError) return NextResponse.json({ error: /pr_merged_at/i.test(readError.message) ? "Apply the Neiro v2 SQL migration before merging." : readError.message }, { status: 500 });
      if (!row) return NextResponse.json({ error: "Mission not found." }, { status: 404 });
      const ref = parsePrUrl(row.pr_url);
      if (row.pr_merged_at) return NextResponse.json({ error: "This mission PR is already marked as merged." }, { status: 409 });
      if (row.status !== "completed" || !ref || !row.repo_root || !row.worktree_path || !row.work_branch) return NextResponse.json({ error: "A completed mission with a PR and isolated worktree is required." }, { status: 409 });
      let head: string;
      try { head = await missionWorktreeHead(row.repo_root, row.worktree_path, row.work_branch); }
      catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Worktree is not ready." }, { status: 409 }); }
      try { await mergeMissionPr(ref, row.work_branch, method, head); }
      catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Merge failed. Check GitHub before retrying." }, { status: 502 }); }
      const warnings: string[] = [];
      const { error: saveError } = await supabase.from("missions").update({ pr_merged_at: new Date().toISOString() }).eq("id", id);
      if (saveError) warnings.push("The PR merged, but the merge date could not be saved. Apply the v2 SQL migration.");
      try {
        if (await missionWorktreeHead(row.repo_root, row.worktree_path, row.work_branch) !== head) throw new Error("The worktree changed after merging.");
        await discardMissionWorktree({ repoRoot: row.repo_root, worktreePath: row.worktree_path, branch: row.work_branch });
        const { error: cleanupError } = await supabase.from("missions").update({ work_branch: null, worktree_path: null, agent_workspace_path: null }).eq("id", id);
        if (cleanupError) warnings.push("The worktree was removed but its database record could not be updated.");
      } catch (error) { warnings.push(`The PR merged, but worktree cleanup was skipped: ${error instanceof Error ? error.message : "unknown error"}`); }
      return NextResponse.json({ ok: true, merged: true, warnings });
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
      const plan = planWorktreeDiscard({
        status: row.status as string | null,
        work_branch: row.work_branch as string | null,
        worktree_path: row.worktree_path as string | null,
        repo_root: row.repo_root as string | null,
      });
      if (!plan.ok) {
        return NextResponse.json({ error: plan.error }, { status: plan.status });
      }

      await discardMissionWorktree({
        repoRoot: plan.repoRoot,
        worktreePath: plan.worktreePath,
        branch: plan.branch,
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

/**
 * Send review notes on the latest PRD back to Scribe. Saves the notes as a
 * `prd_notes` artifact, then moves the paused mission back to the spec phase;
 * the spec run writes the next PRD version and the mission pauses again.
 */
async function revisePrd(id: string, rawNotes: unknown, reviewedVersion: unknown) {
  const parsed = parsePrdNotes(rawNotes);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data: mission, error: missionErr } = await supabase
    .from("missions")
    .select("id, status")
    .eq("id", id)
    .maybeSingle();
  if (missionErr) return NextResponse.json({ error: missionErr.message }, { status: 500 });
  if (!mission) return NextResponse.json({ error: "Mission not found" }, { status: 404 });
  if (mission.status !== "awaiting_plan_approval") {
    return NextResponse.json({ error: "Only a PRD waiting for your review can be revised." }, { status: 409 });
  }

  const { data: scribe, error: agentErr } = await supabase
    .from("agents")
    .select("id")
    .eq("stage", "spec")
    .eq("enabled", true)
    .limit(1);
  if (agentErr) return NextResponse.json({ error: agentErr.message }, { status: 500 });
  if (!scribe?.length) {
    return NextResponse.json(
      { error: "No PRD writer is on. Turn on Scribe PRD on Agents, then try again." },
      { status: 409 },
    );
  }

  const { data: rows, error: artErr } = await supabase
    .from("mission_artifacts")
    .select("*")
    .eq("mission_id", id)
    .eq("kind", "prd");
  if (artErr) return NextResponse.json({ error: artErr.message }, { status: 500 });
  const latest = prdVersions((rows ?? []).map((r) => mapArtifactRow(r as Record<string, unknown>)), id).at(-1);
  if (!latest) return NextResponse.json({ error: "This mission has no PRD yet." }, { status: 409 });
  if (reviewedVersion !== undefined && reviewedVersion !== latest.version) {
    return NextResponse.json(
      { error: `Your notes are on v${String(reviewedVersion)}, but v${latest.version} is the latest. Reload and review it.` },
      { status: 409 },
    );
  }

  // The unique dedupe key makes a double submit for one version a conflict.
  const notesId = crypto.randomUUID();
  const { error: notesErr } = await supabase.from("mission_artifacts").insert({
    id: notesId,
    mission_id: id,
    title: `PRD v${latest.version} review notes`,
    kind: "prd_notes",
    content: formatPrdNotes(parsed.notes),
    dedupe_key: prdNotesKey(id, latest.version),
  });
  if (notesErr) {
    if (notesErr.code === "23505") {
      return NextResponse.json({ error: "This PRD version is already being revised." }, { status: 409 });
    }
    return NextResponse.json({ error: notesErr.message }, { status: 500 });
  }

  const { data, error } = await supabase
    .from("missions")
    .update({
      status: "running",
      phase: "spec",
      run_id: null,
      run_agent_id: null,
      run_started_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "awaiting_plan_approval")
    .select()
    .maybeSingle();
  if (error || !data) {
    await supabase.from("mission_artifacts").delete().eq("id", notesId);
    return error
      ? NextResponse.json({ error: error.message }, { status: 500 })
      : NextResponse.json({ error: "Mission is not awaiting plan approval" }, { status: 409 });
  }

  try {
    await advanceMission(id);
  } catch (err: unknown) {
    await reportAdvanceError(id, err);
  }

  return NextResponse.json(
    { ok: true, version: latest.version + 1, mission: mapMissionRow(data as Record<string, unknown>) },
    { status: 200 },
  );
}
