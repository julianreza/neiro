import { connection, NextResponse, type NextRequest } from "next/server";
import { localAgentProfile, hermesCliFailure } from "@/lib/hermes-local-profile";
import { readProfileContextFiles, writeProfileContextFile, type ProfileContextKind } from "@/lib/hermes-memory";
import { getSupabaseAdmin } from "@/lib/supabase";
import { usersAdminSession } from "@/lib/users-api";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  await connection();
  try {
    const { id } = await context.params;
    const profile = await localAgentProfile(id);
    return NextResponse.json({ profile, ...await readProfileContextFiles(profile) });
  } catch (error) { return hermesCliFailure(error); }
}

export async function POST(request: NextRequest, context: RouteContext) {
  if (!(await usersAdminSession(request))) return NextResponse.json({ error: "Only an admin can change profile context." }, { status: 403 });
  try {
    const { id } = await context.params;
    const profile = await localAgentProfile(id);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    let kind: ProfileContextKind;
    let content: string;
    if (body?.action === "sync_soul_from_prompt") {
      const { data, error } = await getSupabaseAdmin().from("agents").select("prompt").eq("id", id).maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return NextResponse.json({ error: "Agent not found." }, { status: 404 });
      kind = "soul";
      content = typeof data.prompt === "string" ? data.prompt : "";
    } else {
      if ((body?.kind !== "soul" && body?.kind !== "memory" && body?.kind !== "user") || typeof body?.content !== "string") return NextResponse.json({ error: "Choose soul, memory, or user and provide content." }, { status: 400 });
      kind = body.kind;
      content = body.content;
    }
    await writeProfileContextFile(profile, kind, content);
    return NextResponse.json({ ok: true, profile, ...await readProfileContextFiles(profile) });
  } catch (error) { return hermesCliFailure(error); }
}
