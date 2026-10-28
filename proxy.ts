import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getRequestSession, roleAllows } from "./lib/auth";
import { sessionRoles } from "./lib/session-roles";

/** Request headers the proxy sets for route handlers; never trusted from clients. */
export const SESSION_HEADERS = { sub: "x-neiro-user", role: "x-neiro-role" } as const;

/**
 * Static SVGs served from `public/` that must load on the login page.
 * Listed explicitly: a blanket `*.svg` exemption would let any future route
 * reachable through a `.svg`-suffixed path skip the auth gate.
 */
export const PUBLIC_SVGS: ReadonlySet<string> = new Set([
  "/file.svg",
  "/globe.svg",
  "/next.svg",
  "/vercel.svg",
  "/window.svg",
]);

/** Paths reachable without a session. */
export function isExemptPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname === "/api/auth" ||
    pathname.startsWith("/api/auth/") ||
    PUBLIC_SVGS.has(pathname)
  );
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow login page, auth API endpoints and public static SVGs without session
  if (isExemptPath(pathname)) {
    const headers = new Headers(request.headers);
    headers.delete(SESSION_HEADERS.sub);
    headers.delete(SESSION_HEADERS.role);
    return NextResponse.next({ request: { headers } });
  }

  const signed = await getRequestSession(request);
  const session = signed ? await sessionRoles().refresh(signed) : null;
  if (session) {
    if (pathname.startsWith("/api/") && !roleAllows(session.role, request.method, pathname)) {
      return NextResponse.json(
        { error: "Your role can't do this. Ask an admin." },
        { status: 403 }
      );
    }
    const headers = new Headers(request.headers);
    headers.set(SESSION_HEADERS.sub, session.sub);
    headers.set(SESSION_HEADERS.role, session.role);
    return NextResponse.next({ request: { headers } });
  }

  // Unauthenticated API requests receive 401 JSON
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Unauthenticated page requests redirect to /login?next=...
  const loginUrl = new URL("/login", request.url);
  const nextTarget = `${pathname}${request.nextUrl.search}`;
  if (nextTarget !== "/" && nextTarget !== "") {
    loginUrl.searchParams.set("next", nextTarget);
  }

  return NextResponse.redirect(loginUrl, 307);
}

export default proxy;
