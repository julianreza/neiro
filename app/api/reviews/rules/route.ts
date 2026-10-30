import { NextResponse, connection } from "next/server";
import type { NextRequest } from "next/server";
import { callerFrom } from "@/lib/reviews-api";
import { getReviewRules, saveReviewRules } from "@/lib/review-rules-store";

/** The review rules in use (saved or default), plus the default text. */
export async function GET(request: NextRequest) {
  await connection();
  if (!callerFrom(request.headers)) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  try {
    return NextResponse.json({ rules: await getReviewRules() });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

/** Save the rules. Body: `{ text: string }`, or `{ text: null }` to go back to the default. Admin only. */
export async function PATCH(request: NextRequest) {
  const caller = callerFrom(request.headers);
  if (!caller) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (caller.role !== "admin") return NextResponse.json({ error: "Your role can't do this. Ask an admin." }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
  if (!body || !("text" in body)) return NextResponse.json({ error: "Send { text }." }, { status: 400 });
  try {
    const result = await saveReviewRules(body.text, caller.sub);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ rules: result.rules });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
