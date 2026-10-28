import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isRole } from "@/lib/auth";
import { hashPassword, passwordProblem } from "@/lib/passwords";
import { sessionRoles } from "@/lib/session-roles";
import { deleteUser, updateUser } from "@/lib/users-store";
import { usersFailure as failure } from "@/lib/users-api";

// Admin-only: proxy.ts refuses /api/users for any other role.

type RouteContext = {
  params: Promise<{ id: string }>;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Change a user's role and/or reset their password. */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const body = await request.json().catch(() => null);
  const changes: { role?: "admin" | "viewer"; passwordHash?: string } = {};
  if (body?.role !== undefined) {
    if (!isRole(body.role)) return NextResponse.json({ error: "Role must be admin or viewer." }, { status: 400 });
    changes.role = body.role;
  }
  if (body?.password !== undefined) {
    const problem = passwordProblem(body.password);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    changes.passwordHash = await hashPassword(body.password);
  }
  if (!changes.role && !changes.passwordHash) {
    return NextResponse.json({ error: "Nothing to change: send role and/or password." }, { status: 400 });
  }

  try {
    const user = await updateUser(id, changes);
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
    sessionRoles().forget(id);
    return NextResponse.json({ user }, { status: 200 });
  } catch (err: unknown) {
    return failure(err, "Failed to update user");
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "User not found" }, { status: 404 });
  if (request.headers.get("x-neiro-user") === id) {
    return NextResponse.json({ error: "You can't delete your own account." }, { status: 409 });
  }

  try {
    if (!(await deleteUser(id))) return NextResponse.json({ error: "User not found" }, { status: 404 });
    sessionRoles().forget(id);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: unknown) {
    return failure(err, "Failed to delete user");
  }
}
