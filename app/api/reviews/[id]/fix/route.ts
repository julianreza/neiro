import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { callerFrom, fixFindingsApi } from "@/lib/reviews-api";
import { reviewsApiDeps } from "@/lib/reviews-api-deps";

type RouteContext = { params: Promise<{ id: string }> };

/** Fix with agent. Body: `{ findingIds: string[] }`. Starts a Fix mission; admin only. */
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const result = await fixFindingsApi(id, body, callerFrom(request.headers), reviewsApiDeps());
  return NextResponse.json(result.body, { status: result.status });
}
