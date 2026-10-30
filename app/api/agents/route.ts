import { NextResponse } from "next/server";
import { connection } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { AppConfigError, isMissingRuntimeColumn, parseRuntimeFields, RUNTIME_MIGRATION_HINT } from "@/lib/types";
import { parseTokenBudget } from "@/lib/budget";
import type { Agent, AgentPublic } from "@/lib/types";

export async function GET() {
  await connection();

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("agents")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const agents: AgentPublic[] = (data || []).map((row: Agent) => {
      const rest = { ...row };
      delete rest.key_enc;
      return {
        ...rest,
        hasCustomKey: Boolean(row.key_enc || row.url),
      };
    });

    return NextResponse.json({ agents }, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof AppConfigError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 503 }
      );
    }
    const message = err instanceof Error ? err.message : "Failed to load agents";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      id,
      name,
      role,
      stage,
      specialty = "",
      model = "",
      profile = "default",
      prompt = "",
      url = "",
      key_enc = null,
      enabled = true,
    } = body || {};

    if (!name || typeof name !== "string") {
      return NextResponse.json({ error: "Missing required agent name" }, { status: 400 });
    }

    const agentId = (id && typeof id === "string" ? id : name.toLowerCase().replace(/[^a-z0-9_-]/g, "-")).slice(0, 64);

    const supabase = getSupabaseAdmin();

    // Check if duplicate id exists
    const { data: existing } = await supabase
      .from("agents")
      .select("id")
      .eq("id", agentId)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ error: `Agent with id '${agentId}' already exists` }, { status: 409 });
    }

    const newAgent = {
      id: agentId,
      name,
      role: role || name,
      stage: stage || "workers",
      specialty,
      model,
      profile,
      prompt,
      url,
      key_enc: key_enc || null,
      enabled: Boolean(enabled),
      active_run: false,
    };

    // Only sent when set, so a database without the budget migration still works.
    const budget = parseTokenBudget(body?.tokenBudget, "tokenBudget");
    if (!budget.ok) return NextResponse.json({ error: budget.error }, { status: 400 });
    const row: Record<string, unknown> = budget.value !== null ? { ...newAgent, token_budget: budget.value } : { ...newAgent };

    // Sent only when not the default, so a database without the runtime
    // migration still saves Hermes agents.
    const runtimeFields = parseRuntimeFields(body);
    if (!runtimeFields.ok) return NextResponse.json({ error: runtimeFields.error }, { status: 400 });
    if (runtimeFields.runtime && runtimeFields.runtime !== "hermes") row.runtime = runtimeFields.runtime;
    if (runtimeFields.effort) row.effort = runtimeFields.effort;

    const { data, error } = await supabase
      .from("agents")
      .insert(row)
      .select()
      .single();

    if (error) {
      const message = isMissingRuntimeColumn(error) ? RUNTIME_MIGRATION_HINT : error.message;
      return NextResponse.json({ error: message }, { status: 500 });
    }

    const publicAgent = { ...data };
    delete publicAgent.key_enc;
    return NextResponse.json({ agent: publicAgent }, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof AppConfigError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 503 }
      );
    }
    const message = err instanceof Error ? err.message : "Failed to create agent";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
