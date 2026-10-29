import { NextResponse } from "next/server";
import { connection } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

/**
 * Stable link to one mission: `/missions/<id>` opens it in its project's
 * Mission control. Used by History, Needs you, Live log and notifications.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/missions/[id]">) {
  await connection();
  const { id } = await ctx.params;
  const fallback = new URL("/projects", request.url);
  try {
    const { data } = await getSupabaseAdmin()
      .from("missions")
      .select("project_id")
      .eq("id", id)
      .maybeSingle();
    const projectId = typeof data?.project_id === "string" ? data.project_id : null;
    if (!projectId) return NextResponse.redirect(fallback);
    const target = new URL(`/projects/${encodeURIComponent(projectId)}`, request.url);
    target.searchParams.set("mission", id);
    return NextResponse.redirect(target);
  } catch {
    return NextResponse.redirect(fallback);
  }
}
