import { expect, test } from "@playwright/test";

const projectId = "11111111-1111-4111-8111-111111111111";
const missionId = "fixture-mission";
const mission = {
  id: missionId, title: "Fixture mission", prompt: "Build fixture", status: "completed", phase: "done",
  maxRetries: 1, runId: null, runAgentId: null, runStartedAt: null, lastError: null,
  tasks: [], artifacts: [], runUsage: [],
  result: { summary: "Fixture complete.", tasks: [], files: [], retries: 0, durationMs: 120000, qaPassed: 0, qaKnown: 0, filesMayBeIncomplete: false, cost: { cost: 0.12, priced: 1, total: 2 } },
};
const dashboard = {
  summary: { activeMissions: 7, completedTasks24h: 3 },
  counts: { plan: 0, spec: 0, code: 0, qa: 0, review: 0, done: 3 }, items: [], missions: [], activity: [],
  tokens: Array(14).fill(0), agentTokens: [], modelTokens: [], runtimeTokens: [], unsplitTokens: 0,
};

test.beforeEach(async ({ page }) => {
  const login = await page.request.post("/api/auth", { data: { passcode: "test-only-passcode" } });
  expect(login.ok()).toBeTruthy();
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth") return route.continue();
    if (path === "/api/dashboard") return route.fulfill({ json: dashboard });
    if (path === "/api/needs-you") return route.fulfill({ json: { items: [], count: 0 } });
    if (path === "/api/gateway/status") return route.fulfill({ json: { supabase: { status: "connected" }, defaultHermes: { ok: true }, cron: { healthy: true } } });
    if (path === "/api/agents/runtimes") return route.fulfill({ json: { ohmypi: { installed: true } } });
    if (path === "/api/projects") return route.fulfill({ json: { projects: [{ id: projectId, name: "Fixture", path: "/tmp/fixture", git: true, defaults: {} }] } });
    if (path === "/api/missions") return route.fulfill({ json: { missions: [mission] } });
    if (path === `/api/missions/${missionId}`) return route.fulfill({ json: { mission } });
    if (path === "/api/agents") return route.fulfill({ json: { agents: [] } });
    return route.fulfill({ json: {} });
  });
});

test("dashboard retains live data after a failed refresh", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("7", { exact: true })).toBeVisible();
  await page.route("**/api/dashboard", (route) => route.fulfill({ status: 503, json: { error: "unavailable" } }));
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByText(/Refresh failed:/)).toBeVisible();
  await expect(page.getByText("7", { exact: true })).toBeVisible();
  await expect(page.getByText(/Last updated/)).toBeVisible();
});

test("dashboard explains missing task completion history", async ({ page }) => {
  await page.route("**/api/dashboard", (route) => route.fulfill({ json: { ...dashboard, summary: { activeMissions: null, completedTasks24h: 3, completedTasksWithoutTime: 12 } } }));
  await page.goto("/");
  await expect(page.getByText("12 completed tasks have no recorded finish time.")).toBeVisible();
  const active = page.locator(".dashboard-stats").getByText("Active missions", { exact: true }).locator("..");
  await expect(active).toContainText("—");
});

test("dashboard shows an actionable placeholder when completion timestamps are unavailable", async ({ page }) => {
  await page.route("**/api/dashboard", (route) => route.fulfill({ json: { ...dashboard, summary: { activeMissions: 7, completedTasks24h: null } } }));
  await page.goto("/");
  await expect(page.getByText(/Completion time unavailable.*SQL migration/)).toBeVisible();
});

test("dashboard does not imply complete history when its coverage count fails", async ({ page }) => {
  await page.route("**/api/dashboard", (route) => route.fulfill({ json: { ...dashboard, summary: { activeMissions: 7, completedTasks24h: 3, completedTasksWithoutTime: null } } }));
  await page.goto("/");
  await expect(page.getByText("Historical completion coverage is unavailable.")).toBeVisible();
});

test("completed mission opens Result and explains partial cost coverage", async ({ page }) => {
  await page.goto(`/projects/${projectId}?mission=${missionId}`);
  await expect(page.getByRole("tab", { name: "Result" })).toHaveAttribute("data-state", "active");
  await expect(page.getByText("Fixture complete.")).toBeVisible();
  await expect(page.getByText(/\$0\.120000 · 1\/2 recorded runs priced/)).toBeVisible();
  await page.getByRole("tab", { name: /Board/ }).click();
  await expect(page.getByRole("tab", { name: /Board/ })).toHaveAttribute("data-state", "active");
});

test("project defaults preserve zero and false choices", async ({ page }) => {
  let saved: Record<string, unknown> | null = null;
  await page.route(`**/api/projects/${projectId}`, async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    saved = route.request().postDataJSON().defaults as Record<string, unknown>;
    return route.fulfill({ json: { defaults: saved } });
  });
  await page.goto(`/projects?project=${projectId}`);
  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Fixture settings" });
  await dialog.getByLabel("Max auto-fix retries").fill("0");
  await dialog.getByLabel("Work on a new branch").uncheck();
  await dialog.getByRole("button", { name: "Save defaults" }).click();
  await expect.poll(() => saved).toMatchObject({ max_retries: 0, isolate_workspace: false });
});

test("command palette searches and selects a mission", async ({ page }) => {
  await page.route("**/api/search?*", (route) => route.fulfill({ json: { results: [{ id: missionId, kind: "Missions", title: "Fixture mission", href: `/projects/${projectId}?mission=${missionId}` }] } }));
  await page.goto("/");
  await page.getByRole("button", { name: "Open command palette" }).click();
  await page.getByRole("combobox", { name: "Search workspace commands" }).fill("Fixture mission");
  await page.getByRole("option", { name: "Fixture mission" }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}\\?mission=${missionId}`));
  await expect(page.getByText("Fixture complete.")).toBeVisible();
});

test("task worktree reports link to the mission artifact", async ({ page }) => {
  await page.route("**/api/reviews/worktree", (route) => route.fulfill({ json: { reports: [{ id: "artifact-1", missionId, title: "Review fixture", createdAt: new Date().toISOString() }] } }));
  await page.goto("/reviews");
  await page.getByRole("tab", { name: "Reviews", exact: true }).click();
  const reports = page.getByRole("region", { name: "Task worktree reviews" });
  await expect(reports).toContainText("before their changes are merged");
  await expect(reports.getByRole("link", { name: "Review fixture" })).toHaveAttribute("href", `/missions/${missionId}?artifact=artifact-1`);
});

for (const width of [375, 768, 1024, 1440]) {
  test(`dashboard does not overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByText("7", { exact: true })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
  });
}
