import { NextResponse } from "next/server";
import { connection } from "next/server";
import { listHermesModelOptions } from "@/lib/hermes";
import { AppConfigError } from "@/lib/types";
import { getSupabaseAdmin } from "@/lib/supabase";

/** Models for the agent form, sourced from Hermes (which routes to 9Router). */
export async function GET(request: Request) {
  await connection();

  try {
    const params = new URL(request.url).searchParams;
    const id = params.get("agentId");
    let agent: { url: string; profile: string; key_enc?: string | null } | undefined;
    if (id) {
      const { data, error } = await getSupabaseAdmin().from("agents")
        .select("url, profile, key_enc").eq("id", id).maybeSingle();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (!data) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
      agent = data;
    }
    const profile = params.get("profile");
    if (profile !== null) agent = { url: agent?.url ?? "", key_enc: agent?.key_enc, profile };
    const options = await listHermesModelOptions(agent);
    return NextResponse.json(options, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof AppConfigError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 503 },
      );
    }
    const message =
      err instanceof Error ? err.message : "Failed to fetch Hermes models";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
