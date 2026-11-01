import { connection, NextResponse, type NextRequest } from "next/server";
import { callerFrom } from "@/lib/reviews-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { WORKTREE_REVIEW_PREFIX } from "@/lib/worktree-reviews";

/** Recent task-worktree reports link to their original mission artifacts. */
export async function GET(request: NextRequest) {
  await connection();
  if (!callerFrom(request.headers)) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  try {
    const { data, error } = await getSupabaseAdmin().from("mission_artifacts")
      .select("id,mission_id,title,created_at")
      .eq("kind", "review_report").like("title", `${WORKTREE_REVIEW_PREFIX}%`)
      .order("created_at", { ascending: false }).limit(100);
    if (error) throw new Error(error.message);
    return NextResponse.json({ reports: (data ?? []).map((row) => ({
      id: String(row.id), missionId: String(row.mission_id), title: String(row.title).slice(WORKTREE_REVIEW_PREFIX.length), createdAt: String(row.created_at),
    })) });
  } catch {
    return NextResponse.json({ error: "Could not load task-worktree reviews." }, { status: 500 });
  }
}
