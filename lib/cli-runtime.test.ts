import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  answerCliApproval,
  approveOnceOption,
  cliRuntimeOfRunId,
  getCliRun,
  openCliEventStream,
  parseOmpModels,
  readOmpLine,
  readOmpRpcFrame,
  startCliRun,
  stopCliRun,
} from "./cli-runtime";

test("omp rpc frames: approvals, other dialogs, results", () => {
  const ask = readOmpRpcFrame(
    '{"type":"extension_ui_request","id":"a1","method":"select","title":"Allow tool: bash\\nCommand: ls","options":["Approve","Approve bash for this session","Deny"]}',
  );
  assert.deepEqual(ask, { kind: "approval", id: "a1", tool: "bash", title: "Allow tool: bash\nCommand: ls", options: ["Approve", "Approve bash for this session", "Deny"] });
  assert.deepEqual(readOmpRpcFrame('{"type":"extension_ui_request","id":"d1","method":"input","title":"Name?"}'), { kind: "dialog", id: "d1" });
  assert.equal(readOmpRpcFrame('{"type":"extension_ui_request","id":"s1","method":"setStatus"}'), null);
  assert.deepEqual(readOmpRpcFrame('{"type":"prompt_result","status":"error","error":{"message":"no key"},"sessionSettled":false}'), {
    kind: "result",
    status: "error",
    error: "no key",
    settled: false,
  });
  assert.equal(readOmpRpcFrame('{"type":"ready"}')?.kind, "ready");
  assert.equal(readOmpRpcFrame('{"type":"agent_start"}'), null);
  assert.equal(approveOnceOption(["Approve Directory: src", "Always Approve Directory: src", "Approve Once", "Deny"]), "Approve Once");
});

test("run ids name their runtime", () => {
  assert.equal(cliRuntimeOfRunId("omp_7cce91df-3b59-477b-a6fa-9bf782921835"), "ohmypi");
  assert.equal(cliRuntimeOfRunId("agy_7cce91df-3b59-477b-a6fa-9bf782921835"), null);
  assert.equal(cliRuntimeOfRunId("run_123"), null);
});

test("omp lines become text, tools, tokens and an end", () => {
  assert.equal(readOmpLine('{"type":"session","id":"01a1-33b1"}')?.sse?.type, "run.started");
  assert.equal(
    readOmpLine('{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"ap"}}')?.textDelta,
    "ap",
  );
  assert.equal(readOmpLine('{"type":"tool_execution_start","toolName":"read","args":{"path":"a"}}')?.sse?.tool, "read");
  const end = readOmpLine(
    '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"mantap"}],"usage":{"totalTokens":42}}}',
  );
  assert.equal(end?.text, "mantap");
  assert.equal(end?.tokens, 42);
  assert.equal(readOmpLine('{"type":"message_end","message":{"role":"user","content":[]}}'), null);
  assert.deepEqual(readOmpLine('{"type":"agent_end"}')?.final, { ok: true });
});

test("model lists parse", () => {
  assert.deepEqual(
    parseOmpModels('{"models":[{"provider":"9router","kind":"chat","id":"ag/x","selector":"9router/ag/x"},{"provider":"p","kind":"embed","id":"e"}]}'),
    [{ id: "9router/ag/x", name: "ag/x", group: "Oh My Pi · 9router" }],
  );
});

/* ---------- full runs against fake CLIs ---------- */

let dir = "";
const env = { ...process.env };

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "neiro-cli-test-"));
  process.env.NEIRO_DATA_DIR = join(dir, "data");
  // Fake omp in RPC mode: logs its args, reads the prompt, asks to write a
  // file, logs the answer, then finishes and waits for stdin to close.
  const omp = join(dir, "omp");
  await writeFile(
    omp,
    `#!/bin/sh
printf '%s\\n' "$@" >> "${dir}/omp-args.log"
echo '=END=' >> "${dir}/omp-args.log"
prev=""; for a in "$@"; do [ "$prev" = "--session-dir" ] && touch "$a/session.jsonl"; prev="$a"; done
printf '%s\\n' '{"type":"ready","protocolVersion":1}'
read -r prompt; printf '%s\\n' "$prompt" >> "${dir}/omp-io.log"
printf '%s\\n' '{"type":"extension_ui_request","id":"st-1","method":"setStatus","statusKey":"x"}'
printf '%s\\n' '{"type":"session","id":"s-1"}'
printf '%s\\n' '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"halo"}}'
printf '%s\\n' '{"type":"tool_execution_start","toolName":"write"}'
printf '%s\\n' '{"type":"extension_ui_request","id":"ask-1","method":"select","title":"Allow tool: write\\nPath: a.txt","options":["Approve","Approve write for this session","Deny"]}'
read -r answer; printf '%s\\n' "$answer" >> "${dir}/omp-io.log"
printf '%s\\n' '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"halo dunia"}],"usage":{"totalTokens":7}}}'
printf '%s\\n' '{"type":"agent_end"}'
printf '%s\\n' '{"type":"prompt_result","id":"neiro","agentInvoked":true,"status":"completed","sessionSettled":true}'
cat > /dev/null
`,
  );
  await chmod(omp, 0o755);
  process.env.OHMYPI_BIN = omp;

  const slow = join(dir, "slow");
  await writeFile(slow, "#!/bin/sh\nsleep 30\n");
  await chmod(slow, 0o755);
});

after(async () => {
  process.env = env;
  await rm(dir, { recursive: true, force: true });
});

async function waitDone(runId: string) {
  for (let i = 0; i < 100; i++) {
    const run = getCliRun(runId);
    if (run.status !== "running") return run;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error("run did not finish");
}

async function waitPending(runId: string) {
  for (let i = 0; i < 100; i++) {
    const run = getCliRun(runId);
    if (run.pending_controls.length > 0) return run.pending_controls;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error("no approval request arrived");
}

test("an omp run waits for Allow, finishes, and continues its session", async () => {
  const first = await startCliRun("ohmypi", { prompt: "hai", instructions: "be brief", model: "x/y", effort: "low", sessionId: "chat-1", cwd: dir });
  assert.equal(first.kind, "started");
  if (first.kind !== "started") return;

  const pending = await waitPending(first.runId);
  assert.equal((pending[0] as { tool: string }).tool, "write");
  assert.equal(getCliRun(first.runId).status, "running", "it waits for the answer");
  assert.equal(answerCliApproval(first.runId, true), true);
  assert.equal(answerCliApproval(first.runId, true), false, "nothing left to answer");

  const run = await waitDone(first.runId);
  assert.equal(run.status, "completed");
  assert.equal(run.output, "halo dunia");
  assert.equal(run.tokens, 7);

  const text = await new Response(openCliEventStream(first.runId)).text();
  assert.match(text, /approval\.requested/);
  assert.match(text, /You allowed write/);
  assert.match(text, /run\.completed/);

  const second = await startCliRun("ohmypi", { prompt: "lagi", sessionId: "chat-1", cwd: dir });
  if (second.kind === "started") {
    await waitPending(second.runId);
    answerCliApproval(second.runId, false);
    await waitDone(second.runId);
  }

  const io = (await readFile(join(dir, "omp-io.log"), "utf8")).trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(io[0], { type: "prompt", id: "neiro", message: "hai" });
  assert.deepEqual(io[1], { type: "extension_ui_response", id: "ask-1", value: "Approve" }, "approves this call only");
  assert.equal(io[3].value, "Deny");

  const [a, b] = (await readFile(join(dir, "omp-args.log"), "utf8")).split("=END=\n");
  assert.ok(a.includes("--mode\nrpc\n") && a.includes("--approval-mode\nalways-ask\n"));
  assert.ok(a.includes("--append-system-prompt\nbe brief\n"));
  assert.ok(a.includes("--model\nx/y\n") && a.includes("--thinking\nlow\n") && a.includes(`--cwd\n${dir}\n`));
  assert.ok(!a.includes("--continue"), "first run starts a new session");
  assert.ok(b.includes("--continue"), "second run continues it");
});

test("a run that cannot ask refuses writes at once", async () => {
  const started = await startCliRun("ohmypi", { prompt: "q", approvals: "deny" });
  if (started.kind !== "started") return assert.fail("not started");
  const run = await waitDone(started.runId);
  assert.equal(run.status, "completed");
  const io = (await readFile(join(dir, "omp-io.log"), "utf8")).trim().split("\n");
  assert.equal(JSON.parse(io.at(-1)!).value, "Deny");
  assert.match(await new Response(openCliEventStream(started.runId)).text(), /cannot ask you/);
});

test("the same idempotency key starts one run, and stop cancels it", async () => {
  process.env.OHMYPI_BIN = join(dir, "slow");
  const a = await startCliRun("ohmypi", { prompt: "x", idempotencyKey: "k-1" });
  const b = await startCliRun("ohmypi", { prompt: "x", idempotencyKey: "k-1" });
  assert.equal(a.kind, "started");
  assert.deepEqual(a, b);
  if (a.kind !== "started") return;
  assert.equal(stopCliRun(a.runId), true);
  assert.equal(getCliRun(a.runId).status, "cancelled");
  assert.equal(getCliRun("omp_00000000-0000-0000-0000-000000000000").status, "expired_404");
});
