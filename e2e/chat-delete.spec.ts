import { expect, test } from "@playwright/test";

test("delete a project chat from the list after confirmation", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  expect((await page.request.post("/api/auth", { data: { passcode: "test-only-passcode" } })).ok()).toBeTruthy();
  const message = { id: "project-chat", question: "Project question", answer: "Answer", status: "done", createdAt: "2026-01-01T00:00:00Z" };
  const chat = { id: message.id, title: message.question, projectId: "project-1", messages: [message], lastAt: message.createdAt, status: "done" };
  let deleted = false;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth") return route.continue();
    if (path === "/api/chats") return route.fulfill({ json: { chats: deleted ? [] : [chat] } });
    if (path === "/api/chats/project-chat" && route.request().method() === "DELETE") {
      deleted = true;
      return route.fulfill({ json: { ok: true } });
    }
    if (path === "/api/projects") return route.fulfill({ json: { projects: [{ id: "project-1", name: "Neiro" }] } });
    return route.fulfill({ json: {} });
  });
  await page.goto("/chat");
  const list = page.getByRole("navigation", { name: "Chats" });
  const row = list.locator(".chat-list-row").first();
  await expect(row.locator(".chat-item")).toBeVisible();
  await expect(row.getByRole("button", { name: "Delete Project question" })).toBeVisible();
  const chatButton = await row.locator(".chat-item").boundingBox();
  const deleteButton = await row.getByRole("button", { name: "Delete Project question" }).boundingBox();
  expect(deleteButton?.x).toBeGreaterThanOrEqual((chatButton?.x ?? 0) + (chatButton?.width ?? 0) - 1);
  expect(deleteButton?.y).toBeLessThan((chatButton?.y ?? 0) + (chatButton?.height ?? 0));
  await list.getByRole("button", { name: "Delete Project question" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/All 1 message/)).toBeVisible();
  await dialog.getByRole("button", { name: "Keep it" }).click();
  expect(deleted).toBe(false);
  await list.getByRole("button", { name: "Delete Project question" }).click();
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(list.getByRole("button", { name: "Delete Project question" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "New chat" })).toBeVisible();
  expect(deleted).toBe(true);
});
