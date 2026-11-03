import { expect, test } from "@playwright/test";

for (const width of [375, 768, 1024, 1440]) {
  test(`chat displays a streamed answer at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    expect((await page.request.post("/api/auth", { data: { passcode: "test-only-passcode" } })).ok()).toBeTruthy();
    const message = { id: "run-stream", agentId: "agent-1", agentName: "Oracle", question: "Hello", answer: "", status: "running", createdAt: "2026-01-01T00:00:00Z" };
    const chat = { id: message.id, title: message.question, projectId: null, messages: [message], lastAt: message.createdAt, status: "running" };
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/auth") return route.continue();
      if (path === "/api/chats") return route.fulfill({ json: { chats: [chat] } });
      if (path === "/api/projects") return route.fulfill({ json: { projects: [] } });
      if (path === "/api/hermes/runs/run-stream/events") return route.fulfill({ contentType: "text/event-stream", body: 'data: {"type":"message.delta","delta":"Checking files"}\n\ndata: {"type":"message.interim","text":"Checking files","already_streamed":true}\n\ndata: {"type":"message.delta","delta":"Streaming"}\n\ndata: {"type":"message.delta","delta":" answer"}\n\n' });
      if (path === "/api/ask/run-stream") return route.fulfill({ json: { status: "running", approvals: [] } });
      return route.fulfill({ json: {} });
    });
    await page.goto("/chat");
    await expect(page.getByText("Streaming answer")).toBeVisible();
    await expect(page.getByText("Progress: Checking files")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test("reconnect uses the cursor and ignores duplicate replay", async ({ page }) => {
  const errors = [""];
  errors.pop();
  page.on("pageerror", (error) => errors.push(error.message));
  expect((await page.request.post("/api/auth", { data: { passcode: "test-only-passcode" } })).ok()).toBeTruthy();
  const message = { id: "run-resume", agentId: "agent-1", agentName: "Oracle", question: "Resume?", answer: "", status: "running", createdAt: "2026-01-01T00:00:00Z" };
  let allowReplay = false;
  let cursor;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth") return route.continue();
    if (path === "/api/chats") return route.fulfill({ json: { chats: [{ id: message.id, title: message.question, projectId: null, messages: [message], lastAt: message.createdAt, status: "running" }] } });
    if (path === "/api/projects") return route.fulfill({ json: { projects: [] } });
    if (path === "/api/hermes/runs/run-resume/events") {
      if (allowReplay) cursor = route.request().headers()["last-event-id"];
      const first = 'id: 0\ndata: {"type":"message.delta","delta":"Hello"}\n\n';
      const second = 'id: 1\ndata: {"type":"message.delta","delta":" again"}';
      return route.fulfill({ contentType: "text/event-stream", body: allowReplay ? first + second : first });
    }
    if (path === "/api/ask/run-resume") return route.fulfill({ json: { status: "running", approvals: [] } });
    return route.fulfill({ json: {} });
  });
  await page.goto("/chat?chat=run-resume");
  await expect(page.getByText("Hello", { exact: true })).toBeVisible();
  allowReplay = true;
  await page.getByRole("button", { name: "Reconnect" }).click();
  await expect(page.getByText("Hello again", { exact: true })).toBeVisible();
  expect(cursor).toBe("0");
  expect(errors.filter((message) => /hydration/i.test(message))).toEqual([]);
});

for (const mode of ["direct", "room"]) {
  test(`${mode} bot reply streams from its existing run`, async ({ page }) => {
    const errors = [""];
    errors.pop();
    page.on("pageerror", (error) => errors.push(error.message));
    expect((await page.request.post("/api/auth", { data: { passcode: "test-only-passcode" } })).ok()).toBeTruthy();
    const bot = { id: "bot-1", name: "Oracle", handle: "oracle", role: "Q&A", stage: "ask", section: "Team", runtime: "hermes", activeRun: true, canonicalSessionId: "session", lastMessage: null, lastAt: null };
    const message = { id: "run-bot", agentId: bot.id, agentName: bot.name, question: "Question", answer: "", status: "running", createdAt: "2026-01-01T00:00:00Z" };
    const room = { id: "room-1", name: "Review room", memberAgentIds: [bot.id], needsYou: false, driver: { round: 1, paused: [], claim: { agentId: bot.id, runId: "run-room" } } };
    await page.route("**/api/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/auth") return route.continue();
      if (path === "/api/bots") return route.fulfill({ json: { bots: [bot] } });
      if (path === "/api/bots/bot-1") return route.fulfill({ json: { messages: [message] } });
      if (path === "/api/rooms") return route.fulfill({ json: { rooms: [room] } });
      if (path === "/api/rooms/room-1") return route.fulfill({ json: { room, messages: [] } });
      if (path === `/api/hermes/runs/${mode === "direct" ? "run-bot" : "run-room"}/events`) return route.fulfill({ contentType: "text/event-stream", body: 'id: 0\ndata: {"type":"message.delta","delta":"Bot draft"}\n\n' });
      if (path === "/api/ask/run-bot") return route.fulfill({ json: { status: "running" } });
      return route.fulfill({ json: {} });
    });
    await page.goto(mode === "direct" ? "/bots?bot=bot-1" : "/bots?room=room-1");
    await expect(page.getByText("Bot draft", { exact: true })).toBeVisible();
    expect(errors.filter((message) => /hydration/i.test(message))).toEqual([]);
  });
}
