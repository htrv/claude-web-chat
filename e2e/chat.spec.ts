import { test, expect, type Page } from "@playwright/test";

const BASE = "http://localhost:4000";
const TEST_USER = "testuser";
const TEST_PASS = "testpass123";

// Visible textarea (not aria-hidden)
const TEXTAREA = "textarea:not([aria-hidden])";

async function loginViaApi(page: Page) {
  const res = await page.request.post(`${BASE}/api/auth/login`, {
    data: { username: TEST_USER, password: TEST_PASS },
  });
  expect(res.ok(), `Login failed: ${await res.text()}`).toBeTruthy();
  const body = await res.json();
  expect(body.requires_2fa).toBe(false);
  expect(body.access_token).toBeTruthy();
  await page.goto(BASE);
  await page.evaluate((t: string) => localStorage.setItem("token", t), body.access_token);
  await page.goto(BASE);
  // Wait for app to load
  await expect(page.locator(".mantine-NavLink-root").first()).toBeVisible({ timeout: 8000 });
}

// ─── Auth ────────────────────────────────────────────────────────────────────

test.describe("Auth", () => {
  test("login page shows username and password fields", async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await expect(page.locator('input[placeholder="username"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test("wrong credentials show error", async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await page.locator('input[placeholder="username"]').fill("nobody");
    await page.locator('input[type="password"]').fill("wrongpass");
    await page.locator('button[type="submit"]').click();
    await expect(page.getByText(/invalid|неверн|credentials/i)).toBeVisible({ timeout: 5000 });
  });

  test("valid user logs in without 2FA and sees chat page", async ({ page }) => {
    await loginViaApi(page);
    await expect(page).toHaveURL(`${BASE}/`);
    await expect(page.getByText("Claude Chat")).toBeVisible();
  });
});

// ─── Chat UI ─────────────────────────────────────────────────────────────────

test.describe("Chat UI", () => {
  test.beforeEach(async ({ page }) => {
    await loginViaApi(page);
  });

  test("first chat auto-selected on load", async ({ page }) => {
    const activeChat = page.locator(".mantine-NavLink-root[data-active='true']");
    await expect(activeChat).toBeVisible({ timeout: 8000 });
  });

  test("input area is visible", async ({ page }) => {
    await expect(page.locator(TEXTAREA)).toBeVisible();
  });

  test("new chat button creates a chat", async ({ page }) => {
    const before = await page.locator(".mantine-NavLink-root").count();
    await page.getByRole("button", { name: /новый чат/i }).click();
    await expect(page.locator(".mantine-NavLink-root")).toHaveCount(before + 1, { timeout: 5000 });
  });

  test("typing message works and clears after Enter", async ({ page }) => {
    const ta = page.locator(TEXTAREA);
    await ta.fill("тест playwright");
    await expect(ta).toHaveValue("тест playwright");
    await ta.press("Enter");
    await expect(ta).toHaveValue("", { timeout: 3000 });
  });

  test("sent message appears in chat immediately (optimistic update)", async ({ page }) => {
    const ta = page.locator(TEXTAREA);
    await ta.fill("playwright проверка отправки");
    await ta.press("Enter");
    await expect(page.getByText("playwright проверка отправки")).toBeVisible({ timeout: 5000 });
  });

  test("input disabled during streaming, re-enabled after response", async ({ page }) => {
    const ta = page.locator(TEXTAREA);
    await ta.fill("скажи одно слово: да");
    await ta.press("Enter");

    // Should be disabled while Claude thinks
    await expect(ta).toBeDisabled({ timeout: 5000 });

    // Should re-enable after response (up to 30s for Claude)
    await expect(ta).not.toBeDisabled({ timeout: 30000 });
  });

  test("assistant response appears after sending", async ({ page }) => {
    const ta = page.locator(TEXTAREA);
    await ta.fill("скажи: ок");
    await ta.press("Enter");

    // User bubble appears immediately
    await expect(page.getByText("скажи: ок")).toBeVisible({ timeout: 5000 });

    // Assistant markdown bubble appears within 30s
    const assistantBubble = page.locator(".markdown-body").first();
    await expect(assistantBubble).toBeVisible({ timeout: 30000 });
    const text = await assistantBubble.textContent();
    expect(text?.trim().length).toBeGreaterThan(0);
  });

  test("switching chats does not reset messages", async ({ page }) => {
    // Send a message in first chat
    const ta = page.locator(TEXTAREA);
    await ta.fill("сообщение в первом чате");
    await ta.press("Enter");
    await expect(page.getByText("сообщение в первом чате")).toBeVisible({ timeout: 5000 });

    // Create and switch to new chat
    await page.getByRole("button", { name: /новый чат/i }).click();
    const chats = page.locator(".mantine-NavLink-root");
    await expect(chats).toHaveCount(3, { timeout: 5000 });

    // Switch back to first chat (index 1 since new chat goes to top)
    await chats.nth(1).click();
    // Message should still be there
    await expect(page.getByText("сообщение в первом чате")).toBeVisible({ timeout: 5000 });
  });
});
