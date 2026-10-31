import { NextResponse } from "next/server";
import { parseMissionCreateBody } from "@/lib/mission-input";
import { resolveProjectDefaults } from "@/lib/project-defaults-server";
import { missionPreflight } from "@/lib/mission-preflight";

export async function POST(request: Request) {
  try {
    const parsed = parseMissionCreateBody(await resolveProjectDefaults(await request.json().catch(() => null)));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    return NextResponse.json(await missionPreflight(parsed.value));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not check readiness" }, { status: 503 });
  }
}
