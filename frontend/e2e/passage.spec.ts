import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";

const files: string[] = [];

function pdfBytes(): Buffer {
  const pages = ["First page context.", "Second page supporting evidence."];
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
  ];
  for (let i = 0; i < pages.length; i += 1) {
    const stream = `BT /F1 18 Tf 72 720 Td (${pages[i]}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents ${4 + i * 2} 0 R >>`,
    );
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

function digest(value: unknown): string {
  function sort(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(sort);
    if (input !== null && typeof input === "object") {
      return Object.fromEntries(
        Object.entries(input)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, val]) => [key, sort(val)]),
      );
    }
    return input;
  }
  return createHash("sha256")
    .update(JSON.stringify(sort(value)))
    .digest("hex");
}

async function fixture(request: APIRequestContext) {
  const pdf = pdfBytes();
  const sha = createHash("sha256").update(pdf).digest("hex");
  const file = path.join(
    os.tmpdir(),
    `apw-passage-${Date.now()}-${Math.random().toString(16).slice(2)}.pdf`,
  );
  files.push(file);
  fs.writeFileSync(file, pdf);
  const opened = await request.post("/api/open-paper", {
    data: {
      paper_ref: `rks:e2e:p_${Date.now()}:sha256:${sha}`,
      pdf_uri: file,
    },
  });
  expect(opened.ok()).toBeTruthy();
  const session = (await opened.json()) as { id: string };
  const quote = "Second page supporting evidence.";
  const annotation = {
    id: "ann_cited",
    page: 2,
    type: "highlight",
    quote,
    anchor: { quote, start: 0, end: quote.length, prefix: "", suffix: "" },
    rects: [],
    comment: "Synthetic reading observation.",
    tags: [],
    createdAt: "2026-10-26T12:00:00+00:00",
    updatedAt: "2026-10-26T12:00:00+00:00",
  };
  expect(
    (await request.post("/api/annotations", { data: { session_id: session.id, annotation } })).ok(),
  ).toBeTruthy();
  const passage = {
    annotation_id: annotation.id,
    page: 2,
    quote,
    anchor: annotation.anchor,
    rects: [],
  };
  const query = new URLSearchParams({
    session_id: session.id,
    document_sha256: sha,
    annotation_id: annotation.id,
    page: "2",
    passage_sha256: digest(passage),
  });
  return { session, annotation, query, file };
}

test.afterEach(() => {
  for (const file of files.splice(0)) fs.unlinkSync(file);
});

test("citation overrides saved progress, selects the passage, and survives reload", async ({
  page,
  request,
}) => {
  const { session, query } = await fixture(request);
  await page.goto(`/?session_id=${session.id}`);
  await expect(page.locator("#statusText")).toContainText("session ready");
  await expect(page.locator("#pageJumpInput")).toHaveValue("1");
  await page.goto(`/?${query}`);
  await expect(page.locator("#statusText")).toContainText("passage ready");
  await expect(page.locator("#pageJumpInput")).toHaveValue("2");
  await expect(page.locator(".annotation-mark.selected").first()).toBeVisible();
  await page.reload();
  await expect(page.locator("#statusText")).toContainText("passage ready");
  await expect(page.locator("#pageJumpInput")).toHaveValue("2");
});

test("closed session citation starts reading the same paper and passage", async ({
  page,
  request,
}) => {
  const { session, query } = await fixture(request);
  await request.post("/api/close-paper", { data: { session_id: session.id } });
  await page.goto(`/?${query}`);
  await expect(page.locator("#statusText")).toContainText("passage ready");
  await expect(page.locator("#sessionInfo")).not.toHaveText(session.id);
  await expect(page.locator("#pageJumpInput")).toHaveValue("2");
  await expect(page.locator(".annotation-mark.selected").first()).toBeVisible();
});

test("edited and deleted anchors produce repair messages", async ({ page, request }) => {
  const { session, query, annotation } = await fixture(request);
  await request.post("/api/annotations", {
    data: { session_id: session.id, annotation: { ...annotation, quote: "edited" } },
  });
  await page.goto(`/?${query}`);
  await expect(page.locator("#statusText")).toContainText("Cited passage has changed");
  await request.post("/api/annotations/delete", {
    data: { session_id: session.id, annotation_id: annotation.id },
  });
  await page.goto(`/?${query}`);
  await expect(page.locator("#statusText")).toContainText("missing or deleted");
});

test("changed PDF bytes are rejected before rendering a cited page", async ({ page, request }) => {
  const { query, file } = await fixture(request);
  fs.appendFileSync(file, "\n% changed source\n");
  await page.goto(`/?${query}`);
  await expect(page.locator("#statusText")).toContainText("Source PDF changed");
  await expect(page.locator(".annotation-mark.selected")).toHaveCount(0);
});

test("out-of-range pages and ambiguous quotes are rejected", async ({ page, request }) => {
  const { query, annotation, session } = await fixture(request);
  for (const [pageNumber, quote, message] of [
    [99, annotation.quote, "outside this PDF"],
    [2, "not on the page", "missing or ambiguous"],
  ] as const) {
    const updated = { ...annotation, page: pageNumber, quote, anchor: null };
    await request.post("/api/annotations", {
      data: { session_id: session.id, annotation: updated },
    });
    query.set("page", String(pageNumber));
    query.set(
      "passage_sha256",
      digest({ annotation_id: annotation.id, page: pageNumber, quote, anchor: null, rects: [] }),
    );
    await page.goto(`/?${query}`);
    await expect(page.locator("#statusText")).toContainText(message);
    await expect(page.locator(".annotation-mark.selected")).toHaveCount(0);
  }
});
