import { act } from "react";
import { createRoot } from "react-dom/client";
import { QuestionHistory } from "../components/question-history";
import type { AskQuestionDTO } from "../lib/ask-history";

// Real React and DOM; control only API responses and the polling interval.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const root = createRoot(document.getElementById("root")!);
const nativeFetch = window.fetch;
const nativeInterval = window.setInterval;
const nativeClearInterval = window.clearInterval;
const polls = new Map<number, TimerHandler>();
let nextTimer = -1;
window.setInterval = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
  if (delay === 10_000) {
    const id = nextTimer--;
    polls.set(id, handler);
    return id;
  }
  return nativeInterval(handler, delay, ...args);
}) as typeof window.setInterval;
window.clearInterval = ((id?: number) => {
  if (id !== undefined) polls.delete(id);
  nativeClearInterval(id);
}) as typeof window.clearInterval;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}

function question(id: string, status: AskQuestionDTO["status"] = "completed"): AskQuestionDTO {
  return {
    id, status, agentId: "agent-1", agentName: "PM", question: id,
    workspacePath: "/tmp/project", followUpOf: null, answer: "", error: null,
    tokens: 0, createdAt: "2026-10-28T12:00:00.000Z", finishedAt: null,
  };
}

function page(questions: AskQuestionDTO[], nextBefore: string | null = null) {
  return Response.json({ questions, nextBefore });
}

function loadButton() {
  const node = [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Load older");
  assert(node, "Missing Load older button");
  return node;
}

async function loadMore() {
  await act(async () => { loadButton().click(); });
}

async function until(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
  assert(check(), "Timed out waiting for history results");
}

async function mount() {
  await act(async () => { root.render(<QuestionHistory />); });
  await until(() => questions().length > 0);
}

async function respond(request: ReturnType<typeof deferred>, response: Response) {
  await act(async () => {
    request.resolve(response);
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

async function search(value: string) {
  await act(async () => {
    const input = document.querySelector<HTMLInputElement>("#question-search")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 350)); });
  await until(() => questions().some((text) => text?.includes(value)));
}

async function poll() {
  assert(polls.size > 0, "No polling timer");
  await act(async () => {
    for (const handler of [...polls.values()]) (handler as () => void)();
  });
}

function questions() {
  return [...document.querySelectorAll(".story-ask-text")].map((node) => node.textContent);
}

const tests: [string, () => Promise<void>][] = [
  ["A running question on an older page receives its finished answer", async () => {
    const newest = Array.from({ length: 25 }, (_, i) => question(`new-${i}`));
    let finished = false;
    window.fetch = async (input) => {
      const url = new URL(String(input), location.href);
      if (!url.searchParams.has("before")) return page(newest, "older-page");
      return page([{ ...question("older-running", finished ? "completed" : "running"), answer: finished ? "Older answer saved" : "" }]);
    };
    await mount();
    await loadMore();
    await until(() => questions().length === 26);
    finished = true;
    await poll();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    const older = [...document.querySelectorAll(".story-pair")].find((node) => node.textContent?.includes("older-running"));
    assert(older?.getAttribute("data-status") === "completed" && older.textContent?.includes("Older answer saved"), "Older answer remained running");
    assert(questions().length === 26, "Refreshing discarded or duplicated loaded questions");
    assert(polls.size === 0, "Polling continued after all questions finished");
  }],
  ["An old pagination response cannot append rows or replace the new search cursor", async () => {
    const stale = deferred();
    let requestedCursor = "";
    window.fetch = async (input) => {
      const url = new URL(String(input), location.href);
      const before = url.searchParams.get("before");
      if (url.searchParams.get("q") === "needle") {
        if (before) { requestedCursor = before; return page([question("needle older")]); }
        return page([question("needle newest")], "needle-cursor");
      }
      return before ? stale.promise : page([question("old newest")], "old-cursor");
    };
    await mount();
    await loadMore();
    await search("needle");
    await respond(stale, page([question("unrelated")], "wrong-cursor"));
    assert(questions().join(",") === "needle newest", `Stale rows entered the new search: ${questions()}`);
    await loadMore();
    await until(() => questions().length === 2);
    assert(requestedCursor === "needle-cursor", `Stale response replaced cursor: ${requestedCursor}`);
    assert(questions().join(",") === "needle newest,needle older", "Matching older results were skipped");
  }],
  ["An old polling response cannot enter a new search", async () => {
    const stale = deferred();
    let reads = 0;
    window.fetch = async (input) => {
      const url = new URL(String(input), location.href);
      if (url.searchParams.has("q")) return page([question("needle")]);
      return ++reads === 1 ? page([question("old running", "running")]) : stale.promise;
    };
    await mount();
    await poll();
    await search("needle");
    await respond(stale, page([{ ...question("old running"), answer: "Wrong answer" }]));
    assert(questions().join(",") === "needle", `Stale poll entered the new search: ${questions()}`);
  }],
  ["An old pagination failure cannot set an error on a new search", async () => {
    const stale = deferred();
    window.fetch = async (input) => {
      const url = new URL(String(input), location.href);
      if (url.searchParams.has("q")) return page([question("needle")]);
      return url.searchParams.has("before") ? stale.promise : page([question("old")], "old-cursor");
    };
    await mount();
    await loadMore();
    await search("needle");
    await respond(stale, Response.json({ error: "Old search failed" }, { status: 500 }));
    assert(!document.querySelector('[role="alert"]'), "Old failure leaked into new search");
    assert(questions().join(",") === "needle", "New search results were lost");
  }],
];

let failures = 0;
for (const [name, test] of tests) {
  const result = document.createElement("li");
  try {
    await test();
    result.textContent = `PASS: ${name}`;
  } catch (error) {
    failures++;
    result.textContent = `FAIL: ${name}: ${error instanceof Error ? error.message : error}`;
  } finally {
    await act(async () => { root.render(null); });
    polls.clear();
    document.getElementById("results")!.append(result);
  }
}
window.fetch = nativeFetch;
window.setInterval = nativeInterval;
window.clearInterval = nativeClearInterval;
document.querySelector("h1")!.textContent = `${tests.length - failures}/${tests.length} passed`;
