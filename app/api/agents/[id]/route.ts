import { encryptAgentKey } from "@/lib/crypto-keys";
import { NextResponse } from "next/server";
import { connection } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  AppConfigError,
  HERMES_SUITE_MIGRATION_HINT,
  isMissingRuntimeColumn,
  parseHermesModelFields,
  parseRuntimeFields,
  RUNTIME_MIGRATION_HINT,
} from "@/lib/types";
import { parseTokenBudget } from "@/lib/budget";
import type { Agent } from "@/lib/types";
import { agentActivity } from "@/lib/agent-activity";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  await connection();
  const { id } = await context.params;

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("agents")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      const message = /reasoning_effort|service_tier/.test(error.message) ? HERMES_SUITE_MIGRATION_HINT : error.message;
      return NextResponse.json({ error: message }, { status: /reasoning_effort|service_tier/.test(error.message) ? 409 : 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    const publicAgent = { ...data, active_run: (await agentActivity(supabase)).has(id) };
    delete publicAgent.key_enc;
    return NextResponse.json({ agent: publicAgent }, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof AppConfigError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 503 }
      );
    }
    const message = err instanceof Error ? err.message : "Failed to load agent";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const body = await request.json();
    if ("activeRun" in body || "active_run" in body) return NextResponse.json({ error: "Agent activity is read-only." }, { status: 400 });
    const supabase = getSupabaseAdmin();

    const allowedFields: Array<keyof Agent> = [
      "name",
      "role",
      "stage",
      "specialty",
      "model",
      "profile",
      "prompt",
      "url",
      "key_enc",
      "enabled",
      "tokenBudget",
    ];

    const updates: Record<string, unknown> = {};
    for (const key of allowedFields) {
      if (key in body) {
        if (key === "key_enc") {
          if (body[key] !== null && typeof body[key] !== "string") return NextResponse.json({ error: "Agent key must be a string." }, { status: 400 });
          updates.key_enc = body[key] ? await encryptAgentKey(body[key]) : null;
        } else if (key === "tokenBudget") {
          const budget = parseTokenBudget(body[key], "tokenBudget");
          if (!budget.ok) return NextResponse.json({ error: budget.error }, { status: 400 });
          updates.token_budget = budget.value;
        } else {
          updates[key] = body[key];
        }
      }
    }

    const runtimeFields = parseRuntimeFields(body);
    if (!runtimeFields.ok) return NextResponse.json({ error: runtimeFields.error }, { status: 400 });
    if (runtimeFields.runtime !== undefined) updates.runtime = runtimeFields.runtime;
    if (runtimeFields.effort !== undefined) updates.effort = runtimeFields.effort;
    const modelFields = parseHermesModelFields(body);
    if (!modelFields.ok) return NextResponse.json({ error: modelFields.error }, { status: 400 });
    if (modelFields.reasoning_effort !== undefined) updates.reasoning_effort = modelFields.reasoning_effort;
    if (modelFields.service_tier !== undefined) updates.service_tier = modelFields.service_tier;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields provided for update" }, { status: 400 });
    }

    updates.updated_at = new Date().toISOString();

    const save = (fields: Record<string, unknown>) =>
      supabase.from("agents").update(fields).eq("id", id).select().maybeSingle();
    let { data, error } = await save(updates);

    // No runtime migration yet: a Hermes agent with no effort loses nothing
    // by saving without those columns.
    if (isMissingRuntimeColumn(error)) {
      if ((updates.runtime ?? "hermes") !== "hermes" || updates.effort) {
        return NextResponse.json({ error: RUNTIME_MIGRATION_HINT }, { status: 409 });
      }
      const rest = { ...updates };
      delete rest.runtime;
      delete rest.effort;
      ({ data, error } = await save(rest));
    }

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    const publicAgent = { ...data };
    delete publicAgent.key_enc;
    return NextResponse.json({ agent: publicAgent }, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof AppConfigError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 503 }
      );
    }
    const message = err instanceof Error ? err.message : "Failed to update agent";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const supabase = getSupabaseAdmin();

    const { data: agentData, error: agentError } = await supabase
      .from("agents")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (agentError) throw new Error(agentError.message);
    if (!agentData) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    if ((await agentActivity(supabase)).has(id)) {
      return NextResponse.json(
        { error: "Agent has active runs; stop them first" },
        { status: 409 }
      );
    }

    const { error } = await supabase
      .from("agents")
      .delete()
      .eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof AppConfigError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 503 }
      );
    }
    const message = err instanceof Error ? err.message : "Failed to delete agent";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
