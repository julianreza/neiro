import { expect, test } from "@playwright/test";

const id = "11111111-1111-4111-8111-111111111111";
const finding = { id: "f1", severity: "major", category: "security", file: "src/very-long-file-name-for-the-review-example.ts", line: 42, problem: "The reviewer needs a restricted workspace.", observation: "The current configuration allows writes.", consequence: "A review could change project files.", suggestion: "Use an isolated read-only workspace.", evidence: "const mode = 'unrestricted';", posted: false, dismissed: false };
const review = { id, repo: "example/project", prNumber: 12, prUrl: "https://github.com/example/project/pull/12", prTitle: "Example review", headRef: "feature", baseRef: "main", files: [], source: "manual", missionId: null, taskId: null, taskAttempt: null, agentId: null, model: null, runtime: null, runId: null, status: "done", verdict: "request_changes", summary: "Review the security issue before shipping.", design: { gate: "concern", problem: "Protect the workspace.", whyItMatters: "Reviews should be safe.", solutionFit: "The current isolation is incomplete." }, findings: [finding], rawOutput: "Review output", error: null, tokens: 0, postedAt: null, createdBy: null, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
const summary = { ...review, counts: { blocker: 0, major: 1, minor: 0, nit: 0 }, findingCount: 1 };

test.beforeEach(async ({ page }) => {
  const login = await page.request.post("/api/auth", { data: { passcode: "test-only-passcode" } });
  expect(login.ok()).toBeTruthy();
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth") return route.continue();
    if (path === "/api/reviews") return route.fulfill({ json: { reviews: [summary] } });
    if (path === `/api/reviews/${id}`) return route.fulfill({ json: { review } });
    if (path === "/api/reviews/pulls") return route.fulfill({ json: { pulls: [] } });
    if (path === "/api/reviews/repos") return route.fulfill({ json: { repos: [] } });
    if (path === "/api/needs-you") return route.fulfill({ json: { count: 0, items: [] } });
    if (path === "/api/agents") return route.fulfill({ json: { agents: [] } });
    return route.fulfill({ json: {} });
  });
});

for (const width of [375, 768, 1024, 1440]) {
  test(`review findings stay readable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/reviews?id=${id}`);
    await expect(page.getByRole("heading", { name: finding.problem })).toBeVisible();
    await expect(page.getByText(finding.observation)).toBeVisible();
    await expect(page.getByText(finding.consequence)).toBeVisible();
    await expect(page.getByText(finding.suggestion)).toBeVisible();
    const evidence = page.locator("details.cr-evidence-block");
    await expect(evidence).not.toHaveAttribute("open", "");
    await evidence.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(evidence).toHaveAttribute("open", "");
    await expect(page.getByText(finding.evidence)).toBeVisible();
    const design = page.locator("details.cr-design-disclosure");
    await expect(design).not.toHaveAttribute("open", "");
    await design.locator("summary").click();
    await expect(page.getByText("The current isolation is incomplete.")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  });
}
