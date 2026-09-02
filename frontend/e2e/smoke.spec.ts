import { expect, test } from "@playwright/test";

test("app shell renders core controls", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("#paperRef")).toBeVisible();
  await expect(page.locator("#pdfUri")).toBeVisible();
  await expect(page.locator("#openPaperBtn")).toBeVisible();
  await expect(page.locator("#closePaperBtn")).toBeVisible();
  await expect(page.locator("#sessionInfo")).toBeVisible();
  await expect(page.locator("#statusText")).toBeVisible();
  await expect(page.locator("#searchToggleBtn")).toBeVisible();
});
