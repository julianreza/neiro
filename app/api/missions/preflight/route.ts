import { NextResponse } from "next/server";
import { parseMissionCreateBody } from "@/lib/mission-input";
import { resolveProjectDefaults } from "@/lib/project-defaults-server";
import { missionPreflight } from "@/lib/mission-preflight";
import { triageMission } from "@/lib/system-one-gate";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (body?.action === "triage") {
      if (typeof body.prompt !== "string" || !body.prompt.trim() || body.prompt.length > 8000) return NextResponse.json({ error: "A mission prompt of up to 8000 characters is required." }, { status: 400 });
      return NextResponse.json({ suggestion: await triageMission(body.prompt) });
    }
    const parsed = parseMissionCreateBody(await resolveProjectDefaults(body));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    return NextResponse.json(await missionPreflight(parsed.value));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not check readiness" }, { status: 503 });
  }
}
