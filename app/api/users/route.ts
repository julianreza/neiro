import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isRole } from "@/lib/auth";
import { hashPassword, passwordProblem } from "@/lib/passwords";
import { createUser, listUsers, usernameProblem } from "@/lib/users-store";
import { usersAdminSession, usersFailure as failure } from "@/lib/users-api";

export async function GET(request: NextRequest) {
  if (!(await usersAdminSession(request))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    return NextResponse.json({ users: await listUsers() }, { status: 200 });
  } catch (err: unknown) {
    return failure(err, "Failed to list users");
  }
}

export async function POST(request: NextRequest) {
  if (!(await usersAdminSession(request))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json().catch(() => null);
  const username = typeof body?.username === "string" ? body.username.trim() : body?.username;
  const role = body?.role ?? "viewer";

  const problem = usernameProblem(username) ?? passwordProblem(body?.password);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  if (!isRole(role)) return NextResponse.json({ error: "Role must be admin or viewer." }, { status: 400 });

  try {
    const user = await createUser(username, await hashPassword(body.password), role);
    return NextResponse.json({ user }, { status: 201 });
  } catch (err: unknown) {
    return failure(err, "Failed to create user");
  }
}
