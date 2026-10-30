import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { callerFrom, rerunReviewApi } from "@/lib/reviews-api";
import { reviewsApiDeps } from "@/lib/reviews-api-deps";

type RouteContext = { params: Promise<{ id: string }> };

/** Review again: a new review of the same PR; the old one is kept. */
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const result = await rerunReviewApi(id, callerFrom(request.headers), reviewsApiDeps());
  return NextResponse.json(result.body, { status: result.status });
}
