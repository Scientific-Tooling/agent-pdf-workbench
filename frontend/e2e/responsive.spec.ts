import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

// A page wide enough that a fixed zoom would overflow a narrow column.
function sampleWidePdf(): string {
  const filePath = path.join(os.tmpdir(), "apw-responsive-e2e.pdf");
  const stream =
    "BT\n/F1 16 Tf\n20 TL\n60 720 Td\n(Attention Is All You Need — responsive fixture) Tj\nT*\n" +
    "(The dominant sequence transduction models are based on complex networks.) Tj\nT*\n" +
    "(We propose the Transformer, dispensing with recurrence entirely.) Tj\nET\n";
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    `5 0 obj\n<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}endstream\nendobj\n`,
  ];
  const chunks: string[] = ["%PDF-1.4\n"];
  const offsets = [0];
  let bytePos = Buffer.byteLength(chunks[0], "utf8");
  for (const obj of objects) {
    offsets.push(bytePos);
    chunks.push(obj);
    bytePos += Buffer.byteLength(obj, "utf8");
  }
  const xrefOffset = bytePos;
  const xref = [`xref\n0 ${objects.length + 1}\n`, "0000000000 65535 f \n"];
  for (let i = 1; i < offsets.length; i += 1) {
    xref.push(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
  }
  xref.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`);
  xref.push(`startxref\n${xrefOffset}\n%%EOF\n`);
  chunks.push(xref.join(""));
  fs.writeFileSync(filePath, Buffer.from(chunks.join(""), "utf8"));
  return filePath;
}

async function openPaper(page: Page, paperRef: string): Promise<void> {
  const pdfPath = sampleWidePdf();
  await page.goto("/");
  await page.locator("#paperRef").fill(paperRef);
  await page.locator("#pdfUri").fill(pdfPath);
  await page.locator("#openPaperBtn").click();
  await expect(page.locator("#statusText")).toContainText("session ready");
  await expect(page.locator("#textLayer span").first()).toBeVisible();
}

async function stageFit(page: Page) {
  return page.evaluate(() => {
    const stage = document.querySelector("#pdfStage");
    const canvas = document.querySelector("#pdfCanvas");
    if (!stage || !canvas) {
      return null;
    }
    return {
      canvasWidth: canvas.getBoundingClientRect().width,
      stageWidth: stage.clientWidth,
      documentScrollsSideways:
        document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });
}

// The document is the point of the app: panels give way to it, never the reverse.
for (const width of [1512, 1280, 1024, 768]) {
  test(`the page fits its column at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openPaper(page, `p_e2e_fit_${width}`);

    const fit = await stageFit(page);
    expect(fit).not.toBeNull();
    expect(fit!.canvasWidth).toBeLessThanOrEqual(fit!.stageWidth);
    expect(fit!.documentScrollsSideways).toBe(false);

    // Fit Width is the control that recovers from any zoom, so it is never the
    // one that disappears.
    await expect(page.locator("#fitWidthBtn")).toBeVisible();
    await expect(page.locator("#zoomInBtn")).toBeVisible();
    await expect(page.locator("#zoomOutBtn")).toBeVisible();
    await expect(page.locator("#prevBtn")).toBeVisible();
    await expect(page.locator("#nextBtn")).toBeVisible();

    // "Visible" is not enough for a text field: it was being flex-squeezed to a
    // sliver while still passing a visibility check.
    const searchWidth = await page
      .locator("#searchInput")
      .evaluate((el) => el.getBoundingClientRect().width);
    expect(searchWidth).toBeGreaterThanOrEqual(120);
  });
}

test("resizing the window keeps the page fitted until the reader zooms", async ({ page }) => {
  await page.setViewportSize({ width: 1512, height: 900 });
  await openPaper(page, "p_e2e_refit");

  await page.setViewportSize({ width: 1024, height: 900 });
  await expect
    .poll(async () => {
      const fit = await stageFit(page);
      return fit ? fit.canvasWidth <= fit.stageWidth : false;
    })
    .toBe(true);

  // A manual zoom is a decision: the page stops following the window.
  const zoomedWidth = await page.evaluate(async () => {
    for (let i = 0; i < 4; i += 1) {
      (document.querySelector("#zoomInBtn") as HTMLButtonElement).click();
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    return document.querySelector("#pdfCanvas")!.getBoundingClientRect().width;
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(400);
  const afterResize = await page.evaluate(
    () => document.querySelector("#pdfCanvas")!.getBoundingClientRect().width,
  );
  expect(Math.abs(afterResize - zoomedWidth)).toBeLessThan(2);

  // Pressing Fit Width hands control back to the window.
  await page.locator("#fitWidthBtn").click();
  await expect
    .poll(async () => {
      const fit = await stageFit(page);
      return fit ? fit.canvasWidth <= fit.stageWidth : false;
    })
    .toBe(true);
});

test("panels can be folded away and the choice survives a reload", async ({ page }) => {
  await page.setViewportSize({ width: 1512, height: 900 });
  await openPaper(page, "p_e2e_panels");

  await expect(page.locator(".panel.controls")).toBeVisible();
  const wideCanvas = (await stageFit(page))!.canvasWidth;

  await page.locator("#toggleControlsBtn").click();
  await expect(page.locator(".panel.controls")).toBeHidden();

  // Folding a panel hands its width to the document rather than leaving a gap.
  await expect.poll(async () => (await stageFit(page))!.canvasWidth).toBeGreaterThan(wideCanvas);

  await page.reload();
  await expect(page.locator(".panel.controls")).toBeHidden();
});

test("below the narrow breakpoint panels open over the document, not beside it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 820, height: 900 });
  await openPaper(page, "p_e2e_drawers");

  // Both panels start folded, so the reading surface owns the window.
  await expect(page.locator(".panel.controls")).toBeHidden();
  await expect(page.locator(".panel.workspace")).toBeHidden();

  await page.locator("#toggleWorkspaceBtn").click();
  await expect(page.locator(".panel.workspace")).toBeVisible();

  // Opening it must not squeeze the page.
  const fit = await stageFit(page);
  expect(fit!.canvasWidth).toBeLessThanOrEqual(fit!.stageWidth);
  expect(fit!.documentScrollsSideways).toBe(false);

  await page.locator(".panel-backdrop").click();
  await expect(page.locator(".panel.workspace")).toBeHidden();
});

test("keyboard shortcuts reach the search field", async ({ page }) => {
  await page.setViewportSize({ width: 1512, height: 900 });
  await openPaper(page, "p_e2e_search_shortcuts");

  // `f` used to focus an input that only existed while the old overlay was
  // open, so it silently did nothing.
  await page.locator("#pdfStage").click();
  await page.keyboard.press("f");
  await expect(page.locator("#searchInput")).toBeFocused();

  await page.locator("#pdfStage").click();
  await page.keyboard.press("/");
  await expect(page.locator("#searchInput")).toBeFocused();

  // Ctrl+F reaches it even from another field, which is what a reader expects.
  await page.locator("#pageJumpInput").click();
  await page.keyboard.press("Control+f");
  await expect(page.locator("#searchInput")).toBeFocused();
});

test("opening a paper never folds a panel out from under the reader", async ({ page }) => {
  // A default that folds the session panel on open hides Close Session behind a
  // toggle the reader never asked for; at this width the document does not need
  // the space.
  await page.setViewportSize({ width: 1280, height: 900 });
  await openPaper(page, "p_e2e_no_surprise_fold");

  await expect(page.locator("#closePaperBtn")).toBeVisible();
  await expect(page.locator(".panel.workspace")).toBeVisible();

  const fit = await stageFit(page);
  expect(fit!.canvasWidth).toBeLessThanOrEqual(fit!.stageWidth);
});
