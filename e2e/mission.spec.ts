import { expect, test } from "@playwright/test";

const projectId = "11111111-1111-4111-8111-111111111111";

test.beforeEach(async ({ page }) => {
  const login = await page.request.post("/api/auth", { data: { passcode: "test-only-passcode" } });
  expect(login.ok()).toBeTruthy();
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/auth") return route.continue();
    if (url.pathname === "/api/projects") return route.fulfill({ json: { projects: [{ id: projectId, name: "Fixture", path: "/tmp/fixture", git: true, defaults: {}, createdAt: "2026-01-01T00:00:00Z" }] } });
    if (url.pathname === "/api/missions/preflight") return route.fulfill({ json: { checkedAt: new Date().toISOString(), checks: [{ id: "qa", status: "warning", reason: "No QA agent; this verification will be skipped.", href: "/agents" }] } });
    if (url.pathname === "/api/missions" && route.request().method() === "POST") return route.fulfill({ json: { mission: { id: "fixture-mission" } } });
    if (url.pathname === "/api/missions") return route.fulfill({ json: { missions: [] } });
    if (url.pathname === "/api/questions") return route.fulfill({ json: { questions: [] } });
    if (url.pathname === "/api/needs-you") return route.fulfill({ json: { items: [], count: 0 } });
    return route.fulfill({ json: {} });
  });
  await page.goto(`/projects?project=${projectId}`);
});

test("template opens the selected mission mode and protects a draft", async ({ page }) => {
  await page.getByRole("button", { name: "Implement feature" }).click();
  await expect(page.getByRole("radio", { name: /Build something new/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("#mission-prompt")).toHaveValue(/Acceptance criteria/);
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Fix failing tests" }).click();
  await expect(page.getByRole("radio", { name: /Build something new/ })).toHaveAttribute("aria-checked", "true");
});

test("warning requires confirmation before creating a mission", async ({ page }) => {
  await page.getByRole("button", { name: "Implement feature" }).click();
  await page.locator("#mission-prompt").fill("Build a fixture");
  let created = false;
  page.on("request", (request) => { if (new URL(request.url()).pathname === "/api/missions" && request.method() === "POST") created = true; });
  await page.getByRole("button", { name: "Launch mission" }).click();
  const dialog = page.getByRole("dialog", { name: "Mission readiness" });
  await expect(dialog).toContainText("No QA agent");
  expect(created).toBe(false);
  await expect(dialog.getByRole("link", { name: "Open" })).toHaveAttribute("href", "/agents");
  await dialog.getByRole("button", { name: "Continue without verification" }).click();
  await expect.poll(() => created).toBe(true);
});
