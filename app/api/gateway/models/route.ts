import { NextResponse } from "next/server";
import { connection } from "next/server";
import type { NextRequest } from "next/server";
import { listNineRouterModelsByKind } from "@/lib/ninerouter";
import { AppConfigError } from "@/lib/types";

export async function GET(request: NextRequest) {
  await connection();

  try {
    const { searchParams } = new URL(request.url);
    const kind = searchParams.get("kind") || undefined;

    const models = await listNineRouterModelsByKind(kind);
    return NextResponse.json({ models }, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof AppConfigError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 503 }
      );
    }
    const message = err instanceof Error ? err.message : "Failed to fetch models";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
