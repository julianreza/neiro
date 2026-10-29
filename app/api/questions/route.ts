import { NextResponse } from "next/server";
import { connection } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getHermesRun } from "@/lib/hermes";
import { mapAgentRow } from "@/lib/orchestrator-store";
import {
  ASK_TABLE,
  MISSING_ASK_TABLE,
  isMissingAskTable,
  mapAskRow,
  recordAskResult,
} from "@/lib/ask-history";
import type { AskQuestionDTO } from "@/lib/ask-history";
import { AppConfigError } from "@/lib/types";

const CURSOR = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2}))\|([A-Za-z0-9_-]{1,100})$/;
/** Running questions checked against Hermes per request, for tabs closed mid-answer. */
const MAX_REFRESH = 10;

/**
 * Questions asked in Ask mode, newest first.
 * `?q=text` (question search) `&limit=1-100` `&before=<nextBefore>` (next page).
 */
export async function GET(request: NextRequest) {
  await connection();

  try {
    const supabase = getSupabaseAdmin();
    const params = request.nextUrl.searchParams;

    const rawLimit = Number(params.get("limit"));
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 25;

    let query = supabase
      .from(ASK_TABLE)
      .select("*")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1);

    const q = (params.get("q") ?? "").trim().slice(0, 100);
    if (q) query = query.ilike("question", `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);

    const before = params.get("before");
    if (before) {
      const match = CURSOR.exec(before);
      if (!match || Number.isNaN(Date.parse(match[1]))) {
        return NextResponse.json({ error: "before must be a cursor from nextBefore" }, { status: 400 });
      }
      const [, timestamp, id] = match;
      query = query.or(`created_at.lt.${timestamp},and(created_at.eq.${timestamp},id.lt.${id})`);
    }

    const { data, error } = await query;
    if (error) {
      if (isMissingAskTable(error.message)) {
        return NextResponse.json({ error: MISSING_ASK_TABLE, code: "missing_table" }, { status: 503 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = (data ?? []).map((row: Record<string, unknown>) => mapAskRow(row));
    const page = rows.slice(0, limit);
    await refreshRunning(supabase, page);

    const last = page[page.length - 1];
    return NextResponse.json({
      questions: page,
      nextBefore: rows.length > limit && last ? `${last.createdAt}|${last.id}` : null,
    });
  } catch (err: unknown) {
    if (err instanceof AppConfigError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 503 });
    }
    const message = err instanceof Error ? err.message : "Could not load questions";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** A question whose tab was closed is still "running" here: ask Hermes and save the result. */
async function refreshRunning(supabase: ReturnType<typeof getSupabaseAdmin>, page: AskQuestionDTO[]) {
  const running = page.filter((item) => item.status === "running" && item.agentId).slice(0, MAX_REFRESH);
  if (running.length === 0) return;

  const agentIds = [...new Set(running.map((item) => item.agentId as string))];
  const { data: agentRows, error } = await supabase.from("agents").select("*").in("id", agentIds);
  if (error || !agentRows) return;
  const agents = new Map(agentRows.map((row: Record<string, unknown>) => [String(row.id), mapAgentRow(row)]));

  await Promise.all(
    running.map(async (item) => {
      const agent = agents.get(item.agentId as string);
      if (!agent) return;
      try {
        const run = await getHermesRun(agent, item.id);
        const update = await recordAskResult(supabase, item.id, run);
        if (update) {
          Object.assign(item, {
            status: update.status,
            answer: update.answer,
            tokens: update.tokens,
            error: update.error,
            finishedAt: update.finished_at,
          });
        } else if (run.output) {
          item.answer = run.output;
        }
      } catch (err: unknown) {
        console.warn("[questions] refresh failed", item.id, err);
      }
    }),
  );
}
