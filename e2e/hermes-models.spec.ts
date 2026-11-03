import { expect, test } from "@playwright/test";

test("Gateway refreshes model metadata without hiding a previous catalog on failure", async ({ page }) => {
  expect((await page.request.post("/api/auth", { data: { passcode: "test-only-passcode" } })).ok()).toBeTruthy();
  let refreshed = false;
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/auth") return route.continue();
    if (url.pathname === "/api/agents/models") {
      if (url.searchParams.get("refresh") === "1") { refreshed = true; return route.fulfill({ status: 503, json: { error: "Unavailable" } }); }
      return route.fulfill({ json: { models: [{ id: "alpha/model", provider: "alpha", providerName: "Alpha", pricing: { input: 0, output: 2, cacheRead: 0.5 }, supportsVision: true, supportsReasoning: false }] } });
    }
    if (url.pathname === "/api/gateway/status") return route.fulfill({ json: { checkedAt: new Date().toISOString(), supabase: { status: "connected" }, defaultHermes: { ok: true }, cron: { healthy: true } } });
    if (url.pathname === "/api/agents/runtimes") return route.fulfill({ json: { ohmypi: { installed: false, models: [] } } });
    if (url.pathname === "/api/agents/capabilities") return route.fulfill({ json: { agents: [] } });
    return route.fulfill({ json: {} });
  });
  await page.goto("/gateway");
  await page.locator("summary").filter({ hasText: "Alpha" }).click();
  await expect(page.getByText(/USD \/ 1M: in 0, out 2, cache 0.5/)).toBeVisible();
  await page.getByRole("button", { name: "Refresh models" }).click();
  await expect.poll(() => refreshed).toBe(true);
  await expect(page.getByText(/USD \/ 1M: in 0, out 2, cache 0.5/)).toBeVisible();
  await expect(page.getByText(/Refresh failed/).first()).toBeVisible();
});
