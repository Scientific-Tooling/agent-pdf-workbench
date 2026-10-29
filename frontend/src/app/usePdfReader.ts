import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import * as pdfjsLib from "pdfjs-dist/build/pdf.mjs";
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import { useSyncedRef } from "../hooks/useSyncedRef";
import { buildPdfPageText, updateCanvasAndLayersSize } from "../pdf/pdf-layer";
import type { OutlineItem } from "../types/types";
import { clamp } from "../utils/main-utils";
import { DEFAULT_ZOOM, MAX_ZOOM, MIN_ZOOM } from "./app-types";
import type { PdfOutlineNode } from "./app-types";
import type { PageViewport, PDFDocumentProxy, TextContent } from "../types/pdfjs-types";
import { usePageCache } from "./usePageCache";
import {
  createDocumentPages,
  pageAtOffset,
  releaseDocumentPage,
  type DocumentPage,
  type PageSize,
} from "../pdf/document-pages";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

/** Breathing room kept between the page edge and the stage when fitting width. */
const STAGE_GUTTER_PX = 24;

type PdfLoadingTask = ReturnType<typeof pdfjsLib.getDocument>;

/** What is on screen: captured when the document opens, reported back on render. */
export interface OpenDocument {
  paperRef: string;
  pdfUri: string;
  sessionId: string;
  expectedSha256?: string;
  preserveView?: boolean;
}

export interface PdfReaderCallbacks {
  /**
   * Persist reading position after a page is on screen.
   *
   * The document identity comes from the render, not from ambient state, so
   * progress can never be filed under whatever paper was open previously.
   */
  onProgress: (
    page: number,
    zoom: number,
    document: OpenDocument,
    zoomMode: "fit" | "manual",
  ) => void;
  /** Record a page_change action event. */
  onPageChange: (page: number, totalPages: number, sessionId: string) => Promise<void>;
  /** Record a zoom_change action event. */
  onZoomChange: (zoom: number, page: number) => Promise<void>;
}

interface PdfReaderParams extends PdfReaderCallbacks {
  pdfStageRef: RefObject<HTMLDivElement | null>;
  pdfPagesRef: RefObject<HTMLDivElement | null>;
  pdfCanvasRef: RefObject<HTMLCanvasElement | null>;
  textLayerRef: RefObject<HTMLDivElement | null>;
  annotationLayerRef: RefObject<HTMLDivElement | null>;
}

/**
 * Owns the PDF document, page rendering, page/text caches, zoom, and outline.
 *
 * Page geometry spans the whole PDF. Rasters and text are owned by individual
 * page frames and retired when their document, zoom, or viewport changes.
 */
export function usePdfReader(params: PdfReaderParams) {
  const { pdfStageRef, pdfPagesRef, pdfCanvasRef, textLayerRef, annotationLayerRef } = params;
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
  const pagesRef = useRef<DocumentPage[]>([]);
  const sizesRef = useRef<PageSize[]>([]);
  const [layersRevision, setLayersRevision] = useState(0);
  const [renderError, setRenderError] = useState("");
  const lastReportedRef = useRef("");
  const openDocumentRef = useRef<OpenDocument | null>(null);
  // While true the page follows the window width. A manual zoom turns it off;
  // pressing Fit Width turns it back on.
  const followsWidthRef = useRef(true);
  const renderTokenRef = useRef(0);
  const documentGenerationRef = useRef(0);
  const loadingTaskRef = useRef<PdfLoadingTask | null>(null);
  const pageTextBoundariesRef = useRef(new Map<number, ReadonlySet<number>>());

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

  function clearViewerDom(keepCanvas = false): void {
    for (const frame of pagesRef.current) {
      frame.revision += 1;
      frame.cancelRender?.();
      frame.textLayer.replaceChildren();
      frame.annotationLayer.replaceChildren();
    }
    pagesRef.current = [];
    sizesRef.current = [];
    if (!keepCanvas) {
      pdfPagesRef.current?.replaceChildren();
      pdfCanvasRef.current = null;
      textLayerRef.current = null;
      annotationLayerRef.current = null;
    }
  }

  function isCurrentDocument(generation: number, doc: PDFDocumentProxy): boolean {
    return documentGenerationRef.current === generation && pdfDocRef.current === doc;
  }

  /** Retire every async operation that belongs to the document being replaced. */
  function invalidateDocument(keepCanvas = false): number {
    const generation = documentGenerationRef.current + 1;
    documentGenerationRef.current = generation;
    renderTokenRef.current += 1;

    const loadingTask = loadingTaskRef.current;
    loadingTaskRef.current = null;
    if (loadingTask) {
      void loadingTask.destroy().catch(() => {});
    }

    pdfDocRef.current = null;
    setPdfDoc(null);

    pageTextCacheRef.current.clear();
    pageTextBoundariesRef.current.clear();
    clearPageCache();
    clearViewerDom(keepCanvas);
    lastReportedRef.current = "";
    setRenderError("");
    return generation;
  }

  function resetReader(): void {
    openDocumentRef.current = null;
    invalidateDocument();
    setPage(1);
    pageRef.current = 1;
    setPageJumpInput("");
    setZoomLevel(DEFAULT_ZOOM);
    setOutline([]);
    setLoadingCount(0);
    setStageLoadingLabel("Loading PDF...");
    followsWidthRef.current = true;
  }

  function cachePageText(pageNumber: number, items: Parameters<typeof buildPdfPageText>[0]) {
    const model = buildPdfPageText(items);
    pageTextCacheRef.current.set(pageNumber, model.text);
    pageTextBoundariesRef.current.set(pageNumber, model.optionalWhitespace);
    return model;
  }

  async function ensurePageText(targetPage: number, doc?: PDFDocumentProxy): Promise<string> {
    const activeDoc = doc ?? pdfDocRef.current;
    const generation = documentGenerationRef.current;
    if (!activeDoc || !isCurrentDocument(generation, activeDoc)) {
      return "";
    }
    const cached = pageTextCacheRef.current.get(targetPage);
    if (cached !== undefined) {
      return cached;
    }
    const pdfPage = await activeDoc.getPage(targetPage);
    if (!isCurrentDocument(generation, activeDoc)) {
      return "";
    }
    const textContent = await pdfPage.getTextContent();
    if (!isCurrentDocument(generation, activeDoc)) {
      return "";
    }
    return cachePageText(targetPage, textContent.items).text;
  }

  async function paintPage(frame: DocumentPage): Promise<void> {
    if (frame.ready) return;
    if (frame.rendering) return frame.rendering;
    const generation = documentGenerationRef.current;
    const activeDoc = pdfDocRef.current;
    if (!activeDoc) return;
    const revision = frame.revision;
    const isStale = (): boolean =>
      !isCurrentDocument(generation, activeDoc) ||
      frame.revision !== revision ||
      pagesRef.current[frame.number - 1] !== frame;
    const { canvas, textLayer, annotationLayer } = frame;
    const pageNumber = frame.number;
    const work = async (): Promise<void> => {
      const activeZoom = zoomRef.current;
      const cached = pageCacheRef.current.get(pageNumber);
      const cacheHit = cached !== undefined && Math.abs(cached.zoom - activeZoom) < 0.001;

      let viewport!: PageViewport;
      let textContent!: TextContent;
      let pageImage!: CanvasImageSource;

      if (cacheHit) {
        cached!.lastUsedAt = Date.now();
        viewport = cached!.viewport;
        textContent = cached!.textContent;
        const buffer = document.createElement("canvas");
        buffer.width = viewport.width;
        buffer.height = viewport.height;
        const context = buffer.getContext("2d");
        if (!context) throw new Error("Cannot initialize 2d canvas context");
        context.drawImage(cached!.bitmap, 0, 0);
        pageImage = buffer;
      } else {
        await (async () => {
          const pdfPage = await activeDoc.getPage(pageNumber);
          if (isStale()) {
            return;
          }
          const vp = pdfPage.getViewport({ scale: activeZoom });
          // Render off screen so the visible page is never resized or cleared
          // before its replacement is complete.
          const buffer = document.createElement("canvas");
          buffer.width = vp.width;
          buffer.height = vp.height;
          const context = buffer.getContext("2d");
          if (!context) throw new Error("Cannot initialize 2d canvas context");
          const renderTask = pdfPage.render({
            canvas: buffer,
            canvasContext: context,
            viewport: vp,
          });
          frame.cancelRender = () => renderTask.cancel();
          try {
            await renderTask.promise;
          } catch (error) {
            if (isStale()) {
              return;
            }
            throw error;
          } finally {
            if (!isStale()) frame.cancelRender = undefined;
          }
          if (isStale()) {
            return;
          }
          const tc = await pdfPage.getTextContent();
          if (isStale()) {
            return;
          }
          const bitmap = await createImageBitmap(buffer);
          if (isStale()) {
            disposeBitmap(bitmap);
            return;
          }
          setPageCacheEntry(pageNumber, {
            bitmap,
            textContent: tc,
            viewport: vp,
            zoom: activeZoom,
          });
          viewport = vp;
          textContent = tc;
          pageImage = buffer;
        })();
      }

      if (isStale()) {
        return;
      }

      const nextTextLayer = document.createElement("div");
      nextTextLayer.className = "text-layer";
      nextTextLayer.style.setProperty(
        "--total-scale-factor",
        String(viewport.scale * viewport.userUnit),
      );
      const pdfTextLayer = new pdfjsLib.TextLayer({
        textContentSource: textContent,
        container: nextTextLayer,
        viewport,
      });
      frame.cancelRender = () => pdfTextLayer.cancel();
      try {
        await pdfTextLayer.render();
      } catch (error) {
        if (isStale()) {
          return;
        }
        throw error;
      } finally {
        if (!isStale()) frame.cancelRender = undefined;
      }
      if (isStale()) {
        return;
      }

      const textModel = cachePageText(pageNumber, textContent.items);
      for (let i = 0; i < pdfTextLayer.textDivs.length; i++) {
        const div = pdfTextLayer.textDivs[i];
        const str = pdfTextLayer.textContentItemsStr[i] ?? "";
        div.dataset.content = str;
        div.dataset.start = String(textModel.spans[i].start);
        div.dataset.end = String(textModel.spans[i].end);
      }
      if (isStale()) {
        return;
      }

      // Canvas, text and annotation geometry commit together, after the last
      // ownership check. A superseded render can never paint into a newer paper.
      textLayer.style.cssText = nextTextLayer.style.cssText;
      updateCanvasAndLayersSize(canvas, textLayer, annotationLayer, viewport);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Cannot initialize 2d canvas context");
      context.drawImage(pageImage, 0, 0);
      textLayer.replaceChildren(...nextTextLayer.childNodes);
      annotationLayer.replaceChildren();

      frame.ready = true;
      frame.element.setAttribute("aria-busy", "false");
      frame.element.removeAttribute("data-error");
      setLayersRevision((value) => value + 1);
    };
    const rendering = work();
    frame.rendering = rendering;
    try {
      await rendering;
    } catch (error) {
      if (!isStale()) {
        frame.element.dataset.error = "Page could not be rendered";
        frame.element.setAttribute("aria-busy", "false");
        throw error;
      }
    } finally {
      if (frame.rendering === rendering) frame.rendering = undefined;
    }
  }

  function activatePage(frame: DocumentPage): void {
    if (pdfCanvasRef.current !== frame.canvas) {
      pdfCanvasRef.current?.removeAttribute("id");
      textLayerRef.current?.removeAttribute("id");
      annotationLayerRef.current?.removeAttribute("id");
      frame.canvas.id = "pdfCanvas";
      frame.textLayer.id = "textLayer";
      frame.annotationLayer.id = "annotationLayer";
      pdfCanvasRef.current = frame.canvas;
      textLayerRef.current = frame.textLayer;
      annotationLayerRef.current = frame.annotationLayer;
    }
    if (pageRef.current !== frame.number) {
      setPageJumpInput(String(frame.number));
    }
    pageRef.current = frame.number;
    setPage(frame.number);
  }

  async function reportProgress(emitPageChange: boolean): Promise<void> {
    const doc = pdfDocRef.current;
    const openDoc = openDocumentRef.current;
    const frame = pagesRef.current[pageRef.current - 1];
    if (!doc || !openDoc || !frame?.ready) return;
    const key = `${documentGenerationRef.current}:${frame.number}:${zoomRef.current}`;
    if (lastReportedRef.current === key) return;
    lastReportedRef.current = key;
    callbacksRef.current.onProgress(
      frame.number,
      zoomRef.current,
      openDoc,
      followsWidthRef.current ? "fit" : "manual",
    );
    if (emitPageChange) {
      await callbacksRef.current.onPageChange(frame.number, doc.numPages, openDoc.sessionId);
    }
  }

  function stagePadding(): number {
    const stage = pdfStageRef.current;
    return stage ? Number.parseFloat(getComputedStyle(stage).paddingTop) || 0 : 0;
  }

  function pagesAreAttached(): boolean {
    return (
      !!pagesRef.current.length && pagesRef.current[0].element.parentElement === pdfPagesRef.current
    );
  }

  /** Paint visible pages plus a viewport of overscan, with bounded rendering work. */
  async function renderViewport(): Promise<void> {
    const stage = pdfStageRef.current;
    if (!stage || !pagesAreAttached()) return;
    const frames = pagesRef.current;
    const top = stage.scrollTop - stagePadding();
    const height = stage.clientHeight;
    const selection = window.getSelection();
    const nearby = frames
      .filter((frame) => {
        const keep = frame.top + frame.height >= top - height && frame.top <= top + height * 2;
        // Keep an in-progress selection intact even if the user scrolls it away.
        const selected =
          !!selection?.rangeCount &&
          (frame.element.contains(selection.anchorNode) ||
            frame.element.contains(selection.focusNode));
        if (!keep && !selected && (frame.ready || frame.rendering)) releaseDocumentPage(frame);
        return keep;
      })
      .sort((a, b) => Math.abs(a.number - pageRef.current) - Math.abs(b.number - pageRef.current));
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < nearby.length && frames === pagesRef.current) {
        const frame = nearby[cursor++];
        // A more recent scroll may have moved the window while the prior page painted.
        const currentTop = stage.scrollTop - stagePadding();
        if (frame.top + frame.height < currentTop - height || frame.top > currentTop + height * 2)
          continue;
        await paintPage(frame);
      }
    };
    await Promise.all([worker(), worker()]);
    if (frames === pagesRef.current) await reportProgress(true);
  }

  function refreshViewport(): void {
    const generation = documentGenerationRef.current;
    void renderViewport().catch((error: unknown) => {
      if (documentGenerationRef.current === generation) {
        setRenderError(error instanceof Error ? error.message : "Unable to render this page");
      }
    });
  }

  function handleStageScroll(): void {
    const stage = pdfStageRef.current;
    if (!stage || !pagesAreAttached()) return;
    const frame = pageAtOffset(
      pagesRef.current,
      stage.scrollTop - stagePadding() + Math.min(120, stage.clientHeight / 4),
    );
    if (frame) activatePage(frame);
    refreshViewport();
  }

  /** Explicit navigation scrolls within the same document; it never replaces its extent. */
  async function renderPage(pageNumber: number, emitPageChange: boolean): Promise<void> {
    const frame = pagesRef.current[pageNumber - 1];
    const stage = pdfStageRef.current;
    if (!frame || !stage || !pagesAreAttached()) return;
    const token = ++renderTokenRef.current;
    activatePage(frame);
    stage.scrollTop = frame.top;
    setRenderError("");
    refreshViewport();
    await paintPage(frame);
    if (token !== renderTokenRef.current || pagesRef.current[pageNumber - 1] !== frame) return;
    await reportProgress(emitPageChange);
  }

  async function rebuildPages(pageNumber: number, fraction = 0): Promise<void> {
    const stage = pdfStageRef.current;
    const root = pdfPagesRef.current;
    if (!stage || !root) return;
    const token = ++renderTokenRef.current;
    const oldFrames = pagesRef.current;
    for (const frame of oldFrames) {
      frame.revision += 1;
      frame.cancelRender?.();
    }
    const frames = createDocumentPages(sizesRef.current, zoomRef.current);
    pagesRef.current = frames;
    const target = frames[pageNumber - 1];
    if (!target) return;
    // Keep the previous paper/zoom visible until the new target has pixels and text.
    await paintPage(target);
    if (pagesRef.current !== frames || token !== renderTokenRef.current) return;
    root.replaceChildren(...frames.map((frame) => frame.element));
    root.style.width = `${sizesRef.current.reduce((width, size) => Math.max(width, size.width), 0) * zoomRef.current}px`;
    activatePage(target);
    setPageJumpInput(String(pageNumber));
    stage.scrollTop = target.top + target.height * fraction;
    setLayersRevision((value) => value + 1);
    for (const frame of oldFrames) releaseDocumentPage(frame);
    refreshViewport();
  }

  const getRenderedPages = useCallback((): DocumentPage[] => {
    return pagesRef.current[0]?.element.parentElement === pdfPagesRef.current
      ? pagesRef.current.filter((frame) => frame.ready)
      : [];
  }, [pdfPagesRef]);

  /** Resolve the selected page from its DOM owner, not the toolbar's reading position. */
  function getSelectionPage(): DocumentPage | undefined {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    return getRenderedPages().find((frame) =>
      frame.textLayer.contains(range.commonAncestorContainer),
    );
  }

  useEffect(() => {
    return () => {
      documentGenerationRef.current += 1;
      for (const frame of pagesRef.current) releaseDocumentPage(frame);
      void loadingTaskRef.current?.destroy().catch(() => {});
    };
  }, []);

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

  async function buildOutline(doc: PDFDocumentProxy, generation: number): Promise<void> {
    const docOutline = await doc.getOutline();
    if (!isCurrentDocument(generation, doc)) {
      return;
    }
    if (!docOutline || docOutline.length === 0) {
      setOutline([]);
      return;
    }
    const next: OutlineItem[] = [];
    async function walk(nodes: PdfOutlineNode[], level: number): Promise<void> {
      for (const node of nodes) {
        const outlinePage = await resolveOutlinePage(doc, node.dest);
        if (!isCurrentDocument(generation, doc)) {
          return;
        }
        if (outlinePage !== null) {
          next.push({ title: node.title || "Untitled", page: outlinePage, level });
        }
        if (node.items && node.items.length > 0) {
          await walk(node.items, level + 1);
        }
      }
    }
    await walk(docOutline, 0);
    if (!isCurrentDocument(generation, doc)) {
      return;
    }
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
    const preserveView = params.preserveView && openDocumentRef.current !== null;
    const generation = invalidateDocument(!!preserveView);
    openDocumentRef.current = {
      paperRef: params.paperRef,
      pdfUri: params.pdfUri,
      sessionId: params.sessionId,
    };
    // A saved zoom is the reader's own choice and wins; without one the page
    // fits the width it actually has.
    if (!preserveView) {
      followsWidthRef.current = params.zoom === undefined;
      setZoomLevel(params.zoom ?? DEFAULT_ZOOM);
    }
    setPage(params.page);
    pageRef.current = params.page;
    setPageJumpInput(String(params.page));
    setOutline([]);
    await loadPdf(params.pdfUri, params.page, generation, params.expectedSha256);
  }

  async function loadPdf(
    nextPdfUri: string,
    preferredPage: number,
    generation: number,
    expectedSha256?: string,
  ): Promise<void> {
    const source = `/api/pdf?uri=${encodeURIComponent(nextPdfUri)}`;
    await withStageLoading("Loading PDF...", async () => {
      let loadingTask: PdfLoadingTask | null = null;
      let doc: PDFDocumentProxy | null = null;
      let keepLoadingTask = false;
      try {
        if (expectedSha256) {
          const response = await fetch(`${source}&sha256=${encodeURIComponent(expectedSha256)}`);
          if (!response.ok) {
            const error = (await response.json()) as { error?: string };
            throw new Error(
              error.error ?? "Exact source PDF is unavailable. Restore the reading snapshot.",
            );
          }
          const data = new Uint8Array(await response.arrayBuffer());
          if (documentGenerationRef.current !== generation) return;
          // PDF.js consumes these exact verified bytes; it cannot issue a later
          // range request against a file that has since been replaced.
          loadingTask = pdfjsLib.getDocument({ data });
        } else {
          loadingTask = pdfjsLib.getDocument({ url: source });
        }
        loadingTaskRef.current = loadingTask;
        doc = await loadingTask.promise;
        if (
          documentGenerationRef.current !== generation ||
          loadingTaskRef.current !== loadingTask
        ) {
          void loadingTask.destroy().catch(() => {});
          return;
        }
        keepLoadingTask = true;
        setPdfDoc(doc);
        pdfDocRef.current = doc;
        pageTextCacheRef.current.clear();
        pageTextBoundariesRef.current.clear();
        clearPageCache();
        // Outline resolution is independent of showing the first page.
        void buildOutline(doc, generation).catch(() => {});
        if (!isCurrentDocument(generation, doc)) {
          return;
        }
        pageRef.current = clamp(preferredPage, 1, doc.numPages);
        if (!isCurrentDocument(generation, doc)) {
          return;
        }
        if (
          expectedSha256 &&
          (!Number.isInteger(preferredPage) || preferredPage < 1 || preferredPage > doc.numPages)
        ) {
          throw new Error(
            `Cited page ${preferredPage} is outside this PDF (1–${doc.numPages}). Repair the source anchor.`,
          );
        }
        const normalizedPage = clamp(preferredPage, 1, doc.numPages);
        // Read page dimensions, not rasters, so the scrollbar has the correct
        // whole-document extent from the moment the paper becomes interactive.
        const sizes: PageSize[] = new Array(doc.numPages);
        let next = 1;
        const readSizes = async (): Promise<void> => {
          while (next <= doc!.numPages && isCurrentDocument(generation, doc!)) {
            const number = next++;
            const pdfPage = await doc!.getPage(number);
            const viewport = pdfPage.getViewport({ scale: 1 });
            sizes[number - 1] = { width: viewport.width, height: viewport.height };
          }
        };
        await Promise.all(Array.from({ length: Math.min(4, doc.numPages) }, readSizes));
        if (!isCurrentDocument(generation, doc)) return;
        sizesRef.current = sizes;
        if (followsWidthRef.current) {
          const fitted = await widthFittingScale(generation, doc);
          if (!isCurrentDocument(generation, doc)) {
            return;
          }
          if (fitted !== null) {
            setZoomLevel(fitted);
          }
        }
        if (pdfStageRef.current) pdfStageRef.current.scrollLeft = 0;
        await rebuildPages(normalizedPage);
        if (isCurrentDocument(generation, doc)) await reportProgress(true);
      } catch (error) {
        if (loadingTask === null) {
          throw error;
        }
        const stillCurrent = doc
          ? isCurrentDocument(generation, doc)
          : documentGenerationRef.current === generation && loadingTaskRef.current === loadingTask;
        if (stillCurrent) {
          throw error;
        }
      } finally {
        if (loadingTask && loadingTaskRef.current === loadingTask && !keepLoadingTask) {
          loadingTaskRef.current = null;
        }
      }
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
    const generation = documentGenerationRef.current;
    if (!doc) {
      return;
    }
    if (options.manual !== false) {
      followsWidthRef.current = false;
    }
    // Fitting a small viewport or a wide PDF must be allowed below the manual
    // zoom floor. Zooming out from that fit must never make the page larger.
    const minimum = options.manual === false ? 0 : Math.min(MIN_ZOOM, zoomRef.current);
    const normalized = clamp(nextZoom, minimum, MAX_ZOOM);
    if (Math.abs(normalized - zoomRef.current) < 0.001) {
      const openDoc = openDocumentRef.current;
      if (openDoc)
        callbacksRef.current.onProgress(
          pageRef.current,
          zoomRef.current,
          openDoc,
          followsWidthRef.current ? "fit" : "manual",
        );
      return;
    }
    const oldFrame = pagesRef.current[pageRef.current - 1];
    const fraction =
      oldFrame && pdfStageRef.current
        ? (pdfStageRef.current.scrollTop - oldFrame.top) / oldFrame.height
        : 0;
    clearPageCache();
    setZoomLevel(normalized);
    await callbacksRef.current.onZoomChange(normalized, pageRef.current);
    if (!isCurrentDocument(generation, doc)) {
      return;
    }
    await rebuildPages(pageRef.current, fraction);
    if (isCurrentDocument(generation, doc)) await reportProgress(false);
  }

  async function fitWidth(options: { manual?: boolean } = {}): Promise<void> {
    const generation = documentGenerationRef.current;
    const doc = pdfDocRef.current;
    const scale = await widthFittingScale(generation, doc ?? undefined);
    if (scale === null || !doc || !isCurrentDocument(generation, doc)) {
      return;
    }
    // A resize-triggered refit must not overwrite a manual zoom chosen while
    // getPage was waiting for pdf.js.
    if (options.manual === false && !followsWidthRef.current) {
      return;
    }
    if (options.manual !== false) followsWidthRef.current = true;
    await applyZoom(scale, { manual: false });
    if (!isCurrentDocument(generation, doc)) {
      return;
    }
    if (options.manual !== false) {
      // An explicit Fit Width means "keep doing this as the window changes".
      followsWidthRef.current = true;
      const openDoc = openDocumentRef.current;
      if (openDoc)
        callbacksRef.current.onProgress(pageRef.current, zoomRef.current, openDoc, "fit");
    }
  }

  async function widthFittingScale(
    generation = documentGenerationRef.current,
    docOverride?: PDFDocumentProxy,
  ): Promise<number | null> {
    const doc = docOverride ?? pdfDocRef.current;
    const stage = pdfStageRef.current;
    if (!doc || !stage || stage.clientWidth <= 0 || !isCurrentDocument(generation, doc)) {
      return null;
    }
    let pageWidth = sizesRef.current.reduce((width, size) => Math.max(width, size.width), 0);
    if (!pageWidth) {
      const activePage = await doc.getPage(pageRef.current);
      if (!isCurrentDocument(generation, doc)) return null;
      pageWidth = activePage.getViewport({ scale: 1 }).width;
    }
    const computedStyle = window.getComputedStyle(stage);
    const paddingLeft = Number.parseFloat(computedStyle.paddingLeft) || 0;
    const paddingRight = Number.parseFloat(computedStyle.paddingRight) || 0;
    const contentWidth = Math.max(
      0,
      stage.clientWidth - paddingLeft - paddingRight - STAGE_GUTTER_PX,
    );
    return contentWidth > 0 ? Math.min(contentWidth / pageWidth, MAX_ZOOM) : null;
  }

  /** Refit after the stage resizes, but only while the page is following it. */
  function refitToStage(): void {
    if (!followsWidthRef.current || !pdfDocRef.current) {
      return;
    }
    void fitWidth({ manual: false });
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
    pageTextBoundariesRef,
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
    handleStageScroll,
    getRenderedPages,
    getSelectionPage,
    layersRevision,
    renderError,
  };
}
