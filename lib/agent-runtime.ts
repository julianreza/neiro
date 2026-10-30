import { randomUUID } from "node:crypto";
import {
  createHermesSession,
  getHermesRun,
  openHermesRunEventStream,
  startHermesRun,
  stopHermesRun,
  submitHermesRunApproval,
  submitHermesRunClarify,
  type HermesRunStatus,
  type HermesStartRunInput,
  type HermesStartRunResult,
} from "@/lib/hermes";
import {
  answerCliApproval,
  cliRuntimeOfRunId,
  getCliRun,
  openCliEventStream,
  startCliRun,
  stopCliRun,
  type CliRuntime,
} from "@/lib/cli-runtime";
import { asRuntime, type Agent } from "@/lib/types";

/**
 * One door for every agent run. Hermes agents go to the Hermes server; the
 * Oh My Pi agents run as a local CLI (lib/cli-runtime.ts).
 * Callers pass the agent and never care which one it is.
 */

export type RunStartInput = HermesStartRunInput & {
  /** Folder the run works in. Hermes takes it from its profile; a CLI needs it here. */
  cwd?: string;
  /** Oh My Pi: "ask" pauses for Allow / Deny (default); "deny" refuses writes at once. */
  approvals?: "ask" | "deny";
};

function cliOf(agent: Pick<Agent, "runtime">): CliRuntime | null {
  const runtime = asRuntime(agent.runtime);
  return runtime === "hermes" ? null : runtime;
}

/*
 * A CLI run id names its runtime (omp_…), so a run started before the
 * agent switched runtime is still read from the right place.
 */

export async function startRun(agent: Agent, input: RunStartInput): Promise<HermesStartRunResult> {
  const cli = cliOf(agent);
  // Hermes reads only the fields it knows, so the extra cwd is harmless.
  if (!cli) return startHermesRun(agent, input);
  return startCliRun(cli, {
    prompt: input.prompt,
    instructions: input.instructions || agent.prompt || "",
    model: input.model || agent.model,
    effort: agent.effort,
    sessionId: input.sessionId,
    cwd: input.cwd,
    idempotencyKey: input.idempotencyKey,
    approvals: input.approvals,
  });
}

export async function getRun(agent: Agent, runId: string): Promise<HermesRunStatus> {
  return cliRuntimeOfRunId(runId) ? getCliRun(runId) : getHermesRun(agent, runId);
}

export async function stopRun(agent: Agent, runId: string): Promise<boolean> {
  return cliRuntimeOfRunId(runId) ? stopCliRun(runId) : stopHermesRun(agent, runId);
}

/** A CLI session is just a key: the first run in it creates the real one. */
export async function createSession(agent: Agent, title: string): Promise<string> {
  return cliOf(agent) ? `cli-${randomUUID()}` : createHermesSession(agent, title);
}

export async function openRunEventStream(
  agent: Agent,
  runId: string,
  signal?: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  return cliRuntimeOfRunId(runId) ? openCliEventStream(runId, signal) : openHermesRunEventStream(agent, runId, signal);
}

/** An Oh My Pi run waits for the answer; Hermes gets it over its API. */
export async function submitRunApproval(
  agent: Agent,
  runId: string,
  approved: boolean,
  details?: { requestId?: string; executionGeneration?: number },
): Promise<boolean> {
  return cliRuntimeOfRunId(runId)
    ? answerCliApproval(runId, approved, details?.requestId)
    : submitHermesRunApproval(agent, runId, approved, details);
}

export async function submitRunClarify(
  agent: Agent,
  runId: string,
  reply: string,
  details?: { requestId?: string; executionGeneration?: number },
): Promise<boolean> {
  return cliRuntimeOfRunId(runId) ? false : submitHermesRunClarify(agent, runId, reply, details);
}
