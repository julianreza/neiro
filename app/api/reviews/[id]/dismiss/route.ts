import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { callerFrom, dismissFindingApi } from "@/lib/reviews-api";
import { reviewsApiDeps } from "@/lib/reviews-api-deps";

type RouteContext = { params: Promise<{ id: string }> };

/** Dismiss or restore one finding. Body: `{ findingId: string, dismissed: boolean }`. */
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const result = await dismissFindingApi(id, body, callerFrom(request.headers), reviewsApiDeps());
  return NextResponse.json(result.body, { status: result.status });
}
