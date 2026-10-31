import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { restartHermesGateway } from "@/lib/hermes-gateway";
import { HermesSkillError } from "@/lib/hermes-skills";
import { hermesCliFailure, localAgentEndpoint } from "@/lib/hermes-local-profile";
import { usersAdminSession } from "@/lib/users-api";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST {interrupt?: boolean} → restart the local Hermes gateway this agent uses.
 * Admin only. Refuses (409, `busy`) while a neiro agent is on a run or Hermes
 * reports live work, unless `interrupt` is true.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  if (!(await usersAdminSession(request))) {
    return NextResponse.json({ error: "Only an admin can restart Hermes." }, { status: 403 });
  }
  const { id } = await context.params;
  try {
    const body = (await request.json().catch(() => null)) as { interrupt?: unknown } | null;
    const interrupt = body?.interrupt === true;
    const endpoint = await localAgentEndpoint(id);

    if (!interrupt) {
      const { data } = await getSupabaseAdmin().from("agents").select("name").eq("active_run", true);
      const busy = (data ?? []).map((a: { name: string }) => a.name);
      if (busy.length) {
        return NextResponse.json(
          { error: `${busy.join(", ")} ${busy.length > 1 ? "are" : "is"} on a run. Restarting stops it.`, busy: true },
          { status: 409 },
        );
      }
    }

    let result;
    try {
      result = await restartHermesGateway({ ...endpoint, interrupt });
    } catch (err) {
      // Hermes itself refused because of live work it knows about.
      if (err instanceof HermesSkillError && err.status === 409) {
        return NextResponse.json({ error: err.message, busy: true }, { status: 409 });
      }
      throw err;
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return hermesCliFailure(err);
  }
}
