import { spawn, execFile, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readdir, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { createInterface } from "node:readline";

/**
 * Runs agents through the local Oh My Pi CLI (`omp --mode rpc`) instead of
 * the Hermes server. Each run is one child process; its JSON frames are
 * turned into Hermes-shaped run status and SSE events so the orchestrator,
 * Ask and the task chat need no runtime-specific code.
 *
 * Runs live in this server process: a restart forgets running runs, which
 * then read as `expired_404`, the same as a run Hermes no longer knows.
 */

export type CliRuntime = "ohmypi";

export function cliRuntimeOfRunId(runId: string): CliRuntime | null {
  return /^omp_[0-9a-f-]{36}$/.test(runId) ? "ohmypi" : null;
}

/* ---------- reading the CLI output ---------- */

export type CliLine = {
  /** Event for the live log, in the shape `parseRunEvent` reads. */
  sse?: Record<string, unknown>;
  textDelta?: string;
  /** A whole assistant message (replaces the streamed text so far). */
  text?: string;
  tokens?: number;
  final?: { ok: boolean; output?: string; error?: string; tokens?: number };
};

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const obj = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

function parseJson(line: string): Record<string, unknown> | null {
  try {
    return obj(JSON.parse(line)) ?? null;
  } catch {
    return null;
  }
}

function messageText(message: Record<string, unknown> | undefined): string {
  const content = Array.isArray(message?.content) ? message.content : [];
  return content
    .map((part) => obj(part))
    .filter((part) => part?.type === "text")
    .map((part) => str(part?.text) ?? "")
    .join("");
}

/** One `omp --mode json` line. */
export function readOmpLine(line: string): CliLine | null {
  const data = parseJson(line);
  if (!data) return null;
  const type = str(data.type) ?? "";

  if (type === "session") return { sse: { type: "run.started" } };

  if (type === "message_update") {
    const ev = obj(data.assistantMessageEvent);
    const delta = ev?.type === "text_delta" ? str(ev.delta) : undefined;
    return delta ? { textDelta: delta, sse: { type: "message.delta", delta } } : null;
  }

  if (type === "tool_execution_start") {
    return { sse: { type: "tool.started", tool: str(data.toolName) ?? "a tool", arguments: data.args } };
  }

  if (type === "message_end") {
    const message = obj(data.message);
    if (message?.role !== "assistant") return null;
    const usage = obj(message.usage);
    const tokens = typeof usage?.totalTokens === "number" ? usage.totalTokens : undefined;
    const text = messageText(message);
    const error = str(message.errorMessage);
    if (error && str(message.stopReason) === "error") {
      return { tokens, sse: { type: "run.error", error } };
    }
    return { tokens, text: text || undefined };
  }

  if (type === "agent_end") return { final: { ok: true } };
  return null;
}

export type OmpRpcFrame =
  | { kind: "ready" }
  | { kind: "approval"; id: string; tool: string; title: string; options: string[] }
  /** A dialog neiro cannot show: it is dismissed so the run does not hang. */
  | { kind: "dialog"; id: string }
  | { kind: "result"; status: string; error?: string; settled: boolean }
  | { kind: "settled" }
  | { kind: "event"; line: CliLine };

const DIALOGS = new Set(["select", "confirm", "input", "editor", "ask"]);

/**
 * One `omp --mode rpc` frame. Tool approvals arrive as an
 * `extension_ui_request` select whose options end in "Deny"; agent events
 * are the same as `--mode json`.
 */
export function readOmpRpcFrame(line: string): OmpRpcFrame | null {
  const data = parseJson(line);
  if (!data) return null;
  const type = str(data.type) ?? "";
  if (type === "ready") return { kind: "ready" };
  if (type === "session_settled") return { kind: "settled" };
  if (type === "prompt_result") {
    const error = obj(data.error);
    return { kind: "result", status: str(data.status) ?? "error", error: str(error?.message), settled: data.sessionSettled !== false };
  }
  if (type === "extension_ui_request") {
    const id = str(data.id);
    const method = str(data.method) ?? "";
    if (!id || !DIALOGS.has(method)) return null; // status lines, widgets, notices
    const options = Array.isArray(data.options) ? data.options.filter((o): o is string => typeof o === "string") : [];
    const title = str(data.title) ?? "";
    if (method === "select" && options.includes("Deny") && options.some((o) => o.startsWith("Approve"))) {
      const tool = /^Allow tool: *(\S+)/.exec(title)?.[1] ?? "a tool";
      return { kind: "approval", id, tool, title, options };
    }
    return { kind: "dialog", id };
  }
  const read = readOmpLine(line);
  return read ? { kind: "event", line: read } : null;
}

/** The option that approves this one call only (never "for this session" or "always"). */
export function approveOnceOption(options: string[]): string {
  return options.find((o) => o === "Approve" || o === "Approve Once") ?? options.find((o) => o.startsWith("Approve")) ?? "Approve";
}

/* ---------- where things live ---------- */

function dataDir(): string {
  return process.env.NEIRO_DATA_DIR?.trim() || join(homedir(), ".neiro");
}

/** A chat or task key that is safe as a file name. */
function safeKey(key: string): string {
  return /^[A-Za-z0-9_-]{1,100}$/.test(key) ? key : createHash("sha256").update(key).digest("hex").slice(0, 40);
}

async function isExecutable(path: string): Promise<boolean> {
  return access(path, constants.X_OK).then(() => true, () => false);
}

export async function resolveCliBin(): Promise<string | null> {
  const candidates = [process.env.OHMYPI_BIN?.trim(), join(homedir(), ".bun/bin/omp")].filter((p): p is string =>
    Boolean(p),
  );
  for (const path of candidates) if (await isExecutable(path)) return path;
  return null;
}

/** `omp` is a bun script, so bun must be on PATH next to it. */
function childEnv(bin: string): NodeJS.ProcessEnv {
  const extra = [dirname(bin), join(homedir(), ".bun/bin")];
  return { ...process.env, PATH: [...extra, process.env.PATH ?? ""].join(":") };
}

async function workDir(cwd?: string): Promise<string> {
  if (cwd && isAbsolute(cwd)) {
    const info = await stat(cwd).catch(() => null);
    if (info?.isDirectory()) return cwd;
  }
  // No project folder: run in an empty folder so no real file is touched.
  const empty = join(dataDir(), "empty-workspace");
  await mkdir(empty, { recursive: true });
  return empty;
}

/* ---------- runs ---------- */

type CliRun = {
  runId: string;
  runtime: CliRuntime;
  status: "running" | "completed" | "failed" | "cancelled";
  output: string;
  tokens: number;
  error?: string;
  events: string[];
  listeners: Set<(event: string | null) => void>;
  child?: ChildProcess;
  idempotencyKey?: string;
  endedAt?: number;
  /** Oh My Pi tool calls waiting for Allow / Deny, oldest first. */
  pending: PendingApproval[];
  /** Writes one RPC frame to the CLI (Oh My Pi only). */
  send?: (frame: Record<string, unknown>) => void;
};

type PendingApproval = { id: string; tool: string; title: string; options: string[]; at: string };

const store = globalThis as { __neiroCliRuns?: Map<string, CliRun> };
const runs: Map<string, CliRun> = (store.__neiroCliRuns ??= new Map());

const MAX_EVENTS = 3000;
const KEEP_MS = 6 * 60 * 60 * 1000;

function maxParallel(): number {
  const n = Number.parseInt(process.env.CLI_MAX_PARALLEL_RUNS ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 3;
}

function prune() {
  const now = Date.now();
  for (const [id, run] of runs) if (run.endedAt && now - run.endedAt > KEEP_MS) runs.delete(id);
}

function emit(run: CliRun, event: Record<string, unknown>) {
  const json = JSON.stringify({ ...event, timestamp: new Date().toISOString() });
  run.events.push(json);
  if (run.events.length > MAX_EVENTS) run.events.splice(0, run.events.length - MAX_EVENTS);
  for (const listener of run.listeners) listener(json);
}

function finish(run: CliRun, status: CliRun["status"], error?: string) {
  if (run.status !== "running") return;
  run.status = status;
  run.error = error;
  run.endedAt = Date.now();
  emit(run, status === "completed" ? { type: "run.completed" } : { type: "run.failed", error: error ?? status });
  for (const listener of run.listeners) listener(null);
  run.listeners.clear();
  run.pending = [];
  run.send = undefined;
  run.child = undefined;
}

export type CliStartInput = {
  prompt: string;
  instructions?: string;
  model?: string;
  effort?: string;
  sessionId?: string;
  cwd?: string;
  idempotencyKey?: string;
  /**
   * Oh My Pi only. "ask" (default) pauses on each write or command for
   * Allow / Deny in the live log; "deny" refuses them at once, for runs
   * nobody can answer (Ask questions).
   */
  approvals?: "ask" | "deny";
};

export type CliStartResult = { kind: "started"; runId: string } | { kind: "deferred"; reason: string };

export async function startCliRun(runtime: CliRuntime, input: CliStartInput): Promise<CliStartResult> {
  prune();
  if (input.idempotencyKey) {
    for (const run of runs.values()) {
      if (run.idempotencyKey === input.idempotencyKey) return { kind: "started", runId: run.runId };
    }
  }
  const busy = [...runs.values()].filter((run) => run.status === "running").length;
  if (busy >= maxParallel()) {
    return { kind: "deferred", reason: `${busy} CLI runs are already going.` };
  }

  const bin = await resolveCliBin();
  if (!bin) throw new Error("omp (Oh My Pi) is not installed on this computer.");

  const runId = `omp_${randomUUID()}`;
  const key = safeKey(input.sessionId || runId);
  const cwd = await workDir(input.cwd);
  const model = input.model?.trim();
  const instructions = input.instructions?.trim();

  const sessionDir = join(dataDir(), "omp-sessions", key);
  await mkdir(sessionDir, { recursive: true });
  const resumed = (await readdir(sessionDir).catch(() => [])).length > 0;
  // RPC mode keeps stdin open so a write or command can wait for Allow / Deny.
  // always-ask: reads run freely, writes and commands ask first.
  const args = ["--mode", "rpc", "--approval-mode", "always-ask", "--session-dir", sessionDir, "--cwd", cwd];
  if (resumed) args.push("--continue");
  if (instructions) args.push("--append-system-prompt", instructions);
  if (model) args.push("--model", model);
  const effort = input.effort?.trim();
  if (effort) args.push("--thinking", effort);

  const run: CliRun = {
    runId,
    runtime,
    status: "running",
    output: "",
    tokens: 0,
    events: [],
    listeners: new Set(),
    idempotencyKey: input.idempotencyKey,
    pending: [],
  };
  runs.set(runId, run);

  const child = spawn(bin, args, { cwd, env: childEnv(bin), stdio: ["pipe", "pipe", "pipe"] });
  run.child = child;
  child.stdin?.on("error", () => undefined); // the CLI exited; close handles it
  run.send = (frame) => {
    if (child.stdin?.writable) child.stdin.write(`${JSON.stringify(frame)}\n`);
  };

  let streamed = "";
  let lastText = "";
  let finalSeen: CliLine["final"];
  let stepTokens = 0;
  let stderr = "";
  let waitingToSettle = false;

  child.stderr?.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString("utf8")).slice(-4000);
  });

  const take = (read: CliLine) => {
    if (read.textDelta) streamed += read.textDelta;
    if (read.text) lastText = read.text;
    if (read.tokens) stepTokens += read.tokens;
    if (read.sse) emit(run, read.sse);
  };

  // In RPC mode the CLI stays up after the answer: end it once settled.
  const endRpc = () => {
    child.stdin?.end();
    setTimeout(() => child.kill("SIGTERM"), 2000).unref();
  };

  createInterface({ input: child.stdout! }).on("line", (line) => {
    const frame = readOmpRpcFrame(line);
    if (!frame) return;
    switch (frame.kind) {
      case "ready":
        run.send?.({ type: "prompt", id: "neiro", message: input.prompt });
        return;
      case "event":
        take(frame.line);
        return;
      case "dialog":
        run.send?.({ type: "extension_ui_response", id: frame.id, cancelled: true });
        return;
      case "approval": {
        const ask: PendingApproval = { ...frame, at: new Date().toISOString() };
        if (input.approvals === "deny") {
          run.send?.({ type: "extension_ui_response", id: ask.id, value: "Deny" });
          emit(run, { type: "decision", message: `Refused ${ask.tool}: this run cannot ask you.` });
          return;
        }
        run.pending.push(ask);
        emit(run, { type: "approval.requested", tool: ask.tool, command: ask.title, request_id: ask.id });
        return;
      }
      case "result":
        finalSeen =
          frame.status === "completed"
            ? { ok: true }
            : { ok: false, error: frame.error ?? (frame.status === "aborted" ? "The run was stopped." : "Oh My Pi failed") };
        if (frame.settled) endRpc();
        else waitingToSettle = true;
        return;
      case "settled":
        if (waitingToSettle) endRpc();
        return;
    }
  });

  child.on("error", (err) => finish(run, "failed", err.message));
  child.on("close", (code) => {
    if (run.status !== "running") return;
    run.output = (finalSeen?.output ?? (lastText || streamed)).trim();
    run.tokens = finalSeen?.tokens ?? stepTokens;
    if (finalSeen && !finalSeen.ok) return finish(run, "failed", finalSeen.error);
    if (finalSeen || code === 0) return finish(run, "completed");
    const tail = stderr.trim().split("\n").slice(-3).join(" ").slice(0, 400);
    finish(run, "failed", tail || `The CLI stopped with code ${code}.`);
  });

  return { kind: "started", runId };
}

export type CliRunStatus = {
  run_id: string;
  status: string;
  output?: string;
  tokens?: number;
  error?: string;
  pending_controls: unknown[];
};

export function getCliRun(runId: string): CliRunStatus {
  const run = runs.get(runId);
  if (!run) {
    return { run_id: runId, status: "expired_404", error: "This run ended when the server restarted.", pending_controls: [] };
  }
  return {
    run_id: runId,
    status: run.status,
    output: run.output || undefined,
    tokens: run.tokens,
    error: run.error,
    pending_controls: run.pending.map((p) => ({ kind: "approval", request_id: p.id, tool: p.tool, title: p.title, at: p.at })),
  };
}

/**
 * Answers a waiting tool call: the one named by `requestId`, else the oldest.
 * Allow approves this call only. False when nothing is waiting.
 */
export function answerCliApproval(runId: string, approved: boolean, requestId?: string): boolean {
  const run = runs.get(runId);
  if (!run || run.status !== "running" || !run.send || run.pending.length === 0) return false;
  const index = requestId ? run.pending.findIndex((p) => p.id === requestId) : 0;
  const ask = run.pending[index < 0 ? 0 : index];
  run.pending = run.pending.filter((p) => p !== ask);
  run.send({ type: "extension_ui_response", id: ask.id, value: approved ? approveOnceOption(ask.options) : "Deny" });
  emit(run, { type: "decision", message: `${approved ? "You allowed" : "You denied"} ${ask.tool}.` });
  return true;
}

export function stopCliRun(runId: string): boolean {
  const run = runs.get(runId);
  if (!run || run.status !== "running") return false;
  run.send?.({ type: "abort" });
  run.child?.kill("SIGTERM");
  finish(run, "cancelled", "Stopped by you");
  return true;
}

/** Server-sent events for one run: everything so far, then live until it ends. */
export function openCliEventStream(runId: string, signal?: AbortSignal): ReadableStream<Uint8Array> {
  const run = runs.get(runId);
  if (!run) throw new Error("Run not found: it ended when the server restarted.");
  const encoder = new TextEncoder();
  let listener: ((event: string | null) => void) | undefined;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string) => controller.enqueue(encoder.encode(`data: ${event}\n\n`));
      for (const event of run.events) send(event);
      if (run.status !== "running") return controller.close();
      listener = (event) => {
        if (event === null) {
          run.listeners.delete(listener!);
          controller.close();
        } else {
          send(event);
        }
      };
      run.listeners.add(listener);
      signal?.addEventListener("abort", () => {
        run.listeners.delete(listener!);
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
    cancel() {
      if (listener) run.listeners.delete(listener);
    },
  });
}

/* ---------- models ---------- */

export type CliModel = { id: string; name: string; group: string };
export type CliRuntimeInfo = { installed: boolean; bin: string | null; models: CliModel[]; reason?: string };

const modelCache = new Map<CliRuntime, { at: number; info: CliRuntimeInfo }>();
const MODEL_TTL = 5 * 60 * 1000;

function run(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { env: childEnv(bin), timeout: 30_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) =>
      err ? reject(err) : resolve(stdout),
    );
  });
}

export function parseOmpModels(json: string): CliModel[] {
  const data = parseJson(json);
  const list = Array.isArray(data?.models) ? data.models : [];
  return list
    .map((m) => obj(m))
    .filter((m) => m && (m.kind === undefined || m.kind === "chat"))
    .map((m) => ({
      id: str(m!.selector) ?? `${str(m!.provider)}/${str(m!.id)}`,
      name: str(m!.id) ?? "",
      group: `Oh My Pi · ${str(m!.provider) ?? "other"}`,
    }))
    .filter((m) => m.name);
}

export async function listCliRuntime(runtime: CliRuntime): Promise<CliRuntimeInfo> {
  const cached = modelCache.get(runtime);
  if (cached && Date.now() - cached.at < MODEL_TTL) return cached.info;

  const bin = await resolveCliBin();
  let info: CliRuntimeInfo;
  if (!bin) {
    info = { installed: false, bin: null, models: [], reason: "not installed" };
  } else {
    try {
      info = { installed: true, bin, models: parseOmpModels(await run(bin, ["models", "--json"])) };
    } catch (err: unknown) {
      info = { installed: true, bin, models: [], reason: err instanceof Error ? err.message.slice(0, 200) : "model list failed" };
    }
  }
  modelCache.set(runtime, { at: Date.now(), info });
  return info;
}
