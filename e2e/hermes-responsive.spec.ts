import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"]) {
  for (const width of [375, 768, 1024, 1440]) {
    test(`Gateway metadata fits at ${width}px in ${theme} mode with reduced motion`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme === "dark" ? "dark" : "light", reducedMotion: "reduce" });
      await page.addInitScript((value) => localStorage.setItem("theme", value), theme);
      expect((await page.request.post("/api/auth", { data: { passcode: "test-only-passcode" } })).ok()).toBeTruthy();
      await page.route("**/api/**", (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === "/api/auth") return route.continue();
        if (path === "/api/agents/models") return route.fulfill({ json: { models: [{ id: "provider/very-long-model-name-with-a-variant-high", provider: "provider", providerName: "Provider", pricing: { input: 0, output: 2, cacheRead: 0.5 }, supportsVision: true }] } });
        if (path === "/api/gateway/status") return route.fulfill({ json: { checkedAt: new Date().toISOString(), supabase: { status: "connected" }, defaultHermes: { ok: true }, cron: { healthy: true } } });
        if (path === "/api/agents/runtimes") return route.fulfill({ json: { ohmypi: { installed: false, models: [] } } });
        return route.fulfill({ json: {} });
      });
      await page.goto("/gateway");
      await page.locator(".catalog-source > summary").filter({ hasText: "Provider" }).click();
      await expect(page.getByText(/USD \/ 1M/)).toBeVisible();
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    });
  }
}
