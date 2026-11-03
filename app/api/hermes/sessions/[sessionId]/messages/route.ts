import { NextResponse } from "next/server";
import { connection } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getHermesSessionMessages } from "@/lib/hermes";
import { AppConfigError } from "@/lib/types";
import type { Agent } from "@/lib/types";
import { mapAgentRow } from "@/lib/orchestrator-store";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  await connection();
  const { sessionId } = await context.params;

  try {
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get("agentId");
    const compacted = searchParams.get("include_compacted");
    const inline = searchParams.get("inline_images");
    if ((compacted !== null && compacted !== "true" && compacted !== "false") || (inline !== null && inline !== "true" && inline !== "false")) {
      return NextResponse.json({ error: "Invalid transcript options." }, { status: 400 });
    }

    let agent: Agent;

    if (agentId) {
      const supabase = getSupabaseAdmin();
      const { data, error } = await supabase
        .from("agents")
        .select("*")
        .eq("id", agentId)
        .maybeSingle();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      if (!data) {
        return NextResponse.json({ error: "Agent not found" }, { status: 404 });
      }

      agent = mapAgentRow(data);
    } else {
      agent = {
        id: "default",
        name: "Default Hermes",
        role: "worker",
        stage: "workers",
        specialty: "",
        model: "",
        profile: "default",
        prompt: "",
        url: process.env.HERMES_DEFAULT_URL || "",
        enabled: true,
        activeRun: false,
      };
    }

    const messages = await getHermesSessionMessages(agent, sessionId, { includeCompacted: compacted === "true", inlineImages: inline === "true" });
    return NextResponse.json({ messages }, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof AppConfigError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 503 }
      );
    }
    const message = err instanceof Error ? err.message : "Failed to load session messages";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
