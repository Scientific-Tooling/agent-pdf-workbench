import type { PageViewport, TextItem, TextMarkedContent } from "../types/pdfjs-types";

export interface PdfPageText {
  text: string;
  spans: Array<{ start: number; end: number }>;
  optionalWhitespace: ReadonlySet<number>;
}

export function buildPdfPageText(items: Array<TextItem | TextMarkedContent>): PdfPageText {
  // Retain the original offset space for saved anchors. Separators we insert
  // between PDF fragments are different from actual word spaces/end-of-lines.
  let text = "";
  const spans: PdfPageText["spans"] = [];
  const optionalWhitespace = new Set<number>();
  let previous: TextItem | undefined;
  for (const item of items) {
    if (!("str" in item)) continue;
    if (previous) {
      if (!previous.hasEOL) optionalWhitespace.add(text.length);
      text += " ";
    }
    const start = text.length;
    text += item.str;
    spans.push({ start, end: text.length });
    previous = item;
  }
  return { text, spans, optionalWhitespace };
}

export function readTextFromPdfItems(items: Array<TextItem | TextMarkedContent>): string {
  return buildPdfPageText(items).text;
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
