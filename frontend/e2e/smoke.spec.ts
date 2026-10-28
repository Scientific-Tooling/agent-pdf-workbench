import { expect, test } from "@playwright/test";

test("app shell renders core controls", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("#paperRef")).toBeVisible();
  await expect(page.locator("#pdfUri")).toBeVisible();
  await expect(page.locator("#openPaperBtn")).toBeVisible();
  await expect(page.locator("#closePaperBtn")).toHaveCount(0);
  await expect(page.locator("#sessionInfo")).toHaveText("—");
  await expect(page.locator("#statusText")).toBeVisible();
  await expect(page.locator("#searchInput")).toHaveCount(0);
  await expect(page.locator("#findInDocumentBtn")).toBeDisabled();
  await expect(page.locator("#fitWidthBtn")).toBeVisible();
});
