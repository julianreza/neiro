import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  signSessionToken,
  timingSafeEqualString,
} from "@/lib/auth";

export async function POST(request: NextRequest) {
  const secret = process.env.DASHBOARD_SECRET;
  if (!secret || secret.length < 8) {
    return NextResponse.json(
      { error: "DASHBOARD_SECRET not configured or too short (minimum 8 characters)" },
      { status: 503 }
    );
  }

  try {
    const body = await request.json().catch(() => null);
    const passcode = typeof body?.passcode === "string" ? body.passcode : "";

    if (!passcode || !timingSafeEqualString(passcode, secret)) {
      return NextResponse.json({ error: "Invalid passcode" }, { status: 401 });
    }

    const expiresAt = Date.now() + SESSION_TTL_MS;
    const sessionToken = await signSessionToken(secret, expiresAt);

    const response = NextResponse.json({ ok: true }, { status: 200 });

    response.cookies.set(SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    });

    return response;
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true }, { status: 200 });

  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  return response;
}
