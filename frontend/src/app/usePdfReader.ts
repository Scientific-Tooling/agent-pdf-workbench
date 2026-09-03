import { useRef, useState } from "react";
import type { RefObject } from "react";

import * as pdfjsLib from "pdfjs-dist/build/pdf.mjs";
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import { useSyncedRef } from "../hooks/useSyncedRef";
import { readTextFromPdfItems, updateCanvasAndLayersSize } from "../pdf/pdf-layer";
import type { OutlineItem } from "../types/types";
import { clamp } from "../utils/main-utils";
import { DEFAULT_ZOOM, MAX_ZOOM, MIN_ZOOM } from "./app-types";
import type { PdfOutlineNode } from "./app-types";
import type { PageViewport, PDFDocumentProxy, TextContent } from "../types/pdfjs-types";
import { usePageCache } from "./usePageCache";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

/** Breathing room kept between the page edge and the stage when fitting width. */
const STAGE_GUTTER_PX = 24;

/** What is on screen: captured when the document opens, reported back on render. */
export interface OpenDocument {
  paperRef: string;
  pdfUri: string;
  sessionId: string;
}

export interface PdfReaderCallbacks {
  /**
   * Persist reading position after a page is on screen.
   *
   * The document identity comes from the render, not from ambient state, so
   * progress can never be filed under whatever paper was open previously.
   */
  onProgress: (page: number, zoom: number, document: OpenDocument) => void;
  /** Record a page_change action event. */
  onPageChange: (page: number, totalPages: number, sessionId: string) => Promise<void>;
  /** Record a zoom_change action event. */
  onZoomChange: (zoom: number, page: number) => Promise<void>;
}

interface PdfReaderParams extends PdfReaderCallbacks {
  pdfStageRef: RefObject<HTMLDivElement | null>;
  pdfCanvasRef: RefObject<HTMLCanvasElement | null>;
  textLayerRef: RefObject<HTMLDivElement | null>;
  annotationLayerRef: RefObject<HTMLDivElement | null>;
}

/**
 * Owns the PDF document, page rendering, page/text caches, zoom, and outline.
 *
 * Rendering is the one place in the app where several controls can race, so
 * every render takes a token and a newer render retires an older one.
 */
export function usePdfReader(params: PdfReaderParams) {
  const { pdfStageRef, pdfCanvasRef, textLayerRef, annotationLayerRef } = params;
  const callbacksRef = useSyncedRef<PdfReaderCallbacks>({
    onProgress: params.onProgress,
    onPageChange: params.onPageChange,
    onZoomChange: params.onZoomChange,
  });

  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [pageJumpInput, setPageJumpInput] = useState("");
  const [loadingCount, setLoadingCount] = useState(0);
  const [stageLoadingLabel, setStageLoadingLabel] = useState("Loading PDF...");

  const pdfDocRef = useSyncedRef<PDFDocumentProxy | null>(pdfDoc);
  const pageRef = useSyncedRef<number>(page);
  const zoomRef = useSyncedRef<number>(zoom);
  const isChangingPageRef = useRef(false);
  const openDocumentRef = useRef<OpenDocument | null>(null);
  // While true the page follows the window width. A manual zoom turns it off;
  // pressing Fit Width turns it back on.
  const followsWidthRef = useRef(true);
  const renderTokenRef = useRef(0);
  const activeTextLayerRef = useRef<pdfjsLib.TextLayer | null>(null);

  const { pageTextCacheRef, pageCacheRef, disposeBitmap, clearPageCache, setPageCacheEntry } =
    usePageCache();

  async function withStageLoading<T>(label: string, task: () => Promise<T>): Promise<T> {
    setLoadingCount((count) => count + 1);
    setStageLoadingLabel(label);
    try {
      return await task();
    } finally {
      setLoadingCount((count) => Math.max(0, count - 1));
    }
  }

  function setZoomLevel(nextZoom: number): void {
    setZoom(nextZoom);
    zoomRef.current = nextZoom;
  }

  function clearViewerDom(): void {
    const textLayer = textLayerRef.current;
    const annotationLayer = annotationLayerRef.current;
    const canvas = pdfCanvasRef.current;
    if (textLayer) {
      textLayer.innerHTML = "";
    }
    if (annotationLayer) {
      annotationLayer.innerHTML = "";
    }
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
      canvas.style.width = "0px";
      canvas.style.height = "0px";
    }
  }

  function resetReader(): void {
    openDocumentRef.current = null;
    renderTokenRef.current += 1;
    activeTextLayerRef.current?.cancel();
    activeTextLayerRef.current = null;
    setPdfDoc(null);
    pdfDocRef.current = null;
    setPage(1);
    pageRef.current = 1;
    setPageJumpInput("");
    setZoomLevel(DEFAULT_ZOOM);
    setOutline([]);
    setLoadingCount(0);
    setStageLoadingLabel("Loading PDF...");
    pageTextCacheRef.current.clear();
    clearPageCache();
    clearViewerDom();
  }

  async function ensurePageText(targetPage: number, doc?: PDFDocumentProxy): Promise<string> {
    const cached = pageTextCacheRef.current.get(targetPage);
    if (cached !== undefined) {
      return cached;
    }
    const activeDoc = doc ?? pdfDocRef.current;
    if (!activeDoc) {
      return "";
    }
    const pdfPage = await activeDoc.getPage(targetPage);
    const textContent = await pdfPage.getTextContent();
    const text = readTextFromPdfItems(textContent.items);
    pageTextCacheRef.current.set(targetPage, text);
    return text;
  }

  async function renderPage(
    pageNumber: number,
    emitPageChange: boolean,
    docOverride?: PDFDocumentProxy,
  ): Promise<void> {
    const activeDoc = docOverride ?? pdfDocRef.current;
    const canvas = pdfCanvasRef.current;
    const textLayer = textLayerRef.current;
    const annotationLayer = annotationLayerRef.current;
    if (!activeDoc || !canvas || !textLayer || !annotationLayer) {
      return;
    }
    const activeZoom = zoomRef.current;
    const cached = pageCacheRef.current.get(pageNumber);
    const cacheHit = cached !== undefined && Math.abs(cached.zoom - activeZoom) < 0.001;

    // renderPage is reachable from nine controls. Without a token, two
    // overlapping calls can leave one page on the canvas and another page's
    // offsets in the text layer, which anchors annotations and copy events to
    // text that is not on screen.
    const token = renderTokenRef.current + 1;
    renderTokenRef.current = token;
    const isStale = (): boolean => renderTokenRef.current !== token;
    activeTextLayerRef.current?.cancel();
    activeTextLayerRef.current = null;

    let viewport!: PageViewport;
    let textContent!: TextContent;

    if (cacheHit) {
      cached!.lastUsedAt = Date.now();
      viewport = cached!.viewport;
      textContent = cached!.textContent;
      updateCanvasAndLayersSize(canvas, textLayer, annotationLayer, viewport);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Cannot initialize 2d canvas context");
      context.drawImage(cached!.bitmap, 0, 0);
    } else {
      await withStageLoading("Rendering page...", async () => {
        const pdfPage = await activeDoc.getPage(pageNumber);
        const vp = pdfPage.getViewport({ scale: activeZoom });
        updateCanvasAndLayersSize(canvas, textLayer, annotationLayer, vp);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Cannot initialize 2d canvas context");
        await pdfPage.render({ canvas, canvasContext: context, viewport: vp }).promise;
        const tc = await pdfPage.getTextContent();
        const bitmap = await createImageBitmap(canvas);
        setPageCacheEntry(pageNumber, { bitmap, textContent: tc, viewport: vp, zoom: activeZoom });
        viewport = vp;
        textContent = tc;
      });
    }

    if (isStale()) {
      return;
    }

    textLayer.innerHTML = "";
    const pdfTextLayer = new pdfjsLib.TextLayer({
      textContentSource: textContent,
      container: textLayer,
      viewport,
    });
    activeTextLayerRef.current = pdfTextLayer;
    await pdfTextLayer.render();
    if (isStale()) {
      return;
    }
    activeTextLayerRef.current = null;

    let textCursor = 0;
    for (let i = 0; i < pdfTextLayer.textDivs.length; i++) {
      const div = pdfTextLayer.textDivs[i];
      const str = pdfTextLayer.textContentItemsStr[i] ?? "";
      div.dataset.content = str;
      div.dataset.start = String(textCursor);
      div.dataset.end = String(textCursor + str.length);
      textCursor += str.length + 1;
    }
    pageTextCacheRef.current.set(pageNumber, readTextFromPdfItems(textContent.items));

    setPage(pageNumber);
    pageRef.current = pageNumber;
    setPageJumpInput(String(pageNumber));

    const openDoc = openDocumentRef.current;
    if (openDoc) {
      callbacksRef.current.onProgress(pageNumber, activeZoom, openDoc);
      if (emitPageChange) {
        await callbacksRef.current.onPageChange(pageNumber, activeDoc.numPages, openDoc.sessionId);
      }
    }

    prerenderPageToCache(pageNumber + 1).catch(() => {});
    prerenderPageToCache(pageNumber - 1).catch(() => {});
  }

  async function prerenderPageToCache(pageNumber: number): Promise<void> {
    const doc = pdfDocRef.current;
    if (!doc || pageNumber < 1 || pageNumber > doc.numPages) return;
    const activeZoom = zoomRef.current;
    const cached = pageCacheRef.current.get(pageNumber);
    if (cached && Math.abs(cached.zoom - activeZoom) < 0.001) return;
    const pdfPage = await doc.getPage(pageNumber);
    const viewport = pdfPage.getViewport({ scale: activeZoom });
    const offscreen = document.createElement("canvas");
    offscreen.width = viewport.width;
    offscreen.height = viewport.height;
    const ctx = offscreen.getContext("2d");
    if (!ctx) return;
    await pdfPage.render({ canvas: offscreen, canvasContext: ctx, viewport }).promise;
    const bitmap = await createImageBitmap(offscreen);
    const textContent = await pdfPage.getTextContent();
    if (Math.abs(zoomRef.current - activeZoom) > 0.001) {
      disposeBitmap(bitmap);
      return; // zoom changed, discard
    }
    setPageCacheEntry(pageNumber, { bitmap, textContent, viewport, zoom: activeZoom });
    if (!pageTextCacheRef.current.has(pageNumber)) {
      pageTextCacheRef.current.set(pageNumber, readTextFromPdfItems(textContent.items));
    }
  }

  async function resolveOutlinePage(doc: PDFDocumentProxy, dest: unknown): Promise<number | null> {
    if (!dest) {
      return null;
    }
    let destination: unknown = dest;
    if (typeof dest === "string") {
      destination = await doc.getDestination(dest);
    }
    if (!Array.isArray(destination) || destination.length === 0) {
      return null;
    }
    try {
      const pageIndex = await doc.getPageIndex(destination[0]);
      return pageIndex + 1;
    } catch {
      return null;
    }
  }

  async function buildOutline(doc: PDFDocumentProxy): Promise<void> {
    const docOutline = await doc.getOutline();
    if (!docOutline || docOutline.length === 0) {
      setOutline([]);
      return;
    }
    const next: OutlineItem[] = [];
    async function walk(nodes: PdfOutlineNode[], level: number): Promise<void> {
      for (const node of nodes) {
        const outlinePage = await resolveOutlinePage(doc, node.dest);
        if (outlinePage !== null) {
          next.push({ title: node.title || "Untitled", page: outlinePage, level });
        }
        if (node.items && node.items.length > 0) {
          await walk(node.items, level + 1);
        }
      }
    }
    await walk(docOutline, 0);
    setOutline(next);
  }

  /**
   * Put a document on screen: the single lifecycle call a session flow needs.
   *
   * Zoom is applied before the first render so the page is never drawn twice.
   */
  async function openDocument(
    params: OpenDocument & { page: number; zoom?: number },
  ): Promise<void> {
    openDocumentRef.current = {
      paperRef: params.paperRef,
      pdfUri: params.pdfUri,
      sessionId: params.sessionId,
    };
    // A saved zoom is the reader's own choice and wins; without one the page
    // fits the width it actually has.
    followsWidthRef.current = params.zoom === undefined;
    if (params.zoom !== undefined) {
      setZoomLevel(params.zoom);
    }
    await loadPdf(params.pdfUri, params.page);
  }

  async function loadPdf(nextPdfUri: string, preferredPage: number): Promise<void> {
    const source = `/api/pdf?uri=${encodeURIComponent(nextPdfUri)}`;
    await withStageLoading("Loading PDF...", async () => {
      const loadingTask = pdfjsLib.getDocument({ url: source });
      const doc = await loadingTask.promise;
      setPdfDoc(doc);
      pdfDocRef.current = doc;
      pageTextCacheRef.current.clear();
      clearPageCache();
      await buildOutline(doc);
      if (followsWidthRef.current) {
        const fitted = await widthFittingScale();
        if (fitted !== null) {
          setZoomLevel(fitted);
        }
      }
      const normalizedPage = clamp(preferredPage, 1, doc.numPages);
      await renderPage(normalizedPage, true, doc);
    });
  }

  async function goPrevPage(): Promise<void> {
    const doc = pdfDocRef.current;
    if (!doc || pageRef.current <= 1) {
      return;
    }
    await renderPage(pageRef.current - 1, true);
  }

  async function goNextPage(): Promise<void> {
    const doc = pdfDocRef.current;
    if (!doc || pageRef.current >= doc.numPages) {
      return;
    }
    await renderPage(pageRef.current + 1, true);
  }

  async function jumpToPageInput(): Promise<void> {
    const doc = pdfDocRef.current;
    if (!doc) {
      return;
    }
    const requested = Number(pageJumpInput);
    if (!Number.isFinite(requested)) {
      return;
    }
    await renderPage(clamp(Math.round(requested), 1, doc.numPages), true);
  }

  async function applyZoom(nextZoom: number, options: { manual?: boolean } = {}): Promise<void> {
    const doc = pdfDocRef.current;
    if (!doc) {
      return;
    }
    if (options.manual !== false) {
      followsWidthRef.current = false;
    }
    const normalized = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
    if (Math.abs(normalized - zoomRef.current) < 0.001) {
      return;
    }
    clearPageCache();
    setZoomLevel(normalized);
    await callbacksRef.current.onZoomChange(normalized, pageRef.current);
    await renderPage(pageRef.current, false);
  }

  async function fitWidth(options: { manual?: boolean } = {}): Promise<void> {
    const scale = await widthFittingScale();
    if (scale === null) {
      return;
    }
    await applyZoom(scale, { manual: false });
    if (options.manual !== false) {
      // An explicit Fit Width means "keep doing this as the window changes".
      followsWidthRef.current = true;
    }
  }

  async function widthFittingScale(): Promise<number | null> {
    const doc = pdfDocRef.current;
    const stage = pdfStageRef.current;
    if (!doc || !stage || stage.clientWidth <= 0) {
      return null;
    }
    const activePage = await doc.getPage(pageRef.current);
    const baseViewport = activePage.getViewport({ scale: 1 });
    return clamp((stage.clientWidth - STAGE_GUTTER_PX) / baseViewport.width, MIN_ZOOM, MAX_ZOOM);
  }

  /** Refit after the stage resizes, but only while the page is following it. */
  function refitToStage(): void {
    if (!followsWidthRef.current || !pdfDocRef.current) {
      return;
    }
    void fitWidth({ manual: false });
  }

  /** Page-turn on wheel at the top/bottom of the stage. */
  function handleStageWheel(event: WheelEvent): void {
    const stage = pdfStageRef.current;
    if (!stage || isChangingPageRef.current) {
      return;
    }
    const atBottom = stage.scrollTop + stage.clientHeight >= stage.scrollHeight - 2;
    const atTop = stage.scrollTop <= 0;
    const doc = pdfDocRef.current;
    if (event.deltaY > 0 && atBottom && doc && pageRef.current < doc.numPages) {
      isChangingPageRef.current = true;
      renderPage(pageRef.current + 1, true)
        .then(() => {
          if (pdfStageRef.current) pdfStageRef.current.scrollTop = 0;
        })
        .catch(() => {})
        .finally(() => {
          isChangingPageRef.current = false;
        });
    } else if (event.deltaY < 0 && atTop && pageRef.current > 1) {
      isChangingPageRef.current = true;
      renderPage(pageRef.current - 1, true)
        .then(() => {
          if (pdfStageRef.current) pdfStageRef.current.scrollTop = pdfStageRef.current.scrollHeight;
        })
        .catch(() => {})
        .finally(() => {
          isChangingPageRef.current = false;
        });
    }
  }

  return {
    pdfDoc,
    pdfDocRef,
    page,
    pageRef,
    zoom,
    outline,
    pageJumpInput,
    setPageJumpInput,
    loadingCount,
    stageLoadingLabel,
    pageTextCacheRef,
    withStageLoading,
    ensurePageText,
    renderPage,
    openDocument,
    resetReader,
    goPrevPage,
    goNextPage,
    jumpToPageInput,
    applyZoom,
    fitWidth,
    refitToStage,
    handleStageWheel,
  };
}
