import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  OWNER_SESSION,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  getRequestSession,
  signSessionToken,
  timingSafeEqualString,
} from "@/lib/auth";
import type { Session } from "@/lib/auth";
import { clientAddress, limiterKeys, loginLimiter } from "@/lib/login-limiter";
import { hashPassword, verifyPassword } from "@/lib/passwords";
import { sessionRoles } from "@/lib/session-roles";
import { findUserForLogin, usernameProblem } from "@/lib/users-store";
import { AppConfigError } from "@/lib/types";

let dummy: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  dummy ??= hashPassword(crypto.randomUUID());
  return dummy;
}

/**
 * Sign in. `{ passcode }` checks DASHBOARD_SECRET and signs in as the owner
 * (admin). `{ username, password }` checks an app_users account. Both share
 * one failure counter per client IP. Accounts also use an IP/username pair;
 * passcode attempts share a global counter regardless of source IP.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.DASHBOARD_SECRET;
  if (!secret || secret.length < 8) {
    return NextResponse.json(
      { error: "DASHBOARD_SECRET not configured or too short (minimum 8 characters)" },
      { status: 503 }
    );
  }

  const body = await request.json().catch(() => null);
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const validUsername = usernameProblem(username) === null;
  const password = typeof body?.password === "string" ? body.password : "";
  const passcode = typeof body?.passcode === "string" ? body.passcode : "";

  const limiter = loginLimiter();
  const address = clientAddress(request.headers);
  // An invalid account name counts against the IP only: it must not seed a
  // user key, nor touch the shared passcode lock that guards owner sign-in.
  const keys = username && !validUsername ? [`ip:${address}`] : limiterKeys(address, username || null);
  const gate = limiter.check(keys);
  if (!gate.ok) {
    const minutes = Math.ceil(gate.retryAfterSec / 60);
    return NextResponse.json(
      { error: `Too many failed sign-ins. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSec) } }
    );
  }

  let session: Session | null = null;
  try {
    if (username) {
      if (validUsername && password) {
        const found = await findUserForLogin(username);
        // Hash even for unknown names so timing doesn't reveal which exist.
        const ok = await verifyPassword(password, found?.passwordHash ?? (await dummyHash()));
        if (found && ok) {
          session = { sub: found.user.id, role: found.user.role };
          sessionRoles().forget(found.user.id);
        }
      }
    } else if (passcode && timingSafeEqualString(passcode, secret)) {
      session = OWNER_SESSION;
    }
  } catch (err: unknown) {
    console.error("[auth]", { event: "login_error", error: err });
    if (err instanceof AppConfigError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 503 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  if (!session) {
    limiter.recordFailure(keys);
    return NextResponse.json(
      { error: username ? "Invalid username or password" : "Invalid passcode" },
      { status: 401 }
    );
  }

  limiter.recordSuccess(keys);
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const response = NextResponse.json({ ok: true, role: session.role }, { status: 200 });
  response.cookies.set(SESSION_COOKIE, await signSessionToken(secret, expiresAt, session), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return response;
}

/** Who am I: `{ user, role }`, or 401. */
export async function GET(request: NextRequest) {
  const signed = await getRequestSession(request);
  const session = signed ? await sessionRoles().refresh(signed) : null;
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ user: session.sub, role: session.role }, { status: 200 });
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
