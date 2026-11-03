import { connection, NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  installSkill,
  listSkills,
  searchSkills,
  saveLearnedSkillFile,
  setSkillEnabled,
  uninstallSkill,
} from "@/lib/hermes-skills";
import { hermesCliFailure, localAgentProfile } from "@/lib/hermes-local-profile";
import { usersAdminSession } from "@/lib/users-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { extractSkillBlock } from "@/lib/orchestrator-parsers";
import { createHash, randomUUID } from "node:crypto";

type RouteContext = { params: Promise<{ id: string }> };

/** GET → installed skills of the agent's profile; GET ?q=… → registry search. */
export async function GET(request: NextRequest, context: RouteContext) {
  await connection();
  const { id } = await context.params;
  try {
    const profile = await localAgentProfile(id);
    const q = request.nextUrl.searchParams.get("q");
    if (q !== null) {
      return NextResponse.json({ profile, results: await searchSkills(q) });
    }
    return NextResponse.json({ profile, skills: await listSkills(profile) });
  } catch (err) {
    return hermesCliFailure(err);
  }
}

/** POST {action: "install", identifier} | {action: "uninstall", name} | {action: "toggle", name, enabled}. Admin only. */
export async function POST(request: NextRequest, context: RouteContext) {
  if (!(await usersAdminSession(request))) {
    return NextResponse.json({ error: "Only an admin can change skills." }, { status: 403 });
  }
  const { id } = await context.params;
  try {
    const profile = await localAgentProfile(id);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    switch (body?.action) {
      case "install_artifact": {
        if (typeof body.missionId !== "string" || typeof body.artifactId !== "string") return NextResponse.json({ error: "Mission and artifact are required." }, { status: 400 });
        const db = getSupabaseAdmin();
        const { data: artifact, error } = await db.from("mission_artifacts").select("id, mission_id, kind, content").eq("id", body.artifactId).eq("mission_id", body.missionId).maybeSingle();
        if (error) throw error;
        if (!artifact || artifact.kind !== "learned_skill" || typeof artifact.content !== "string") return NextResponse.json({ error: "Learned skill artifact not found." }, { status: 404 });
        const skill = extractSkillBlock(`\`\`\`skill\n${artifact.content}\n\`\`\``);
        if (!skill) return NextResponse.json({ error: "Invalid skill frontmatter or content." }, { status: 400 });
        let failure: unknown = null;
        try { await saveLearnedSkillFile(profile, skill.name, artifact.content); } catch (err) { failure = err; }
        const result = { sourceArtifactId: artifact.id, agentId: id, profile, checksum: createHash("sha256").update(artifact.content).digest("hex"), at: new Date().toISOString(), status: failure ? "failed" : "installed", ...(failure ? { error: failure instanceof Error ? failure.message : "Installation failed" } : {}) };
        let recordFailed = false;
        try {
          const record = await db.from("mission_artifacts").insert({ id: randomUUID(), mission_id: body.missionId, title: `Skill installation: ${skill.name}`, kind: "skill_installation", content: JSON.stringify(result) });
          recordFailed = Boolean(record.error);
        } catch { recordFailed = true; }
        if (failure) return hermesCliFailure(failure);
        return NextResponse.json({ ok: true, profile, ...(recordFailed ? { warning: "Skill installed, but the installation record could not be saved." } : {}) });
      }
      case "save_local": {
        if (typeof body.name !== "string" || typeof body.content !== "string") return NextResponse.json({ error: "Skill name and content are required." }, { status: 400 });
        await saveLearnedSkillFile(profile, body.name, body.content);
        return NextResponse.json({ ok: true, profile });
      }
      case "install":
        await installSkill(profile, body.identifier);
        break;
      case "uninstall":
        await uninstallSkill(profile, body.name);
        break;
      case "toggle":
        await setSkillEnabled(profile, body.name, body.enabled === true);
        break;
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
    return NextResponse.json({ ok: true, profile, skills: await listSkills(profile) });
  } catch (err) {
    return hermesCliFailure(err);
  }
}
