import type { PdfViewportLike } from "../app/app-types";

export function readTextFromPdfItems(items: Array<Record<string, unknown>>): string {
  return items
    .map((item) => {
      const maybeText = item.str;
      return typeof maybeText === "string" ? maybeText : "";
    })
    .join(" ");
}

export function multiplyTransforms(a: number[], b: number[]): number[] {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

export function renderTextLayer(
  textLayer: HTMLDivElement,
  viewport: PdfViewportLike,
  items: Array<Record<string, unknown>>,
): void {
  textLayer.innerHTML = "";
  textLayer.style.width = `${viewport.width}px`;
  textLayer.style.height = `${viewport.height}px`;
  let textCursor = 0;

  for (const item of items) {
    if (typeof item.str !== "string" || !Array.isArray(item.transform)) {
      continue;
    }
    const span = document.createElement("span");
    const transform = multiplyTransforms(viewport.transform, item.transform as number[]);
    const x = transform[4];
    const y = transform[5];
    const fontSize = Math.max(8, Math.hypot(transform[2], transform[3]));

    span.textContent = item.str;
    span.dataset.content = item.str;
    span.dataset.start = String(textCursor);
    span.dataset.end = String(textCursor + item.str.length);
    span.style.left = `${x}px`;
    span.style.top = `${y - fontSize}px`;
    span.style.fontSize = `${fontSize}px`;
    span.style.fontFamily = "sans-serif";
    textLayer.appendChild(span);
    textCursor += item.str.length + 1;
  }
}

export function updateCanvasAndLayersSize(
  pdfCanvas: HTMLCanvasElement,
  textLayer: HTMLDivElement,
  annotationLayer: HTMLDivElement,
  viewport: PdfViewportLike,
): void {
  pdfCanvas.width = viewport.width;
  pdfCanvas.height = viewport.height;
  pdfCanvas.style.width = `${viewport.width}px`;
  pdfCanvas.style.height = `${viewport.height}px`;

  textLayer.style.width = `${viewport.width}px`;
  textLayer.style.height = `${viewport.height}px`;
  annotationLayer.style.width = `${viewport.width}px`;
  annotationLayer.style.height = `${viewport.height}px`;
}
