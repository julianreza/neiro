import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isAuthorizedRequest } from "./lib/auth";

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.svg$).*)"],
};

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow login page and auth API endpoints without session
  if (pathname === "/login" || pathname.startsWith("/api/auth")) {
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
