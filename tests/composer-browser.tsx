import { Activity, act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { MissionComposer } from "../components/mission-composer";
import { FolderPicker } from "../components/folder-picker";

// Real React, Activity and browser DOM; only API responses and polling time are controlled.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const root = createRoot(document.getElementById("root")!);
const nativeFetch = window.fetch;
const nativeTimeout = window.setTimeout;
const nativeClearTimeout = window.clearTimeout;
const polls = new Map<number, TimerHandler>();
let nextTimer = -1;
window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
  if (delay === 2000 || delay === 3000) {
    const id = nextTimer--;
    polls.set(id, handler);
    return id;
  }
  return nativeTimeout(handler, delay, ...args);
}) as typeof window.setTimeout;
window.clearTimeout = ((id?: number) => {
  if (id !== undefined) polls.delete(id);
  nativeClearTimeout(id);
}) as typeof window.clearTimeout;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function button(label: string) {
  const found = [...document.querySelectorAll("button")].find((node) => node.textContent?.trim() === label);
  assert(found, `Missing button: ${label}`);
  return found;
}

async function click(label: string) {
  await act(async () => { button(label).click(); });
}

async function until(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i++) {
    await act(async () => { await new Promise((resolve) => nativeTimeout(resolve, 10)); });
  }
  assert(check(), "Timed out waiting for folder selection to become available");
}

async function tickPoll() {
  const timer = polls.entries().next().value;
  assert(timer, "No polling timer was scheduled");
  polls.delete(timer[0]);
  await act(async () => { await (timer[1] as () => Promise<void>)(); });
}

function composer(visible = true) {
  return (
    <Activity mode={visible ? "visible" : "hidden"}>
      <MissionComposer
        prompt="Explain this project"
        onPromptChange={() => {}}
        workspace="/home/test/project"
        onWorkspaceChange={() => {}}
        inputRef={createRef<HTMLTextAreaElement>()}
        isLive
        launching={false}
        onLaunch={() => {}}
        advanced={null}
      />
    </Activity>
  );
}

const started = () => Response.json({ runId: "run-1", agentId: "agent-1", agentName: "Neiro" });
const running = () => Response.json({ status: "running", output: "Reading", tokens: 0, error: null });
const completed = () => Response.json({ status: "completed", output: "The answer", tokens: 10, error: null });
const tests: [string, () => Promise<void>][] = [
  ["Ask locks immediately and blocks keyboard resubmission while running", async () => {
    const request = deferred<Response>();
    let posts = 0;
    window.fetch = async (_input, init) => {
      if (init?.method === "POST") { posts++; return request.promise; }
      return running();
    };
    await act(async () => { root.render(composer()); });
    await act(async () => {
      button("Ask").click();
      document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    const pendingDisabled = document.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled;
    await act(async () => {
      document.querySelector("textarea")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
    });
    const pendingPosts = posts;
    await act(async () => { request.resolve(started()); });
    await act(async () => {
      document.querySelector("textarea")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }));
    });
    assert(pendingDisabled && pendingPosts === 1 && posts === 1, `Ask was not locked: disabled=${pendingDisabled}, pending=${pendingPosts}, total=${posts}`);
    await tickPoll();
    assert(document.querySelector('[data-phase="running"]')?.textContent?.includes("Reading"), "Rejected resubmission stopped polling the active run");
  }],
  ["Polling resumes after an Activity hide/show", async () => {
    window.fetch = async (_input, init) => init?.method === "POST" ? started() : completed();
    await act(async () => { root.render(composer()); });
    await click("Ask");
    await act(async () => { root.render(composer(false)); });
    assert(polls.size === 0, "Polling continued while hidden");
    await act(async () => { root.render(composer()); });
    await tickPoll();
    assert(document.querySelector('[data-phase="done"]')?.textContent?.includes("The answer"), "Answer did not complete after returning");
  }],
  ["A poll resolving after hide cannot restart hidden polling", async () => {
    const stale = deferred<Response>();
    let gets = 0;
    window.fetch = async (_input, init) => init?.method === "POST" ? started() : ++gets === 1 ? stale.promise : completed();
    await act(async () => { root.render(composer()); });
    await click("Ask");
    const timer = polls.entries().next().value!;
    polls.delete(timer[0]);
    let checking: Promise<void>;
    await act(async () => { checking = (timer[1] as () => Promise<void>)(); });
    await act(async () => { root.render(composer(false)); });
    await act(async () => { stale.resolve(running()); await checking; });
    assert(polls.size === 0, "An in-flight poll restarted after hiding");
    await act(async () => { root.render(composer()); });
    await tickPoll();
    assert(document.querySelector('[data-phase="done"]'), "Polling did not resume");
  }],
  ...(["http", "network"] as const).map((failure): [string, () => Promise<void>] => [
    `A ${failure} cancellation failure keeps polling and allows Stop to be retried`, async () => {
      let deletes = 0;
      window.fetch = async (_input, init) => {
        if (init?.method === "POST") return started();
        if (init?.method === "DELETE") {
          if (++deletes > 1) return Response.json({ ok: true });
          if (failure === "network") throw new Error("offline");
          return Response.json({ ok: false }, { status: 502 });
        }
        return running();
      };
      await act(async () => { root.render(composer()); });
      await click("Ask");
      await click("Stop");
      assert(document.querySelector('[data-phase="running"]'), "Failed stop was reported as stopped");
      await tickPoll();
      await click("Stop");
      assert(deletes === 2 && document.querySelector('[data-phase="failed"]')?.textContent?.includes("Stopped."), "Stop could not be retried");
    },
  ]),
  ["A moved or forbidden starting folder falls back to home", async () => {
    const paths: unknown[] = [];
    window.fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      paths.push(body.path);
      return body.path
        ? Response.json({ error: "Folder not found" }, { status: 404 })
        : Response.json({ path: "/home/test", home: "/home/test", parent: null, git: false, entries: [] });
    };
    let picked = "";
    await act(async () => { root.render(<FolderPicker value="/missing" onChange={(path) => { picked = path; }} />); });
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[aria-label^="Project folder:"]')!.dispatchEvent(new PointerEvent("pointerdown", { button: 0, pointerType: "mouse", bubbles: true }));
    });
    const choose = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((node) => node.textContent?.includes("Choose another folder"));
    assert(choose, "Folder dropdown did not open");
    await act(async () => { choose.click(); });
    assert(paths.length === 2 && paths[0] === "/missing" && paths[1] === undefined, `Home was not tried: ${JSON.stringify(paths)}`);
    await until(() => !button("Use this folder").disabled);
    await click("Use this folder");
    assert(picked === "/home/test", "Could not select the home folder");
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
window.setTimeout = nativeTimeout;
window.clearTimeout = nativeClearTimeout;
document.querySelector("h1")!.textContent = `${tests.length - failures}/${tests.length} passed`;
