import { NextResponse } from "next/server";
import { connection } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { PROJECTS_TABLE } from "@/lib/projects";
import { AppConfigError } from "@/lib/types";

type RouteContext = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Remove a project from the list. The folder on disk is not touched, and its
 * missions and chats stay (their project link is cleared by the foreign key).
 * Admin only (enforced in proxy.ts).
 */
export async function DELETE(_request: NextRequest, context: RouteContext) {
  await connection();
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid project id" }, { status: 400 });

  try {
    const { error } = await getSupabaseAdmin().from(PROJECTS_TABLE).delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    if (err instanceof AppConfigError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 503 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not delete the project" }, { status: 500 });
  }
}
