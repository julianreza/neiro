import "server-only";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { resolveAgentEndpoint } from "@/lib/hermes";
import { HermesSkillError, checkProfile } from "@/lib/hermes-skills";
import { AppConfigError, asRuntime } from "@/lib/types";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * The agent's Hermes profile, for the skill/MCP/plugin/toolset routes. Refuses a
 * non-Hermes agent and a Hermes on another computer, since the CLI changes only
 * the Hermes on this one.
 */
export async function localAgentProfile(id: string): Promise<string> {
  return (await localAgentEndpoint(id)).profile;
}

/** Same checks, plus the Hermes URL and key the agent uses. */
export async function localAgentEndpoint(id: string): Promise<{ profile: string; baseUrl: string; apiKey: string }> {
  const { data: agent, error } = await getSupabaseAdmin()
    .from("agents")
    .select("profile, url, key_enc, runtime")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new HermesSkillError(error.message);
  if (!agent) throw new HermesSkillError("Agent not found", 404);
  if (asRuntime(agent.runtime) !== "hermes") {
    throw new HermesSkillError("This is only for Hermes agents.", 409);
  }
  const { baseUrl, apiKey } = resolveAgentEndpoint({ profile: agent.profile, url: agent.url, key_enc: agent.key_enc });
  let host = "";
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    /* unparsable URL is treated as remote */
  }
  if (!LOCAL_HOSTS.has(host)) {
    throw new HermesSkillError("This agent's Hermes runs on another computer. Change it there.", 409);
  }
  return { profile: checkProfile(agent.profile || "default"), baseUrl, apiKey };
}

export function hermesCliFailure(err: unknown) {
  if (err instanceof AppConfigError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: 503 });
  }
  if (err instanceof HermesSkillError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  return NextResponse.json({ error: err instanceof Error ? err.message : "Request failed" }, { status: 500 });
}
