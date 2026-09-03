import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

// A page wide enough that a fixed zoom would overflow a narrow column.
function sampleWidePdf(): string {
  const filePath = path.join(os.tmpdir(), "apw-responsive-e2e.pdf");
  const lines = [
    "Attention Is All You Need - responsive fixture",
    "The dominant sequence transduction models are based on complex networks",
    "that include an encoder and a decoder connected through attention.",
    "We propose the Transformer, dispensing with recurrence entirely and",
    "relying instead on scaled dot-product attention over the whole sequence.",
    "Experiments on translation tasks show the model is superior in quality",
    "while being more parallelizable and requiring less time to train.",
  ];
  const stream = `BT\n/F1 14 Tf\n20 TL\n60 720 Td\n${lines
    .map((line) => `(${line}) Tj\nT*`)
    .join("\n")}\nET\n`;
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
    const documentContainer = document.querySelector(".pdf-document-container");
    if (!stage || !canvas || !documentContainer) {
      return null;
    }
    const stageRect = stage.getBoundingClientRect();
    const documentRect = documentContainer.getBoundingClientRect();
    const computedStyle = window.getComputedStyle(stage);
    const paddingLeft = Number.parseFloat(computedStyle.paddingLeft) || 0;
    const paddingRight = Number.parseFloat(computedStyle.paddingRight) || 0;
    const stageContentLeft = stageRect.left + paddingLeft;
    const stageContentWidth = stage.clientWidth - paddingLeft - paddingRight;
    const stageContentRight = stageContentLeft + stageContentWidth;
    return {
      canvasWidth: canvas.getBoundingClientRect().width,
      stageWidth: stage.clientWidth,
      stageContentWidth,
      documentFitsContent:
        documentRect.left >= stageContentLeft - 1 && documentRect.right <= stageContentRight + 1,
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
    expect(fit!.canvasWidth).toBeLessThanOrEqual(fit!.stageContentWidth + 1);
    expect(fit!.documentFitsContent).toBe(true);
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
      return fit ? fit.documentFitsContent : false;
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
      return fit ? fit.documentFitsContent : false;
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
  expect(fit!.canvasWidth).toBeLessThanOrEqual(fit!.stageContentWidth + 1);
  expect(fit!.documentFitsContent).toBe(true);
  expect(fit!.documentScrollsSideways).toBe(false);

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const toolbar = document.querySelector(".reader-toolbar");
        const panel = document.querySelector(".panel.workspace");
        const backdrop = document.querySelector(".panel-backdrop");
        if (!toolbar || !panel || !backdrop) {
          return false;
        }
        const toolbarBottom = toolbar.getBoundingClientRect().bottom;
        return (
          panel.getBoundingClientRect().top >= toolbarBottom - 1 &&
          backdrop.getBoundingClientRect().top >= toolbarBottom - 1
        );
      }),
    )
    .toBe(true);

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
  expect(fit!.canvasWidth).toBeLessThanOrEqual(fit!.stageContentWidth + 1);
  expect(fit!.documentFitsContent).toBe(true);
});

test("the sidebar reports the paper, not the plumbing", async ({ page }) => {
  await page.setViewportSize({ width: 1512, height: 900 });
  await openPaper(page, "p_e2e_sidebar_hierarchy");

  // The session card collapses to a line: which paper, its state, and a way out.
  await expect(page.locator("#sessionPaperRef")).toHaveText("p_e2e_sidebar_hierarchy");
  await expect(page.locator("#closePaperBtn")).toBeVisible();

  // The form and the raw session id are available, but not in the way.
  await expect(page.locator("#paperRef")).toBeHidden();
  await page.locator("#sessionDetailsToggle").click();
  await expect(page.locator("#paperRef")).toBeVisible();
  await expect(page.locator("#sessionInfo")).toContainText("ps_");

  // A recent row names the paper and the file, never the wrapped absolute path.
  const recentText = await page.locator("#recentList li").first().innerText();
  expect(recentText).toContain("p_e2e_sidebar_hierarchy");
  expect(recentText).toContain("apw-responsive-e2e.pdf");
  expect(recentText).not.toContain("/tmp/");
  await expect(page.locator("#recentList li").first()).toHaveAttribute("title", /\.pdf$/);

  // A document with no outline costs no card.
  await expect(page.locator("#outlineList")).toHaveCount(0);

  // Section headers report what they hold.
  await expect(page.locator(".count-pill").first()).toHaveText("0");
});

test("a long quote is clamped in the list but shown in full when selected", async ({ page }) => {
  await page.setViewportSize({ width: 1512, height: 950 });
  // Annotations belong to the paper, so a fixed ref would accumulate across runs.
  await openPaper(page, `p_e2e_quote_clamp_${Date.now()}`);

  async function annotate(comment: string, fromSpan: number, toSpan: number): Promise<void> {
    // Fill the comment first: focusing an input clears the document selection.
    await page.locator("#annotationCommentInput").fill(comment);
    await page.evaluate(
      ({ fromSpan, toSpan }) => {
        const spans = document.querySelectorAll("#textLayer span");
        const range = document.createRange();
        range.setStart(spans[fromSpan].firstChild!, 0);
        range.setEnd(spans[toSpan].firstChild!, spans[toSpan].firstChild!.textContent!.length);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
      },
      { fromSpan, toSpan },
    );
    await page.locator("#highlightBtn").click();
  }

  await annotate("first, will be pushed out of selection", 0, 5);
  await expect(page.locator("#annotationList li.selected")).toHaveCount(1);
  await annotate("second, keeps the selection", 1, 1);
  await expect(page.locator("#annotationList li")).toHaveCount(2);

  const heights = await page.evaluate(() => {
    const measure = (el: Element | null) =>
      el ? { scroll: el.scrollHeight, client: el.clientHeight } : null;
    return {
      unselected: measure(document.querySelector("#annotationList li:not(.selected) .quote-text")),
      selected: measure(document.querySelector("#annotationList li.selected .quote-text")),
    };
  });

  // A multi-line quote in the list is an excerpt; the selected one is complete.
  expect(heights.unselected!.scroll).toBeGreaterThan(heights.unselected!.client);
  expect(heights.selected!.scroll).toBeLessThanOrEqual(heights.selected!.client + 1);
});
