import { NextResponse } from "next/server";
import { connection } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { openRunEventStream } from "@/lib/agent-runtime";
import { createStepCollector } from "@/lib/run-steps";
import { recordRunActivity, saveRunSteps } from "@/lib/run-steps-store";
import { AppConfigError } from "@/lib/types";
import type { Agent, SubagentRun } from "@/lib/types";
import type { LogStep } from "@/lib/run-events";

/**
 * The sub-agents a task's run delegated to, kept on its mission_tasks row so
 * the inspector shows them after the stream is gone. Best effort.
 */
async function saveSubagentRuns(runId: string, steps: LogStep[]) {
  const byId = new Map<string, SubagentRun>();
  for (const step of steps) if (step.subagent) byId.set(step.subagent.delegationId, step.subagent);
  if (byId.size === 0) return;
  const { error } = await getSupabaseAdmin()
    .from("mission_tasks")
    .update({ subagent_runs: [...byId.values()] })
    .eq("run_id", runId);
  // Before 20261031000000_hermes_full_suite.sql the column is missing: skip.
  if (error && error.code !== "42703" && error.code !== "PGRST204") {
    console.warn("[run-steps] could not save sub-agents", runId, error.message);
  }
}

type RouteContext = {
  params: Promise<{ runId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  await connection();
  const { runId } = await context.params;

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

    const stream = await openRunEventStream(agent, runId, request.signal);

    // Pass every byte through untouched, and read the steps on the side. When
    // the run's stream ends on its own (not when the viewer leaves), keep them
    // so the chat can show the work after a reload.
    let lastWrite = 0;
    const collector = createStepCollector((event) => {
      const now = Date.now();
      if (!event.terminal && now - lastWrite < 15_000) return;
      lastWrite = now;
      void recordRunActivity(runId, event).catch((error: unknown) => console.warn("[run-activity]", error));
    });
    const decoder = new TextDecoder();
    const tee = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(chunk);
        try {
          collector.feed(decoder.decode(chunk, { stream: true }));
        } catch {
          // A frame we can't read must never break the live view.
        }
      },
      async flush() {
        try {
          collector.feed(decoder.decode());
          collector.end();
          const steps = collector.steps();
          await saveRunSteps(runId, steps);
          await saveSubagentRuns(runId, steps);
        } catch (err: unknown) {
          console.warn("[run-steps] could not save steps", runId, err);
        }
      },
    });

    return new Response(stream.pipeThrough(tee), {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (err: unknown) {
    if (err instanceof AppConfigError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 503 }
      );
    }
    const message = err instanceof Error ? err.message : "Failed to open event stream";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
