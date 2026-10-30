import { NextResponse, connection } from "next/server";
import type { NextRequest } from "next/server";
import { callerFrom, createReviewApi, listReviewsApi } from "@/lib/reviews-api";
import { reviewsApiDeps } from "@/lib/reviews-api-deps";

/** List reviews. Query: source (manual|mission), status, missionId, limit. */
export async function GET(request: NextRequest) {
  await connection();
  const result = await listReviewsApi(request.nextUrl.searchParams, callerFrom(request.headers), reviewsApiDeps());
  return NextResponse.json(result.body, { status: result.status });
}

/** Start a manual review. Body: `{ url: "https://github.com/<owner>/<repo>/pull/<n>" }`. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const result = await createReviewApi(body, callerFrom(request.headers), reviewsApiDeps());
  return NextResponse.json(result.body, { status: result.status });
}
