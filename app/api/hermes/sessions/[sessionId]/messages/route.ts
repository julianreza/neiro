import { NextResponse } from "next/server";
import { connection } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getHermesSessionMessages } from "@/lib/hermes";
import { AppConfigError } from "@/lib/types";
import type { Agent } from "@/lib/types";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  await connection();
  const { sessionId } = await context.params;

  try {
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get("agentId");

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

      agent = {
        id: data.id,
        name: data.name,
        role: data.role,
        stage: data.stage,
        specialty: data.specialty || "",
        model: data.model || "",
        profile: data.profile || "default",
        prompt: data.prompt || "",
        url: data.url || "",
        key_enc: data.key_enc,
        enabled: data.enabled,
        activeRun: data.active_run ?? false,
      };
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

    const messages = await getHermesSessionMessages(agent, sessionId);
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
