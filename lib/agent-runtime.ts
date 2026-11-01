import { randomUUID } from "node:crypto";
import {
  createHermesSession,
  forkHermesSession,
  getHermesDetailedInventory,
  getHermesServerCapabilities,
  getHermesRun,
  resolveHermesUnknownRun,
  sendHermesSessionChat,
  openHermesRunEventStream,
  startHermesRun,
  stopHermesRun,
  steerHermesRun,
  submitHermesRunApproval,
  submitHermesRunClarify,
  type HermesControlDetails,
  type HermesDetailedInventory,
  type HermesRunStatus,
  type HermesServerCapabilities,
  type HermesSessionChatInput,
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
import { asRuntime, UnsupportedRuntimeError } from "@/lib/types";
import type { Agent, ApprovalChoice, PendingControl } from "@/lib/types";
import { normalizePendingControls } from "@/lib/approvals";

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

/** Route by run id so a runtime changed after launch cannot misroute steering. */
export async function steerRun(agent: Agent, runId: string, text: string) {
  if (cliRuntimeOfRunId(runId)) throw new UnsupportedRuntimeError();
  return steerHermesRun(agent, runId, text);
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

/**
 * An Oh My Pi run waits for the answer; Hermes gets it over its API.
 * `true` = once, `false` = deny. Oh My Pi has only Allow / Deny, so once,
 * session and always all allow.
 */
export async function submitRunApproval(
  agent: Agent,
  runId: string,
  choice: ApprovalChoice | boolean,
  details?: HermesControlDetails,
): Promise<boolean> {
  if (cliRuntimeOfRunId(runId)) {
    const allow = typeof choice === "boolean" ? choice : choice !== "deny";
    return answerCliApproval(runId, allow, details?.requestId ?? undefined);
  }
  return submitHermesRunApproval(agent, runId, choice, details);
}

export async function submitRunClarify(
  agent: Agent,
  runId: string,
  reply: string,
  details?: HermesControlDetails,
): Promise<boolean> {
  return cliRuntimeOfRunId(runId) ? false : submitHermesRunClarify(agent, runId, reply, details);
}

/** Hermes can release a run left "unknown" after a crash; a CLI run cannot be. */
export async function resolveUnknownRun(
  agent: Agent,
  runId: string,
  details: { admissionId: string; executionGeneration: number },
): Promise<boolean> {
  return cliRuntimeOfRunId(runId) ? false : resolveHermesUnknownRun(agent, runId, details);
}

export async function forkSession(agent: Agent, sessionId: string, title?: string): Promise<string> {
  if (cliOf(agent) || sessionId.startsWith("cli-")) throw new UnsupportedRuntimeError();
  return forkHermesSession(agent, sessionId, title);
}

/** Compacts a session's context; its history stays readable. */
export async function compactSession(agent: Agent, sessionId: string): Promise<void> {
  if (cliOf(agent)) throw new UnsupportedRuntimeError();
  await sendHermesSessionChat(agent, sessionId, { prompt: "/compact" });
}

/** Restore the checkpoint associated with a Hermes session. */
export async function rollbackSession(agent: Agent, sessionId: string): Promise<void> {
  if (cliOf(agent) || sessionId.startsWith("cli-")) throw new UnsupportedRuntimeError();
  await sendHermesSessionChat(agent, sessionId, { prompt: "/rollback" });
}

const NO_CAPABILITIES: HermesServerCapabilities = { available: false, features: {}, endpoints: {} };

export async function getCapabilities(agent: Agent): Promise<HermesServerCapabilities> {
  return cliOf(agent) ? NO_CAPABILITIES : getHermesServerCapabilities(agent);
}

export async function getInventory(agent: Agent): Promise<HermesDetailedInventory> {
  return cliOf(agent) ? { skills: [], toolsets: [] } : getHermesDetailedInventory(agent);
}

/** One whole turn in a session, for runtimes that have session chat. */
export async function sessionChat(
  agent: Agent,
  sessionId: string,
  input: HermesSessionChatInput,
): Promise<{ output: string; tokens: number }> {
  if (cliOf(agent)) throw new UnsupportedRuntimeError();
  return sendHermesSessionChat(agent, sessionId, input);
}

/**
 * The waiting control `requestId` names (else the first of `kind`), read
 * fresh from the run so its execution generation and choices are current.
 */
export async function findPendingControl(
  agent: Agent,
  runId: string,
  requestId: string | undefined,
  kind: "approval" | "clarify" = "approval",
): Promise<PendingControl | null> {
  const run = await getRun(agent, runId);
  const controls = run.controls ?? normalizePendingControls(run.pending_controls);
  const ofKind = controls.filter((c) => c.kind === kind);
  return (requestId ? ofKind.find((c) => c.requestId === requestId) : undefined) ?? ofKind[0] ?? null;
}
