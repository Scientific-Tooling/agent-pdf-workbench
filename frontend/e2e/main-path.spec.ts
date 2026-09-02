import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";

function buildSimplePdf(lines: string[]): Buffer {
  const escaped = lines.map((line) =>
    line.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)"),
  );
  const textOps = escaped
    .map((line, index) => `${index === 0 ? "72 760 Td" : "0 -28 Td"}\n(${line}) Tj`)
    .join("\n");
  const stream = `BT\n/F1 18 Tf\n${textOps}\nET\n`;

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
  const xrefLines: string[] = [];
  xrefLines.push(`xref\n0 ${objects.length + 1}\n`);
  xrefLines.push("0000000000 65535 f \n");
  for (let i = 1; i < offsets.length; i += 1) {
    xrefLines.push(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
  }
  xrefLines.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`);
  xrefLines.push(`startxref\n${xrefOffset}\n%%EOF\n`);
  chunks.push(xrefLines.join(""));
  return Buffer.from(chunks.join(""), "utf8");
}

function ensureSamplePdf(): string {
  const filePath = path.join(os.tmpdir(), "apw-playwright-e2e.pdf");
  const pdf = buildSimplePdf([
    "Attention is all you need for this e2e path.",
    "We annotate this sentence and save linked notes.",
  ]);
  fs.writeFileSync(filePath, pdf);
  return filePath;
}

async function selectFirstTextSpan(page: import("@playwright/test").Page): Promise<void> {
  await expect(page.locator("#textLayer span").first()).toBeVisible();
  await page.evaluate(() => {
    const span = document.querySelector("#textLayer span");
    if (!span || !span.firstChild || span.firstChild.nodeType !== Node.TEXT_NODE) {
      throw new Error("Missing selectable text span in text layer");
    }
    const node = span.firstChild;
    const textLength = node.textContent?.length ?? 0;
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, Math.min(textLength, 20));
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  });
}

test("reader main path: open -> search -> annotate -> note -> export", async ({
  page,
  request,
}) => {
  const pdfPath = ensureSamplePdf();

  await page.goto("/");
  await page.locator("#paperRef").fill("p_e2e_main_path");
  await page.locator("#pdfUri").fill(pdfPath);
  const openPaperResponse = page.waitForResponse((response) => {
    return response.url().includes("/api/open-paper") && response.request().method() === "POST";
  });
  await page.locator("#openPaperBtn").click();
  const openedSession = (await (await openPaperResponse).json()) as { id: string };
  const sessionId = openedSession.id;

  await expect(page.locator("#statusText")).toContainText("session ready");
  await expect(page.locator("#sessionInfo")).toHaveText(sessionId);
  await expect(page.locator("#textLayer span").first()).toBeVisible();

  await page.locator("#searchInput").fill("attention");
  await page.locator("#searchBtn").click();
  await expect(page.locator("#searchInfo")).not.toContainText("0 matches");

  await page.locator("#annotationCommentInput").fill("playwright highlight");
  await page.locator("#annotationTagsInput").fill("e2e,main-path");

  await selectFirstTextSpan(page);
  await page.locator("#highlightBtn").click();
  await expect(page.locator("#annotationList")).not.toContainText("No annotations yet");

  await page.locator("#noteTitleInput").fill("E2E Main Note");
  const annotationsResp = await request.get(
    `/api/annotations?session_id=${encodeURIComponent(sessionId)}&limit=100`,
  );
  expect(annotationsResp.ok()).toBeTruthy();
  const annotationsJson = (await annotationsResp.json()) as {
    count: number;
    annotations: Array<{ id: string }>;
  };
  expect(annotationsJson.count).toBeGreaterThan(0);
  const selectedAnnotationId = annotationsJson.annotations[0]?.id ?? "";
  await page.locator("#noteLinkedIdsInput").fill(selectedAnnotationId);
  await page.locator("#noteMarkdownInput").fill("This note is linked to the highlighted evidence.");
  await page.locator("#saveNoteBtn").click();
  await expect(page.locator("#notesList")).toContainText("E2E Main Note");

  expect(sessionId.startsWith("ps_")).toBeTruthy();

  const notesResp = await request.get(
    `/api/notes?session_id=${encodeURIComponent(sessionId)}&limit=100`,
  );
  expect(notesResp.ok()).toBeTruthy();
  const notesJson = (await notesResp.json()) as { count: number };
  expect(notesJson.count).toBeGreaterThan(0);

  const [jsonDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#exportJsonBtn").click(),
  ]);
  expect(jsonDownload.suggestedFilename()).toContain("p_e2e_main_path");

  const [mdDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#exportMarkdownBtn").click(),
  ]);
  expect(mdDownload.suggestedFilename()).toContain("p_e2e_main_path");

  await page.locator("#refreshBtn").click();
  await expect(page.locator("#eventsList")).toContainText("annotation_upsert");
  await expect(page.locator("#eventsList")).toContainText("note_upsert");
});

test("open failure rolls back newly created session", async ({ page }) => {
  const missingPdfPath = path.join(os.tmpdir(), "apw-playwright-missing.pdf");
  if (fs.existsSync(missingPdfPath)) {
    fs.unlinkSync(missingPdfPath);
  }

  await page.goto("/");
  await page.locator("#paperRef").fill("p_e2e_open_failure");
  await page.locator("#pdfUri").fill(missingPdfPath);

  const rollbackClose = page.waitForResponse((response) => {
    return response.url().includes("/api/close-paper") && response.request().method() === "POST";
  });

  await page.locator("#openPaperBtn").click();

  await rollbackClose;
  await expect(page.locator("#sessionInfo")).toHaveText("—");
  await expect(page.locator("#pageInfo")).toContainText("— / —");
});

test("closing a session resets active workspace state", async ({ page }) => {
  const pdfPath = ensureSamplePdf();

  await page.goto("/");
  await page.locator("#paperRef").fill("p_e2e_close_reset");
  await page.locator("#pdfUri").fill(pdfPath);
  await page.locator("#openPaperBtn").click();
  await expect(page.locator("#statusText")).toContainText("session ready");
  await expect(page.locator("#sessionInfo")).toContainText("ps_");

  await page.locator("#closePaperBtn").click();
  await expect(page.locator("#statusText")).toContainText("session closed");
  await expect(page.locator("#sessionInfo")).toHaveText("—");
  await expect(page.locator("#pageInfo")).toContainText("— / —");
});

test("recent paper load reopens session directly", async ({ page }) => {
  const pdfPath = ensureSamplePdf();

  await page.goto("/");
  await page.locator("#paperRef").fill("p_e2e_recent_resume");
  await page.locator("#pdfUri").fill(pdfPath);
  await page.locator("#openPaperBtn").click();
  await expect(page.locator("#statusText")).toContainText("session ready");

  const firstSessionId = ((await page.locator("#sessionInfo").textContent()) ?? "").trim();
  expect(firstSessionId.startsWith("ps_")).toBeTruthy();

  await page.locator("#closePaperBtn").click();
  await expect(page.locator("#sessionInfo")).toHaveText("—");

  const recentItem = page
    .locator("#recentList li")
    .filter({ hasText: "p_e2e_recent_resume" })
    .first();
  await expect(recentItem).toBeVisible();
  await recentItem.getByRole("button", { name: "Load" }).click();

  await expect(page.locator("#statusText")).toContainText("session ready");
  const reopenedSessionId = ((await page.locator("#sessionInfo").textContent()) ?? "").trim();
  expect(reopenedSessionId.startsWith("ps_")).toBeTruthy();
  expect(reopenedSessionId).not.toBe(firstSessionId);

  await expect(page.locator("#paperRef")).toHaveValue("p_e2e_recent_resume");
  await expect(page.locator("#pdfUri")).toHaveValue(pdfPath);
});

test("annotations and notes survive reopening the same paper", async ({ page }) => {
  const pdfPath = ensureSamplePdf();
  const paperRef = `p_e2e_durable_${Date.now()}`;

  await page.goto("/");
  await page.locator("#paperRef").fill(paperRef);
  await page.locator("#pdfUri").fill(pdfPath);
  await page.locator("#openPaperBtn").click();
  await expect(page.locator("#statusText")).toContainText("session ready");
  const firstSessionId = ((await page.locator("#sessionInfo").textContent()) ?? "").trim();

  await page.locator("#annotationCommentInput").fill("durable highlight");
  await selectFirstTextSpan(page);
  await page.locator("#highlightBtn").click();
  await expect(page.locator("#annotationList")).toContainText("durable highlight");

  await page.locator("#noteTitleInput").fill("Durable note");
  await page.locator("#noteMarkdownInput").fill("Should still be here next time.");
  await page.locator("#saveNoteBtn").click();
  await expect(page.locator("#notesList")).toContainText("Durable note");

  await page.locator("#closePaperBtn").click();
  await expect(page.locator("#sessionInfo")).toHaveText("—");

  // Reopen the same paper: a new session, but the reading output is the paper's.
  await page.locator("#paperRef").fill(paperRef);
  await page.locator("#pdfUri").fill(pdfPath);
  await page.locator("#openPaperBtn").click();
  await expect(page.locator("#statusText")).toContainText("session ready");
  const secondSessionId = ((await page.locator("#sessionInfo").textContent()) ?? "").trim();
  expect(secondSessionId).not.toBe(firstSessionId);

  await expect(page.locator("#annotationList")).toContainText("durable highlight");
  await expect(page.locator("#notesList")).toContainText("Durable note");
});

test("a session_id deep link attaches instead of opening a new session", async ({ page }) => {
  const pdfPath = ensureSamplePdf();

  await page.goto("/");
  await page.locator("#paperRef").fill("p_e2e_attach");
  await page.locator("#pdfUri").fill(pdfPath);
  await page.locator("#openPaperBtn").click();
  await expect(page.locator("#statusText")).toContainText("session ready");
  const sessionId = ((await page.locator("#sessionInfo").textContent()) ?? "").trim();

  // The viewer keeps the id in the URL, so a reload rejoins the same session.
  await expect(page).toHaveURL(new RegExp(`session_id=${sessionId}`));

  await page.goto(`/?session_id=${sessionId}`);
  await expect(page.locator("#statusText")).toContainText("session ready");
  await expect(page.locator("#sessionInfo")).toHaveText(sessionId);
  await expect(page.locator("#paperRef")).toHaveValue("p_e2e_attach");
  await expect(page.locator("#textLayer span").first()).toBeVisible();
});

test("a pdf_uri deep link opens a session named after the file", async ({ page }) => {
  const pdfPath = ensureSamplePdf();

  await page.goto(`/?pdf_uri=${encodeURIComponent(pdfPath)}`);
  await expect(page.locator("#statusText")).toContainText("session ready");
  await expect(page.locator("#paperRef")).toHaveValue("apw-playwright-e2e");
  await expect(page.locator("#sessionInfo")).toContainText("ps_");
});

test("opening another paper clears the previous document's search", async ({ page }) => {
  const pdfPath = ensureSamplePdf();

  await page.goto("/");
  await page.locator("#paperRef").fill("p_e2e_search_reset_a");
  await page.locator("#pdfUri").fill(pdfPath);
  await page.locator("#openPaperBtn").click();
  await expect(page.locator("#statusText")).toContainText("session ready");

  await page.locator("#searchInput").fill("attention");
  await page.locator("#searchBtn").click();
  await expect(page.locator("#searchInfo")).not.toContainText("0 matches");

  // Both entry paths share one tail; a paper switch must not keep hits that
  // point into the document that was on screen before.
  await page.locator("#paperRef").fill("p_e2e_search_reset_b");
  await page.locator("#pdfUri").fill(pdfPath);
  await page.locator("#openPaperBtn").click();
  await expect(page.locator("#statusText")).toContainText("session ready");

  // The match counter unmounts entirely once the query is cleared.
  await expect(page.locator("#searchInfo")).toHaveCount(0);
  await expect(page.locator("#searchInput")).toHaveValue("");
});

test("text layer exposes the contiguous offsets annotation anchors rely on", async ({ page }) => {
  const pdfPath = ensureSamplePdf();

  await page.goto("/");
  await page.locator("#paperRef").fill("p_e2e_text_offsets");
  await page.locator("#pdfUri").fill(pdfPath);
  await page.locator("#openPaperBtn").click();
  await expect(page.locator("#statusText")).toContainText("session ready");
  await expect(page.locator("#textLayer span").first()).toBeVisible();

  // Anchors resolve by character offset into the page text, so a pdf.js change
  // that stops populating these datasets would break highlight placement
  // without breaking anything visible. Assert the contract directly.
  const offsets = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("#textLayer span")).map((span) => ({
      content: (span as HTMLElement).dataset.content ?? null,
      start: (span as HTMLElement).dataset.start ?? null,
      end: (span as HTMLElement).dataset.end ?? null,
    }));
  });

  expect(offsets.length).toBeGreaterThan(0);
  let expectedStart = 0;
  for (const span of offsets) {
    expect(span.content).not.toBeNull();
    expect(Number(span.start)).toBe(expectedStart);
    expect(Number(span.end)).toBe(expectedStart + (span.content?.length ?? 0));
    // readTextFromPdfItems joins items with a single space.
    expectedStart = Number(span.end) + 1;
  }
});

test("search marks its hits on the page, with the active hit distinguishable", async ({ page }) => {
  const pdfPath = ensureSamplePdf();

  await page.goto("/");
  await page.locator("#paperRef").fill("p_e2e_search_marks");
  await page.locator("#pdfUri").fill(pdfPath);
  await page.locator("#openPaperBtn").click();
  await expect(page.locator("#statusText")).toContainText("session ready");

  // "this" appears on both lines of the fixture, so one hit is active and one
  // is not — which is what makes the two treatments comparable.
  await page.locator("#searchInput").fill("this");
  await page.locator("#searchBtn").click();
  await expect(page.locator("#searchInfo")).not.toContainText("0 matches");

  // The classes were applied while the stylesheet defined neither, so the
  // counter reported hits that were invisible on the page. Assert the painted
  // result, not just the class name.
  const marks = await page.evaluate(() => {
    const isTransparent = (value: string) => value === "transparent" || /,\s*0\s*\)$/.test(value);
    const current = document.querySelector("#textLayer span.current-hit");
    const other = document.querySelector("#textLayer span.search-hit:not(.current-hit)");
    const styleOf = (el: Element | null) => (el ? getComputedStyle(el) : null);
    const currentStyle = styleOf(current);
    const otherStyle = styleOf(other);
    return {
      hits: document.querySelectorAll("#textLayer span.search-hit").length,
      currentCount: document.querySelectorAll("#textLayer span.current-hit").length,
      currentPainted: currentStyle ? !isTransparent(currentStyle.backgroundColor) : false,
      otherPainted: otherStyle ? !isTransparent(otherStyle.backgroundColor) : false,
      currentBackground: currentStyle?.backgroundColor ?? null,
      otherBackground: otherStyle?.backgroundColor ?? null,
      currentHasEmphasis: currentStyle ? currentStyle.boxShadow !== "none" : false,
    };
  });

  expect(marks.hits).toBeGreaterThan(1);
  expect(marks.currentCount).toBe(1);
  expect(marks.currentPainted).toBe(true);
  expect(marks.otherPainted).toBe(true);
  // The active hit has to be tellable apart from the rest at a glance.
  expect(marks.currentBackground).not.toBe(marks.otherBackground);
  expect(marks.currentHasEmphasis).toBe(true);
});

test("saving several times in a row does not stack toasts over the workspace", async ({ page }) => {
  const pdfPath = ensureSamplePdf();

  await page.goto("/");
  await page.locator("#paperRef").fill("p_e2e_toasts");
  await page.locator("#pdfUri").fill(pdfPath);
  await page.locator("#openPaperBtn").click();
  await expect(page.locator("#statusText")).toContainText("session ready");

  await selectFirstTextSpan(page);
  await page.locator("#highlightBtn").click();
  await page.locator("#noteTitleInput").fill("First note");
  await page.locator("#saveNoteBtn").click();
  await page.locator("#noteTitleInput").fill("Second note");
  await page.locator("#saveNoteBtn").click();

  await expect(page.locator("#toastStack .toast")).toHaveCount(1);
  await expect(page.locator("#toastStack .toast")).toHaveText("Note saved");
});

test("jumping to a hit below the fold brings it into view", async ({ page }) => {
  const pdfPath = ensureSamplePdf();

  await page.goto("/");
  await page.locator("#paperRef").fill("p_e2e_scroll_to_hit");
  await page.locator("#pdfUri").fill(pdfPath);
  await page.locator("#openPaperBtn").click();
  await expect(page.locator("#statusText")).toContainText("session ready");

  // Zoom until the page is taller than the stage, so the last line is off screen.
  for (let i = 0; i < 6; i += 1) {
    await page.locator("#zoomInBtn").click();
  }
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const stage = document.querySelector("#pdfStage");
        return stage ? stage.scrollHeight - stage.clientHeight : 0;
      }),
    )
    .toBeGreaterThan(0);
  await page.evaluate(() => document.querySelector("#pdfStage")?.scrollTo({ top: 0 }));

  await page.locator("#searchInput").fill("notes");
  await page.locator("#searchBtn").click();
  await expect(page.locator("#searchInfo")).not.toContainText("0 matches");

  // The reader should not have to hunt for the match the counter just claimed.
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const stage = document.querySelector("#pdfStage");
        const hit = document.querySelector("#textLayer span.current-hit");
        if (!stage || !hit) {
          return false;
        }
        const s = stage.getBoundingClientRect();
        const h = hit.getBoundingClientRect();
        return h.top >= s.top && h.bottom <= s.bottom;
      }),
    )
    .toBe(true);
});
