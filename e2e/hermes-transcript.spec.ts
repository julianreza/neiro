import { expect, test } from "@playwright/test";

test("live log opens the originating subagent session and compacted history", async ({ page }) => {
  expect((await page.request.post("/api/auth", { data: { passcode: "test-only-passcode" } })).ok()).toBeTruthy();
  let query = "";
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/auth") return route.continue();
    if (url.pathname === "/api/runs/active") return route.fulfill({ json: { runs: [{ missionId: "m1", missionTitle: "Mission", taskId: "t1", taskTitle: "Task", stage: "Coding", runId: "run-1", agentId: "origin-agent", agentName: "Forge", tokens: 0, startedAt: null, needsApproval: false }] } });
    if (url.pathname === "/api/hermes/runs/run-1/events") return route.fulfill({ contentType: "text/event-stream", body: 'data: {"type":"subagent.start","delegation_id":"d1","child_session_id":"child-1"}\n\n' });
    if (url.pathname === "/api/hermes/sessions/child-1/messages") {
      query = url.search;
      return route.fulfill({ json: { messages: [{ role: "assistant", content: url.searchParams.get("include_compacted") === "true" ? "Old context" : "Current context" }] } });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto("/live");
  await page.getByRole("button", { name: "View transcript" }).click();
  const dialog = page.getByRole("dialog", { name: "Subagent transcript" });
  await expect(dialog.getByText("Current context")).toBeVisible();
  await expect.poll(() => query).toContain("agentId=origin-agent");
  await dialog.getByLabel("Include compacted history").check();
  await expect(dialog.getByText("Old context")).toBeVisible();
  expect(query).toContain("include_compacted=true");
});
