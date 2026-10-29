import "server-only";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getRequestSession } from "@/lib/auth";
import { sessionRoles } from "@/lib/session-roles";
import { UserConflictError } from "@/lib/users-store";
import { AppConfigError } from "@/lib/types";

/** Re-check credentials and current role even when the proxy is bypassed. */
export async function usersAdminSession(request: NextRequest) {
  const signed = await getRequestSession(request);
  const session = signed ? await sessionRoles().refresh(signed) : null;
  return session?.role === "admin" ? session : null;
}

/** Maps a users-API error to a JSON response with the right status. */
export function usersFailure(err: unknown, fallback: string) {
  if (err instanceof AppConfigError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: 503 });
  }
  if (err instanceof UserConflictError) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  const message = err instanceof Error ? err.message : fallback;
  if (/app_users/.test(message) && /does not exist|schema cache/i.test(message)) {
    return NextResponse.json(
      { error: "The app_users table is missing. Apply supabase/migrations/20261028000200_app_users.sql." },
      { status: 503 }
    );
  }
  return NextResponse.json({ error: message }, { status: 500 });
}
