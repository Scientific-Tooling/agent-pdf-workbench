import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

function samplePdf(): string {
  const filePath = path.join(os.tmpdir(), "apw-theme-e2e.pdf");
  const stream =
    "BT\n/F1 14 Tf\n18 TL\n60 720 Td\n(Attention Is All You Need - theme fixture) Tj\nT*\n" +
    "(The dominant sequence transduction models rely on attention.) Tj\nET\n";
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
  await page.goto("/");
  await page.locator("#paperRef").fill(paperRef);
  await page.locator("#pdfUri").fill(samplePdf());
  await page.locator("#openPaperBtn").click();
  await expect(page.locator("#statusText")).toContainText("session ready");
  await expect(page.locator("#textLayer span").first()).toBeVisible();
}

/** WCAG AA for normal text. */
const MIN_CONTRAST = 4.5;

async function contrastReport(page: Page) {
  return page.evaluate(() => {
    const parse = (value: string) =>
      value
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number);
    const luminance = ([r, g, b]: number[]) => {
      const channel = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const backgroundOf = (element: Element) => {
      let node: Element | null = element;
      while (node) {
        const bg = getComputedStyle(node).backgroundColor;
        if (bg && !bg.includes("rgba(0, 0, 0, 0)")) {
          return parse(bg);
        }
        node = node.parentElement;
      }
      return [255, 255, 255];
    };
    const ratioOf = (element: Element) => {
      const [light, dark] = [
        luminance(parse(getComputedStyle(element).color)),
        luminance(backgroundOf(element)),
      ].sort((a, b) => b - a);
      return (light + 0.05) / (dark + 0.05);
    };
    const targets: Record<string, string> = {
      status: "#statusText",
      paperRef: "#sessionPaperRef",
      recentRef: ".recent-ref",
      recentMeta: ".recent-meta",
      fieldLabel: ".panel.workspace label",
      countPill: ".count-pill",
      closeButton: "#closePaperBtn",
      fitWidth: "#fitWidthBtn",
      sectionHeading: ".panel.workspace h2",
    };
    const report: Record<string, number | null> = {};
    for (const [name, selector] of Object.entries(targets)) {
      const element = document.querySelector(selector);
      report[name] = element ? ratioOf(element) : null;
    }
    return report;
  });
}

for (const scheme of ["light", "dark"] as const) {
  test(`${scheme} theme keeps text legible`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openPaper(page, `p_e2e_contrast_${scheme}`);

    const report = await contrastReport(page);
    for (const [name, ratio] of Object.entries(report)) {
      expect(ratio, `${name} contrast in ${scheme}`).not.toBeNull();
      expect(ratio!, `${name} contrast in ${scheme}`).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }

    // The paper is the document, not chrome: it stays white in both themes.
    const pageBackground = await page
      .locator(".pdf-document-container")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(pageBackground).toBe("rgb(255, 255, 255)");
  });
}

test("an explicit theme choice overrides the OS and survives a reload", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openPaper(page, "p_e2e_theme_choice");

  const appBackground = () =>
    page.locator("body").evaluate((el) => getComputedStyle(el).backgroundColor);
  const lightBackground = await appBackground();

  // system -> light -> dark
  await page.locator("#themeBtn").click();
  await page.locator("#themeBtn").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const darkBackground = await appBackground();
  expect(darkBackground).not.toBe(lightBackground);

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await appBackground()).toBe(darkBackground);
});

test("icon-only controls carry accessible names", async ({ page }) => {
  await openPaper(page, "p_e2e_a11y_names");

  const iconButtons = [
    "#toggleControlsBtn",
    "#toggleWorkspaceBtn",
    "#prevBtn",
    "#nextBtn",
    "#zoomInBtn",
    "#zoomOutBtn",
    "#searchBtn",
    "#searchPrevBtn",
    "#searchNextBtn",
    "#themeBtn",
    "#shortcutsBtn",
  ];
  for (const selector of iconButtons) {
    const name = await page
      .locator(selector)
      .evaluate((el) => el.getAttribute("aria-label") ?? el.textContent?.trim() ?? "");
    expect(name.length, `${selector} has no accessible name`).toBeGreaterThan(2);
  }

  // The status line announces itself rather than changing silently.
  await expect(page.locator("#statusText")).toHaveAttribute("aria-live", "polite");
});

test("the shortcut list is reachable by keyboard and by button", async ({ page }) => {
  await openPaper(page, "p_e2e_shortcut_help");

  await page.locator("#pdfStage").click();
  await page.keyboard.press("?");
  await expect(page.locator("#shortcutHelp")).toBeVisible();
  await expect(page.locator("#shortcutHelp")).toContainText("Next page");

  await page.locator("#shortcutHelpClose").click();
  await expect(page.locator("#shortcutHelp")).toHaveCount(0);

  await page.locator("#shortcutsBtn").click();
  await expect(page.locator("#shortcutHelp")).toBeVisible();
});
