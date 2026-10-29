import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { NextResponse } from "next/server";
import { connection } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { startHermesRun } from "@/lib/hermes";
import { mapAgentRow } from "@/lib/orchestrator-store";
import { recordAskStart } from "@/lib/ask-history";
import { AppConfigError } from "@/lib/types";

const MAX_QUESTION = 20000;
const MAX_PATH = 500;

/** Rules added to the answering agent's own prompt for an answer-only run. */
const ASK_RULES = [
  "You are answering one question. This is not a mission: do not plan tasks or delegate.",
  "Read only the files you need to answer.",
  "Do not create, edit, move, or delete files, and do not run commands that change anything.",
  "Reply in the language of the question. Start with the direct answer, then at most 5 short points.",
  'End with one line that starts with "Files read:" followed by the paths you opened, comma separated.',
].join("\n");

/** Default project folder for the composer: the folder Neiro runs from. */
export async function GET() {
  await connection();
  return NextResponse.json({ workspace: process.cwd() });
}

/**
 * Ask a question about a project. Starts one Hermes run on the Q&A agent
 * (or the orchestrator when no Q&A agent is on) and returns its id; poll
 * GET /api/ask/<runId> for the answer.
 */
export async function POST(request: NextRequest) {
  await connection();

  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const question = typeof body?.question === "string" ? body.question.trim() : "";
    if (!question) {
      return NextResponse.json({ error: "Write a question first." }, { status: 400 });
    }
    if (question.length > MAX_QUESTION) {
      return NextResponse.json({ error: `A question can be at most ${MAX_QUESTION} characters.` }, { status: 400 });
    }

    const workspace = typeof body?.workspace_path === "string" ? body.workspace_path.trim() : "";
    if (!workspace) {
      return NextResponse.json({ error: "Pick the project folder to ask about." }, { status: 400 });
    }
    if (workspace.length > MAX_PATH || !isAbsolute(workspace)) {
      return NextResponse.json({ error: "The project folder must be a full path, like /Users/you/project." }, { status: 400 });
    }
    const info = await stat(workspace).catch(() => null);
    if (!info?.isDirectory()) {
      return NextResponse.json({ error: `Folder not found: ${workspace}` }, { status: 400 });
    }

    const sessionId =
      typeof body?.session_id === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(body.session_id)
        ? body.session_id
        : undefined;

    const supabase = getSupabaseAdmin();
    // The Q&A agent answers; the orchestrator stands in when none is on.
    const { data: rows, error } = await supabase
      .from("agents")
      .select("*")
      .in("stage", ["ask", "orchestrator"])
      .eq("enabled", true)
      .order("created_at", { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const data = rows?.find((row) => row.stage === "ask") ?? rows?.[0];
    if (!data) {
      return NextResponse.json(
        { error: "No Q&A agent or orchestrator is turned on. Turn one on in AI team first." },
        { status: 409 },
      );
    }
    const agent = mapAgentRow(data);

    const started = await startHermesRun(agent, {
      prompt: `Question: ${question}\n\nWorkspace: ${workspace}`,
      instructions: [agent.prompt, ASK_RULES].filter(Boolean).join("\n\n"),
      sessionId,
    });
    if (started.kind === "deferred") {
      return NextResponse.json({ error: "Hermes is busy. Try again in a minute." }, { status: 503 });
    }

    // Saved so the answer shows in History, even after a page refresh.
    await recordAskStart(supabase, {
      id: started.runId,
      agentId: agent.id,
      agentName: agent.name,
      question,
      workspacePath: workspace,
      followUpOf: sessionId,
    });

    return NextResponse.json(
      { runId: started.runId, agentId: agent.id, agentName: agent.name },
      { status: 201 },
    );
  } catch (err: unknown) {
    if (err instanceof AppConfigError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 503 });
    }
    const message = err instanceof Error ? err.message : "Could not start the question";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
