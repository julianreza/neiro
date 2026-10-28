import { NextResponse } from "next/server";
import { connection } from "next/server";
import type { NextRequest } from "next/server";
import { cloneRepo, FolderError } from "@/lib/folders";

/** Clone a git repo into a folder inside the home folder. Admin only (POST). */
export async function POST(request: NextRequest) {
  await connection();
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const url = typeof body?.url === "string" ? body.url : "";
  const parent = typeof body?.parent === "string" ? body.parent : "";
  const name = typeof body?.name === "string" ? body.name : undefined;
  if (!url || !parent) {
    return NextResponse.json({ error: "A repo URL and a folder to put it in are required." }, { status: 400 });
  }
  try {
    const cloned = await cloneRepo({ url, parent, name });
    return NextResponse.json(cloned, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof FolderError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: err instanceof Error ? err.message : "Clone failed" }, { status: 500 });
  }
}
