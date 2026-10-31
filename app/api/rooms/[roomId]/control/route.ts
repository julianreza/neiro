import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { advanceMission, reportAdvanceError } from "@/lib/orchestrator";
import { roomDeps } from "@/lib/rooms-runtime";
import { roomError, validRoomId } from "@/lib/rooms-route";

type RouteContext = { params: Promise<{ roomId: string }> };

const TO_MISSION_MESSAGES = 200;
const TO_MISSION_CHARS = 20000;

/**
 * POST { action: "stop" }       : end the rounds and stop the bot speaking now.
 * POST { action: "resume" }     : clear Needs you and go on from where it paused.
 * POST { action: "to_mission" } : a new mission whose brief is the room's transcript.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const { roomId } = await context.params;
  if (!validRoomId(roomId)) return NextResponse.json({ error: "Invalid room id" }, { status: 400 });
  try {
    const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
    const action = body?.action;
    const deps = roomDeps();
    const room = await deps.store.getRoom(roomId);
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

    if (action === "stop") {
      const claim = room.driver?.claim;
      const won = await deps.store.updateRoomIf(roomId, room.updatedAt, { driver: null, needsYou: false });
      if (!won) return NextResponse.json({ error: "The room changed. Try again." }, { status: 409 });
      if (claim && !claim.runId.startsWith("claim:")) {
        const agent = (await deps.agents()).find((a) => a.id === claim.agentId);
        if (agent) await deps.stopRun(agent, claim.runId).catch(() => false);
      }
      return NextResponse.json({ ok: true });
    }

    if (action === "resume") {
      const won = await deps.store.updateRoomIf(roomId, room.updatedAt, { needsYou: false });
      if (!won) return NextResponse.json({ error: "The room changed. Try again." }, { status: 409 });
      return NextResponse.json({ ok: true, running: Boolean(room.driver) });
    }

    if (action === "to_mission") {
      const messages = (await deps.store.listMessages(roomId, TO_MISSION_MESSAGES)).filter((m) => m.senderKind !== "system");
      if (messages.length === 0) return NextResponse.json({ error: "The room has no discussion yet." }, { status: 400 });
      let transcript = messages.map((m) => `${m.senderName}: ${m.content}`).join("\n\n");
      if (transcript.length > TO_MISSION_CHARS) transcript = `…${transcript.slice(-TO_MISSION_CHARS)}`;
      const missionId = `mission-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const { error } = await getSupabaseAdmin()
        .from("missions")
        .insert({
          id: missionId,
          title: `${room.name}: agreed plan`.slice(0, 200),
          prompt: `Carry out what this group discussion agreed on.\n\nDiscussion from "${room.name}":\n\n${transcript}`,
          status: "running",
          phase: "planning",
          // A discussion is a plan, not a spec: the operator reviews it first.
          pause_after_planning: true,
          max_parallel_workers: 3,
          max_retries: 2,
          workspace_path: null,
        });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      try {
        await advanceMission(missionId);
      } catch (err: unknown) {
        await reportAdvanceError(missionId, err);
      }
      return NextResponse.json({ ok: true, missionId }, { status: 201 });
    }

    return NextResponse.json({ error: "action must be stop, resume or to_mission" }, { status: 400 });
  } catch (err: unknown) {
    return roomError(err);
  }
}
