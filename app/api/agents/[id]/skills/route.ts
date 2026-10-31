import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  installSkill,
  listSkills,
  searchSkills,
  setSkillEnabled,
  uninstallSkill,
} from "@/lib/hermes-skills";
import { hermesCliFailure, localAgentProfile } from "@/lib/hermes-local-profile";
import { usersAdminSession } from "@/lib/users-api";

type RouteContext = { params: Promise<{ id: string }> };

/** GET → installed skills of the agent's profile; GET ?q=… → registry search. */
export async function GET(request: NextRequest, context: RouteContext) {
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
