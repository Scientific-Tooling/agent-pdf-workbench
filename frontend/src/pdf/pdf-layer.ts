import type { PageViewport, TextItem, TextMarkedContent } from "../types/pdfjs-types";

export function readTextFromPdfItems(items: Array<TextItem | TextMarkedContent>): string {
  // Marked-content entries carry structure, not text, and contribute nothing.
  return items.map((item) => ("str" in item ? item.str : "")).join(" ");
}

export function updateCanvasAndLayersSize(
  pdfCanvas: HTMLCanvasElement,
  textLayer: HTMLDivElement,
  annotationLayer: HTMLDivElement,
  viewport: PageViewport,
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
