import { NextResponse } from "next/server";
import { connection } from "next/server";
import type { NextRequest } from "next/server";
import { FolderError, listFolder } from "@/lib/folders";

/**
 * List the sub-folders of a folder inside the home folder.
 * POST (not GET) so only admins can browse the machine.
 */
export async function POST(request: NextRequest) {
  await connection();
  const body = (await request.json().catch(() => null)) as { path?: unknown } | null;
  try {
    const listing = await listFolder(typeof body?.path === "string" ? body.path : undefined);
    return NextResponse.json(listing);
  } catch (err: unknown) {
    if (err instanceof FolderError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not list folders" }, { status: 500 });
  }
}
