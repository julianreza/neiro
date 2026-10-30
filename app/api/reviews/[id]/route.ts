import { NextResponse, connection } from "next/server";
import type { NextRequest } from "next/server";
import { callerFrom, getReviewApi } from "@/lib/reviews-api";
import { reviewsApiDeps } from "@/lib/reviews-api-deps";

type RouteContext = { params: Promise<{ id: string }> };

/** One review with its findings and the reviewer's raw answer. */
export async function GET(request: NextRequest, context: RouteContext) {
  await connection();
  const { id } = await context.params;
  const result = await getReviewApi(id, callerFrom(request.headers), reviewsApiDeps());
  return NextResponse.json(result.body, { status: result.status });
}
