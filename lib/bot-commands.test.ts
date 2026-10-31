import assert from "node:assert/strict";
import { test } from "node:test";
import { HELP, parseBotCommand, runBotAction, runBotCommand, type BotDeps } from "./bot-commands";

test("commands parse, with the Telegram @bot suffix and bad input falling back to help", () => {
  assert.deepEqual(parseBotCommand("/mission Build a login page"), { kind: "mission", prompt: "Build a login page" });
  assert.deepEqual(parseBotCommand("/status@neiro_bot"), { kind: "status" });
  assert.deepEqual(parseBotCommand("/status m-1"), { kind: "status", missionId: "m-1" });
  assert.deepEqual(parseBotCommand("/approve t-9"), { kind: "approve", id: "t-9" });
  assert.deepEqual(parseBotCommand("/deny t-9"), { kind: "deny", taskId: "t-9" });
  assert.deepEqual(parseBotCommand("/clarify t-9 use postgres please"), { kind: "clarify", taskId: "t-9", answer: "use postgres please" });
  assert.deepEqual(parseBotCommand("/ask @Lens is this safe?"), { kind: "ask", handle: "lens", question: "is this safe?" });
  assert.deepEqual(parseBotCommand("/ask what is up"), { kind: "ask", handle: undefined, question: "what is up" });
  assert.deepEqual(parseBotCommand("/approve"), { kind: "help" });
  assert.deepEqual(parseBotCommand("/approve ../etc"), { kind: "help" });
  assert.deepEqual(parseBotCommand("/launch"), { kind: "help", unknown: "/launch" });
  assert.deepEqual(parseBotCommand("hello"), { kind: "help", unknown: "hello" });
});

function deps(target: "plan" | "route" | "tool" | null) {
  const calls: string[] = [];
  const d: BotDeps = {
    createMission: async (p) => (calls.push(`mission:${p}`), { id: "m1", title: p }),
    status: async (id) => `status:${id ?? "all"}`,
    approveTarget: async () => target,
    approvePlan: async (id) => (calls.push(`plan:${id}`), null),
    approveRoute: async (id) => (calls.push(`route:${id}`), null),
    answerTool: async (id, c, r) => (calls.push(`tool:${id}:${c}:${r ?? ""}`), null),
    retryTask: async (id) => (calls.push(`retry:${id}`), null),
    clarify: async (id, a) => (calls.push(`clarify:${id}:${a}`), "not waiting"),
    ask: async (h, q) => `asked ${h ?? "q&a"}: ${q}`,
    record: async (source, text) => void calls.push(`record:${source}:${text}`),
  };
  return { d, calls };
}

test("/approve goes to whatever the id is waiting for", async () => {
  for (const [target, call] of [["plan", "plan:x"], ["route", "route:x"], ["tool", "tool:x:once:"]] as const) {
    const { d, calls } = deps(target);
    await runBotCommand({ kind: "approve", id: "x" }, d, "telegram");
    assert.equal(calls[0], call);
    assert.match(calls[1], /^record:telegram:/);
  }
  const { d } = deps(null);
  assert.match(await runBotCommand({ kind: "approve", id: "x" }, d, "telegram"), /Nothing with id x/);
});

test("errors are reported and not recorded; help lists commands", async () => {
  const { d, calls } = deps("tool");
  assert.equal(await runBotCommand({ kind: "clarify", taskId: "t", answer: "a" }, d, "generic"), "Could not do it: not waiting");
  assert.equal(calls.some((c) => c.startsWith("record")), false);
  assert.equal(await runBotCommand({ kind: "help" }, d, "generic"), HELP);
});

test("buttons run the same actions with their request id", async () => {
  const { d, calls } = deps(null);
  await runBotAction({ id: "approve_tool_always", label: "", target: "t1", requestId: "p1" }, d, "telegram");
  await runBotAction({ id: "retry_task", label: "", target: "t2" }, d, "telegram");
  assert.deepEqual(calls.filter((c) => !c.startsWith("record")), ["tool:t1:always:p1", "retry:t2"]);
});
