import { NextResponse } from "next/server";
import { connection } from "next/server";
import type { NextRequest } from "next/server";
import { loadRunSteps } from "@/lib/run-steps-store";

/** Saved steps of finished runs: GET /api/run-steps?ids=run_a,run_b */
export async function GET(request: NextRequest) {
  await connection();
  const ids = (request.nextUrl.searchParams.get("ids") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (ids.length === 0) return NextResponse.json({ steps: {} });
  try {
    return NextResponse.json({ steps: await loadRunSteps(ids) });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not read steps" }, { status: 500 });
  }
}
