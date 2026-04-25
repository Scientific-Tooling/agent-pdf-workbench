import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";

function buildSimplePdf(lines: string[]): Buffer {
  const escaped = lines.map((line) => line.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)"));
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

  await page.locator("#searchToggleBtn").click();
  await page.locator("#searchInput").fill("attention");
  await page.locator("#searchBtn").click();
  await expect(page.locator("#searchInfo")).not.toContainText("0 matches");

  await page.locator("#annotationCommentInput").fill("playwright highlight");
  await page.locator("#annotationTagsInput").fill("e2e,main-path");

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

  const notesResp = await request.get(`/api/notes?session_id=${encodeURIComponent(sessionId)}&limit=100`);
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

  const recentItem = page.locator("#recentList li").filter({ hasText: "p_e2e_recent_resume" }).first();
  await expect(recentItem).toBeVisible();
  await recentItem.getByRole("button", { name: "Load" }).click();

  await expect(page.locator("#statusText")).toContainText("session ready");
  const reopenedSessionId = ((await page.locator("#sessionInfo").textContent()) ?? "").trim();
  expect(reopenedSessionId.startsWith("ps_")).toBeTruthy();
  expect(reopenedSessionId).not.toBe(firstSessionId);

  await expect(page.locator("#paperRef")).toHaveValue("p_e2e_recent_resume");
  await expect(page.locator("#pdfUri")).toHaveValue(pdfPath);
});
