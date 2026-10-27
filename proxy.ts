import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isAuthorizedRequest } from "./lib/auth";

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
    return NextResponse.next();
  }

  const authorized = await isAuthorizedRequest(request);
  if (authorized) {
    return NextResponse.next();
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
