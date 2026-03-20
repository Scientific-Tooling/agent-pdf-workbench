import { clamp } from "../utils/main-utils";
import type { PendingSelection } from "../app/app-types";
import type { Annotation, NormalizedRect, TextAnchor } from "../types/types";

function denormalizeRect(rect: NormalizedRect, width: number, height: number): NormalizedRect {
  return {
    x: rect.x * width,
    y: rect.y * height,
    width: rect.width * width,
    height: rect.height * height,
  };
}

function normalizeRectFromClientRect(rect: DOMRect, layerRect: DOMRect): NormalizedRect | null {
  if (layerRect.width <= 0 || layerRect.height <= 0 || rect.width <= 0 || rect.height <= 0) {
    return null;
  }
  return {
    x: (rect.left - layerRect.left) / layerRect.width,
    y: (rect.top - layerRect.top) / layerRect.height,
    width: rect.width / layerRect.width,
    height: rect.height / layerRect.height,
  };
}

function normalizedText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function resolveAnchorOffsets(anchor: TextAnchor, pageText: string): { start: number; end: number } | null {
  const hasRange = typeof anchor.start === "number" && typeof anchor.end === "number";
  if (hasRange) {
    const start = Number(anchor.start);
    const end = Number(anchor.end);
    if (start >= 0 && end > start && end <= pageText.length) {
      const candidate = pageText.slice(start, end);
      if (!anchor.quote || normalizedText(candidate).includes(normalizedText(anchor.quote))) {
        return { start, end };
      }
    }
  }

  const quote = anchor.quote.trim();
  if (!quote) {
    if (hasRange) {
      return { start: Number(anchor.start), end: Number(anchor.end) };
    }
    return null;
  }

  const hits: Array<{ start: number; end: number; score: number }> = [];
  let cursor = 0;
  while (cursor <= pageText.length) {
    const hit = pageText.indexOf(quote, cursor);
    if (hit === -1) {
      break;
    }
    const end = hit + quote.length;
    let score = 0;
    if (anchor.prefix) {
      const prefixStart = Math.max(0, hit - anchor.prefix.length);
      if (pageText.slice(prefixStart, hit) === anchor.prefix) {
        score += 1;
      }
    }
    if (anchor.suffix) {
      const suffixEnd = Math.min(pageText.length, end + anchor.suffix.length);
      if (pageText.slice(end, suffixEnd) === anchor.suffix) {
        score += 1;
      }
    }
    hits.push({ start: hit, end, score });
    cursor = end;
  }

  if (hits.length > 0) {
    hits.sort((a, b) => (a.score === b.score ? a.start - b.start : b.score - a.score));
    return { start: hits[0].start, end: hits[0].end };
  }

  if (hasRange) {
    return { start: Number(anchor.start), end: Number(anchor.end) };
  }
  return null;
}

function annotationRectsFromAnchor(
  annotation: Annotation,
  page: number,
  pageTextCache: Map<number, string>,
  textLayer: HTMLDivElement,
): NormalizedRect[] {
  if (annotation.page !== page || !annotation.anchor) {
    return [];
  }

  const pageText = pageTextCache.get(page) ?? "";
  const offsets = resolveAnchorOffsets(annotation.anchor, pageText);
  if (!offsets || offsets.end <= offsets.start) {
    return [];
  }

  const spans = Array.from(textLayer.querySelectorAll("span"));
  if (spans.length === 0) {
    return [];
  }

  const layerRect = textLayer.getBoundingClientRect();
  const rects: NormalizedRect[] = [];
  for (const span of spans) {
    const spanStart = Number((span as HTMLElement).dataset.start ?? "-1");
    const spanEnd = Number((span as HTMLElement).dataset.end ?? "-1");
    if (!Number.isFinite(spanStart) || !Number.isFinite(spanEnd)) {
      continue;
    }
    const overlapStart = Math.max(offsets.start, spanStart);
    const overlapEnd = Math.min(offsets.end, spanEnd);
    if (overlapEnd <= overlapStart) {
      continue;
    }
    const node = span.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE) {
      const normalized = normalizeRectFromClientRect(span.getBoundingClientRect(), layerRect);
      if (normalized) {
        rects.push(normalized);
      }
      continue;
    }
    const localStart = overlapStart - spanStart;
    const localEnd = overlapEnd - spanStart;
    try {
      const range = document.createRange();
      range.setStart(node, localStart);
      range.setEnd(node, localEnd);
      const pieces = Array.from(range.getClientRects());
      if (pieces.length === 0) {
        const normalized = normalizeRectFromClientRect(span.getBoundingClientRect(), layerRect);
        if (normalized) {
          rects.push(normalized);
        }
      } else {
        for (const piece of pieces) {
          const normalized = normalizeRectFromClientRect(piece, layerRect);
          if (normalized) {
            rects.push(normalized);
          }
        }
      }
    } catch {
      const normalized = normalizeRectFromClientRect(span.getBoundingClientRect(), layerRect);
      if (normalized) {
        rects.push(normalized);
      }
    }
  }
  return rects;
}

function annotationRects(
  annotation: Annotation,
  page: number,
  pageTextCache: Map<number, string>,
  textLayer: HTMLDivElement,
): NormalizedRect[] {
  const anchored = annotationRectsFromAnchor(annotation, page, pageTextCache, textLayer);
  if (anchored.length > 0) {
    return anchored;
  }
  return annotation.rects;
}

function findOffsetSpan(node: Node): HTMLSpanElement | null {
  if (node instanceof HTMLElement) {
    if (node.tagName === "SPAN" && node.dataset.start !== undefined) {
      return node;
    }
    return node.closest("span[data-start]") as HTMLSpanElement | null;
  }
  if (node.parentElement) {
    return node.parentElement.closest("span[data-start]") as HTMLSpanElement | null;
  }
  return null;
}

function absoluteOffsetFromRangeBoundary(container: Node, offset: number): number | null {
  const span = findOffsetSpan(container);
  if (!span) {
    return null;
  }
  const spanStart = Number(span.dataset.start ?? "-1");
  if (!Number.isFinite(spanStart) || spanStart < 0) {
    return null;
  }

  const text = span.textContent ?? "";
  let localOffset = 0;
  if (container.nodeType === Node.TEXT_NODE) {
    const nodeText = (container as Text).data;
    localOffset = clamp(offset, 0, nodeText.length);
  } else if (container === span) {
    let consumed = 0;
    const childCount = clamp(offset, 0, span.childNodes.length);
    for (let i = 0; i < childCount; i += 1) {
      consumed += span.childNodes[i]?.textContent?.length ?? 0;
    }
    localOffset = consumed;
  } else {
    localOffset = clamp(offset, 0, text.length);
  }

  return spanStart + clamp(localOffset, 0, text.length);
}

function buildAnchor(
  quote: string,
  start: number | null,
  end: number | null,
  page: number,
  pageTextCache: Map<number, string>,
  anchorContextChars: number,
): TextAnchor {
  const pageText = pageTextCache.get(page) ?? "";
  if (start === null || end === null || end <= start) {
    return {
      quote,
      start: null,
      end: null,
      prefix: "",
      suffix: "",
    };
  }
  const safeStart = clamp(start, 0, pageText.length);
  const safeEnd = clamp(end, safeStart, pageText.length);
  const prefix = pageText.slice(Math.max(0, safeStart - anchorContextChars), safeStart);
  const suffix = pageText.slice(safeEnd, Math.min(pageText.length, safeEnd + anchorContextChars));
  return {
    quote,
    start: safeStart,
    end: safeEnd,
    prefix,
    suffix,
  };
}

export function getSelectionRectsAndQuote(
  textLayer: HTMLDivElement,
  pdfStage: HTMLDivElement,
  page: number,
  pageTextCache: Map<number, string>,
  anchorContextChars: number,
  clearSelection = true,
): PendingSelection | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }
  const range = selection.getRangeAt(0);
  if (!textLayer.contains(range.commonAncestorContainer)) {
    return null;
  }

  const quote = selection.toString().trim();
  if (!quote) {
    return null;
  }
  const start = absoluteOffsetFromRangeBoundary(range.startContainer, range.startOffset);
  const end = absoluteOffsetFromRangeBoundary(range.endContainer, range.endOffset);
  const anchor = buildAnchor(quote, start, end, page, pageTextCache, anchorContextChars);

  const layerRect = textLayer.getBoundingClientRect();
  const rangeRect = range.getBoundingClientRect();
  const rects = Array.from(range.getClientRects())
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map((rect) => ({
      x: (rect.left - layerRect.left) / layerRect.width,
      y: (rect.top - layerRect.top) / layerRect.height,
      width: rect.width / layerRect.width,
      height: rect.height / layerRect.height,
    }));

  if (clearSelection) {
    selection.removeAllRanges();
  }
  if (rects.length === 0) {
    return null;
  }
  return {
    rects,
    quote,
    anchor,
    anchorX: rangeRect.left - layerRect.left + pdfStage.scrollLeft,
    anchorY: rangeRect.top - layerRect.top + pdfStage.scrollTop,
  };
}

interface RenderLayerParams {
  annotationLayer: HTMLDivElement;
  textLayer: HTMLDivElement;
  annotations: Annotation[];
  page: number;
  selectedAnnotationId: string | null;
  pageTextCache: Map<number, string>;
  onSelectAnnotation: (annotationId: string) => void;
}

export function renderAnnotationLayer(params: RenderLayerParams): void {
  const {
    annotationLayer,
    textLayer,
    annotations,
    page,
    selectedAnnotationId,
    pageTextCache,
    onSelectAnnotation,
  } = params;

  annotationLayer.innerHTML = "";
  const width = textLayer.clientWidth;
  const height = textLayer.clientHeight;

  for (const annotation of annotations) {
    if (annotation.page !== page) {
      continue;
    }
    for (const rect of annotationRects(annotation, page, pageTextCache, textLayer)) {
      const realRect = denormalizeRect(rect, width, height);
      const mark = document.createElement("div");
      mark.className = `annotation-mark ${annotation.type}`;
      if (annotation.id === selectedAnnotationId) {
        mark.classList.add("selected");
      }
      mark.style.left = `${realRect.x}px`;
      mark.style.top = `${realRect.y}px`;
      mark.style.width = `${realRect.width}px`;
      mark.style.height = `${realRect.height}px`;
      mark.addEventListener("click", (event) => {
        event.stopPropagation();
        onSelectAnnotation(annotation.id);
      });
      annotationLayer.appendChild(mark);
    }
  }
}
