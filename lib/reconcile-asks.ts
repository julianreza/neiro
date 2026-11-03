import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase";
import { readCountedPages } from "@/lib/counted-pages";
import { mapAgentRow } from "@/lib/orchestrator-store";
import { getRun } from "@/lib/agent-runtime";
import { recordAskResult } from "@/lib/ask-history";

/** Refresh answers even when their chat is closed. A failed lookup leaves it running. */
export async function reconcileAsks(): Promise<string[]> {
  const db = getSupabaseAdmin();
  const rows = await readCountedPages<{ id: string; agent_id: string | null }>((from, to) =>
    db.from("ask_questions").select("id,agent_id", { count: "exact" }).eq("status", "running").order("id").range(from, to),
  );
  if (!rows.length) return [];
  const agents = await readCountedPages<Record<string, unknown>>((from, to) =>
    db.from("agents").select("*", { count: "exact" }).order("id").range(from, to),
  );
  const byId = new Map(agents.map((row) => [String(row.id), mapAgentRow(row)]));
  const errors: string[] = [];
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(4, rows.length) }, async () => {
    while (index < rows.length) {
      const row = rows[index++];
      const agent = row.agent_id && byId.get(row.agent_id);
      if (!agent) { errors.push(`Chat ${row.id}: agent unavailable`); continue; }
      try { await recordAskResult(db, row.id, await getRun(agent, row.id)); }
      catch (error) { errors.push(`Chat ${row.id}: ${error instanceof Error ? error.message : String(error)}`); }
    }
  }));
  return errors;
}
