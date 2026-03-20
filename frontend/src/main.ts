import * as pdfjsLib from "pdfjs-dist/build/pdf.mjs";

import { apiGet, apiPost } from "./api";
import { getUiElements } from "./dom";
import { getProgress, getRecentPapers, upsertProgress, upsertRecentPaper } from "./storage";
import { createEventListItem } from "./timeline";
import type {
  ActionEvent,
  Annotation,
  AnnotationType,
  ListActionsResponse,
  Note,
  NormalizedRect,
  OutlineItem,
  PaperSession,
  ReadingProgress,
  SearchResult,
} from "./types";

import "./styles.css";

interface PdfViewportLike {
  width: number;
  height: number;
  transform: number[];
}

interface PdfOutlineNode {
  title?: string;
  dest?: unknown;
  items?: PdfOutlineNode[];
}

interface PdfPageLike {
  getViewport(params: { scale: number }): PdfViewportLike;
  render(params: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewportLike }): {
    promise: Promise<void>;
  };
  getTextContent(): Promise<{ items: Array<Record<string, unknown>> }>;
}

interface PdfDocumentLike {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageLike>;
  getOutline(): Promise<PdfOutlineNode[] | null>;
  getDestination(dest: string): Promise<unknown>;
  getPageIndex(ref: unknown): Promise<number>;
}

interface PendingSelection {
  rects: NormalizedRect[];
  quote: string;
  anchorX: number;
  anchorY: number;
}

type ToastType = "success" | "warning" | "error" | "info";

interface AppState {
  session: PaperSession | null;
  pdfDoc: PdfDocumentLike | null;
  paperRef: string;
  pdfUri: string;
  page: number;
  zoom: number;
  annotations: Annotation[];
  selectedAnnotationId: string | null;
  notes: Note[];
  selectedNoteId: string | null;
  searchQuery: string;
  searchResults: SearchResult[];
  searchCursor: number;
  pageTextCache: Map<number, string>;
  outline: OutlineItem[];
  loadingCount: number;
  pendingSelection: PendingSelection | null;
}

const DEFAULT_AGENT_ID = "agent:browser-ui";
const DEFAULT_USER_ID = "user:local";
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3.5;
const ZOOM_STEP = 0.2;

const state: AppState = {
  session: null,
  pdfDoc: null,
  paperRef: "",
  pdfUri: "",
  page: 1,
  zoom: 1.35,
  annotations: [],
  selectedAnnotationId: null,
  notes: [],
  selectedNoteId: null,
  searchQuery: "",
  searchResults: [],
  searchCursor: 0,
  pageTextCache: new Map(),
  outline: [],
  loadingCount: 0,
  pendingSelection: null,
};

const els = getUiElements();

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

function nowIso(): string {
  return new Date().toISOString();
}

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Unknown error";
}

function setStatus(text: string): void {
  els.statusText.textContent = `Status: ${text}`;
}

function reportError(error: unknown, fallback = "Operation failed"): void {
  const message = errorMessage(error) || fallback;
  setStatus(message);
  showToast(message, "error", 3200);
}

function showToast(message: string, type: ToastType = "info", timeoutMs = 2200): void {
  const toast = document.createElement("div");
  toast.className = "toast";
  if (type !== "info") {
    toast.classList.add(type);
  }
  toast.textContent = message;
  els.toastStack.appendChild(toast);
  window.setTimeout(() => {
    toast.remove();
  }, timeoutMs);
}

function setLoading(loading: boolean, label = "Loading PDF..."): void {
  if (loading) {
    state.loadingCount += 1;
    els.stageLoading.textContent = label;
    els.stageLoading.classList.remove("hidden");
    return;
  }
  state.loadingCount = Math.max(0, state.loadingCount - 1);
  if (state.loadingCount === 0) {
    els.stageLoading.classList.add("hidden");
  }
}

async function withStageLoading<T>(label: string, task: () => Promise<T>): Promise<T> {
  setLoading(true, label);
  try {
    return await task();
  } finally {
    setLoading(false);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function parseLinkedIds(raw: string): string[] {
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function updateZoomInfo(): void {
  els.zoomInfo.textContent = `${Math.round(state.zoom * 100)}%`;
}

function hideQuickAnnotator(clearPending = true): void {
  els.quickAnnotator.classList.add("hidden");
  if (clearPending) {
    state.pendingSelection = null;
  }
}

function showQuickAnnotator(selection: PendingSelection): void {
  state.pendingSelection = selection;
  const left = clamp(selection.anchorX + 8, 8, Math.max(8, els.pdfStage.clientWidth - 320));
  const top = clamp(selection.anchorY - 56, 8, Math.max(8, els.pdfStage.clientHeight - 120));
  els.quickAnnotator.style.left = `${left}px`;
  els.quickAnnotator.style.top = `${top}px`;
  els.quickCommentInput.value = "";
  els.quickAnnotator.classList.remove("hidden");
}

function selectedAnnotation(): Annotation | null {
  if (!state.selectedAnnotationId) {
    return null;
  }
  return (
    state.annotations.find((annotation) => annotation.id === state.selectedAnnotationId) ?? null
  );
}

function selectedNote(): Note | null {
  if (!state.selectedNoteId) {
    return null;
  }
  return state.notes.find((note) => note.id === state.selectedNoteId) ?? null;
}

function persistReadingProgress(): void {
  if (!state.session) {
    return;
  }
  const progress: ReadingProgress = {
    paperRef: state.paperRef,
    pdfUri: state.pdfUri,
    sessionId: state.session.id,
    lastPage: state.page,
    zoom: state.zoom,
    updatedAt: nowIso(),
  };
  upsertProgress(progress);
  upsertRecentPaper({
    paperRef: progress.paperRef,
    pdfUri: progress.pdfUri,
    sessionId: progress.sessionId,
    lastPage: progress.lastPage,
    updatedAt: progress.updatedAt,
  });
}

function renderRecentList(): void {
  const recent = getRecentPapers();
  els.recentList.innerHTML = "";
  if (recent.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No recent papers";
    li.classList.add("muted");
    els.recentList.appendChild(li);
    return;
  }

  for (const paper of recent) {
    const li = document.createElement("li");
    const title = document.createElement("div");
    title.textContent = `${paper.paperRef} (p.${paper.lastPage})`;
    li.appendChild(title);

    const meta = document.createElement("div");
    meta.textContent = paper.pdfUri;
    meta.classList.add("muted");
    li.appendChild(meta);

    const button = document.createElement("button");
    button.textContent = "Load";
    button.addEventListener("click", () => {
      els.paperRef.value = paper.paperRef;
      els.pdfUri.value = paper.pdfUri;
      setStatus(`Loaded recent paper. Resume suggestion: page ${paper.lastPage}`);
    });
    li.appendChild(button);
    els.recentList.appendChild(li);
  }
}

function setSelectedAnnotation(annotationId: string | null): void {
  state.selectedAnnotationId = annotationId;
  const annotation = selectedAnnotation();
  if (!annotation) {
    els.selectedAnnotationInfo.textContent = "Selected annotation: -";
    els.annotationCommentInput.value = "";
    els.annotationTagsInput.value = "";
  } else {
    els.selectedAnnotationInfo.textContent = `Selected annotation: ${annotation.id}`;
    els.annotationCommentInput.value = annotation.comment;
    els.annotationTagsInput.value = annotation.tags.join(", ");
  }
  renderAnnotationList();
  renderAnnotationLayer();
}

function setSelectedNote(noteId: string | null): void {
  state.selectedNoteId = noteId;
  const note = selectedNote();
  if (!note) {
    els.selectedNoteInfo.textContent = "Selected note: -";
    els.noteTitleInput.value = "";
    els.noteMarkdownInput.value = "";
    els.noteLinkedIdsInput.value = "";
  } else {
    els.selectedNoteInfo.textContent = `Selected note: ${note.id}`;
    els.noteTitleInput.value = note.title;
    els.noteMarkdownInput.value = note.markdown;
    els.noteLinkedIdsInput.value = note.linkedAnnotationIds.join(", ");
  }
  renderNotesList();
}

function downloadFile(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function renderAnnotationList(): void {
  els.annotationList.innerHTML = "";
  const annotations = state.annotations
    .slice()
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

  if (annotations.length === 0) {
    const li = document.createElement("li");
    li.classList.add("muted");
    li.textContent = "No annotations yet";
    els.annotationList.appendChild(li);
    return;
  }

  for (const annotation of annotations) {
    const li = document.createElement("li");
    if (annotation.id === state.selectedAnnotationId) {
      li.style.borderColor = "#0ea5e9";
    }
    const line1 = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = annotation.type;
    line1.appendChild(strong);
    line1.append(` | p.${annotation.page}`);
    li.appendChild(line1);

    const line2 = document.createElement("div");
    line2.textContent = annotation.quote || "(empty quote)";
    li.appendChild(line2);

    const line3 = document.createElement("div");
    line3.classList.add("muted");
    line3.textContent = annotation.comment || "No comment";
    li.appendChild(line3);

    if (annotation.tags.length > 0) {
      const tags = document.createElement("div");
      tags.className = "pill-list";
      for (const tag of annotation.tags) {
        const pill = document.createElement("span");
        pill.className = "pill";
        pill.textContent = tag;
        tags.appendChild(pill);
      }
      li.appendChild(tags);
    }

    const openButton = document.createElement("button");
    openButton.textContent = "Go";
    openButton.addEventListener("click", async () => {
      await jumpToAnnotation(annotation.id);
    });
    li.appendChild(openButton);

    li.addEventListener("click", () => {
      setSelectedAnnotation(annotation.id);
    });
    els.annotationList.appendChild(li);
  }
}

function renderNotesList(): void {
  els.notesList.innerHTML = "";
  const notes = state.notes.slice().sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

  if (notes.length === 0) {
    const li = document.createElement("li");
    li.classList.add("muted");
    li.textContent = "No notes yet";
    els.notesList.appendChild(li);
    return;
  }

  for (const note of notes) {
    const li = document.createElement("li");
    if (note.id === state.selectedNoteId) {
      li.style.borderColor = "#0ea5e9";
    }
    const title = document.createElement("div");
    const titleStrong = document.createElement("strong");
    titleStrong.textContent = note.title || "(untitled note)";
    title.appendChild(titleStrong);
    li.appendChild(title);

    const content = document.createElement("div");
    content.textContent =
      note.markdown.length > 160 ? `${note.markdown.slice(0, 160)}...` : note.markdown;
    li.appendChild(content);

    if (note.linkedAnnotationIds.length > 0) {
      const links = document.createElement("div");
      links.className = "pill-list";
      for (const annId of note.linkedAnnotationIds) {
        const button = document.createElement("button");
        button.className = "pill";
        button.textContent = annId;
        button.addEventListener("click", async (event) => {
          event.stopPropagation();
          await jumpToAnnotation(annId);
        });
        links.appendChild(button);
      }
      li.appendChild(links);
    }

    li.addEventListener("click", () => {
      setSelectedNote(note.id);
    });
    els.notesList.appendChild(li);
  }
}

function renderSearchResults(): void {
  els.searchResultsList.innerHTML = "";
  if (!state.searchQuery) {
    const li = document.createElement("li");
    li.textContent = "No query";
    li.classList.add("muted");
    els.searchResultsList.appendChild(li);
    return;
  }
  if (state.searchResults.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No matches";
    li.classList.add("muted");
    els.searchResultsList.appendChild(li);
    return;
  }

  state.searchResults.forEach((result, index) => {
    const li = document.createElement("li");
    if (index === state.searchCursor) {
      li.style.borderColor = "#0ea5e9";
    }
    const line1 = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = `p.${result.page}`;
    line1.appendChild(strong);
    li.appendChild(line1);

    const line2 = document.createElement("div");
    line2.textContent = result.snippet;
    li.appendChild(line2);
    li.addEventListener("click", async () => {
      await jumpToSearchResult(index);
    });
    els.searchResultsList.appendChild(li);
  });
}

function applySearchHighlightsToCurrentPage(): void {
  const query = state.searchQuery.trim().toLowerCase();
  const spans = Array.from(els.textLayer.querySelectorAll("span"));
  const activeResult = state.searchResults[state.searchCursor] ?? null;
  let markedCurrent = false;
  for (const span of spans) {
    span.classList.remove("search-hit");
    span.classList.remove("current-hit");
    const text = (span as HTMLElement).dataset.content ?? "";
    if (query && text.toLowerCase().includes(query)) {
      span.classList.add("search-hit");
      if (activeResult && activeResult.page === state.page) {
        const start = Number((span as HTMLElement).dataset.start ?? "-1");
        const end = Number((span as HTMLElement).dataset.end ?? "-1");
        if (
          !markedCurrent &&
          Number.isFinite(start) &&
          Number.isFinite(end) &&
          activeResult.matchIndex >= start &&
          activeResult.matchIndex <= end
        ) {
          span.classList.add("current-hit");
          markedCurrent = true;
        }
      }
    }
  }
  if (!markedCurrent && activeResult && activeResult.page === state.page) {
    const firstHit = els.textLayer.querySelector("span.search-hit");
    if (firstHit) {
      firstHit.classList.add("current-hit");
    }
  }
}

function denormalizeRect(rect: NormalizedRect, width: number, height: number): NormalizedRect {
  return {
    x: rect.x * width,
    y: rect.y * height,
    width: rect.width * width,
    height: rect.height * height,
  };
}

function renderAnnotationLayer(): void {
  els.annotationLayer.innerHTML = "";
  const width = els.textLayer.clientWidth;
  const height = els.textLayer.clientHeight;

  for (const annotation of state.annotations) {
    if (annotation.page !== state.page) {
      continue;
    }
    for (const rect of annotation.rects) {
      const realRect = denormalizeRect(rect, width, height);
      const mark = document.createElement("div");
      mark.className = `annotation-mark ${annotation.type}`;
      if (annotation.id === state.selectedAnnotationId) {
        mark.classList.add("selected");
      }
      mark.style.left = `${realRect.x}px`;
      mark.style.top = `${realRect.y}px`;
      mark.style.width = `${realRect.width}px`;
      mark.style.height = `${realRect.height}px`;
      mark.addEventListener("click", (event) => {
        event.stopPropagation();
        setSelectedAnnotation(annotation.id);
      });
      els.annotationLayer.appendChild(mark);
    }
  }
}

function updateSearchInfo(): void {
  if (!state.searchQuery) {
    els.searchInfo.textContent = "No search";
    return;
  }
  if (state.searchResults.length === 0) {
    els.searchInfo.textContent = "0 matches";
    return;
  }
  els.searchInfo.textContent = `${state.searchCursor + 1}/${state.searchResults.length} matches`;
}

function readTextFromPdfItems(items: Array<Record<string, unknown>>): string {
  return items
    .map((item) => {
      const maybeText = item.str;
      return typeof maybeText === "string" ? maybeText : "";
    })
    .join(" ");
}

function multiplyTransforms(a: number[], b: number[]): number[] {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function renderTextLayer(viewport: PdfViewportLike, items: Array<Record<string, unknown>>): void {
  els.textLayer.innerHTML = "";
  els.textLayer.style.width = `${viewport.width}px`;
  els.textLayer.style.height = `${viewport.height}px`;
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
    els.textLayer.appendChild(span);
    textCursor += item.str.length + 1;
  }
}

function updateCanvasAndLayersSize(viewport: PdfViewportLike): void {
  els.pdfCanvas.width = viewport.width;
  els.pdfCanvas.height = viewport.height;
  els.pdfCanvas.style.width = `${viewport.width}px`;
  els.pdfCanvas.style.height = `${viewport.height}px`;

  els.textLayer.style.width = `${viewport.width}px`;
  els.textLayer.style.height = `${viewport.height}px`;
  els.annotationLayer.style.width = `${viewport.width}px`;
  els.annotationLayer.style.height = `${viewport.height}px`;
}

async function recordAction(
  eventType: string,
  payload: Record<string, unknown> = {},
  page: number | null = state.page,
  selectionText: string | null = null,
): Promise<void> {
  if (!state.session) {
    return;
  }
  try {
    await apiPost("/api/record-action", {
      session_id: state.session.id,
      event_type: eventType,
      page,
      selection_text: selectionText,
      payload,
      source: "viewer",
    });
  } catch (error) {
    setStatus(`record_action failed: ${errorMessage(error)}`);
  }
}

async function renderPage(pageNumber: number, emitPageChange: boolean): Promise<void> {
  if (!state.pdfDoc) {
    return;
  }
  await withStageLoading("Rendering page...", async () => {
    const page = await state.pdfDoc!.getPage(pageNumber);
    const viewport = page.getViewport({ scale: state.zoom });
    updateCanvasAndLayersSize(viewport);

    const context = els.pdfCanvas.getContext("2d");
    if (!context) {
      throw new Error("Cannot initialize 2d canvas context");
    }
    await page.render({ canvasContext: context, viewport }).promise;

    const textContent = await page.getTextContent();
    renderTextLayer(viewport, textContent.items);
    applySearchHighlightsToCurrentPage();
    renderAnnotationLayer();

    const pageText = readTextFromPdfItems(textContent.items);
    state.pageTextCache.set(pageNumber, pageText);

    state.page = pageNumber;
    els.pageInfo.textContent = `Page ${state.page} / ${state.pdfDoc!.numPages}`;
    els.pageJumpInput.value = String(state.page);
    persistReadingProgress();

    if (emitPageChange) {
      await recordAction("page_change", { total_pages: state.pdfDoc!.numPages }, pageNumber);
    }
  });
}

function upsertAnnotation(annotation: Annotation): void {
  const next = state.annotations.filter((item) => item.id !== annotation.id);
  next.push(annotation);
  state.annotations = next;
  setSelectedAnnotation(annotation.id);
}

function deleteAnnotation(annotationId: string): void {
  state.annotations = state.annotations.filter((annotation) => annotation.id !== annotationId);
  if (state.selectedAnnotationId === annotationId) {
    setSelectedAnnotation(null);
  }
  renderAnnotationList();
  renderAnnotationLayer();
}

function upsertNote(note: Note): void {
  const next = state.notes.filter((item) => item.id !== note.id);
  next.push(note);
  state.notes = next;
  setSelectedNote(note.id);
}

function deleteNote(noteId: string): void {
  state.notes = state.notes.filter((note) => note.id !== noteId);
  if (state.selectedNoteId === noteId) {
    setSelectedNote(null);
  }
  renderNotesList();
}

function asAnnotation(value: unknown): Annotation | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = value as Partial<Annotation>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.page !== "number" ||
    (candidate.type !== "highlight" && candidate.type !== "underline") ||
    !Array.isArray(candidate.rects)
  ) {
    return null;
  }
  return {
    id: candidate.id,
    page: candidate.page,
    type: candidate.type,
    quote: typeof candidate.quote === "string" ? candidate.quote : "",
    comment: typeof candidate.comment === "string" ? candidate.comment : "",
    tags: Array.isArray(candidate.tags)
      ? candidate.tags.filter((tag): tag is string => typeof tag === "string")
      : [],
    rects: candidate.rects.filter((rect): rect is NormalizedRect => {
      if (typeof rect !== "object" || rect === null) {
        return false;
      }
      const cast = rect as Partial<NormalizedRect>;
      return (
        typeof cast.x === "number" &&
        typeof cast.y === "number" &&
        typeof cast.width === "number" &&
        typeof cast.height === "number"
      );
    }),
    createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : nowIso(),
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : nowIso(),
  };
}

function asNote(value: unknown): Note | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = value as Partial<Note>;
  if (typeof candidate.id !== "string") {
    return null;
  }
  return {
    id: candidate.id,
    title: typeof candidate.title === "string" ? candidate.title : "",
    markdown: typeof candidate.markdown === "string" ? candidate.markdown : "",
    linkedAnnotationIds: Array.isArray(candidate.linkedAnnotationIds)
      ? candidate.linkedAnnotationIds.filter((value): value is string => typeof value === "string")
      : [],
    createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : nowIso(),
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : nowIso(),
  };
}

function applyDomainStateFromEvents(events: ActionEvent[]): void {
  state.annotations = [];
  state.notes = [];
  for (const event of events) {
    if (event.event_type === "annotation_upsert") {
      const annotation = asAnnotation(event.payload.annotation);
      if (annotation) {
        upsertAnnotation(annotation);
      }
      continue;
    }
    if (event.event_type === "annotation_delete") {
      const annotationId = event.payload.annotation_id;
      if (typeof annotationId === "string") {
        deleteAnnotation(annotationId);
      }
      continue;
    }
    if (event.event_type === "note_upsert") {
      const note = asNote(event.payload.note);
      if (note) {
        upsertNote(note);
      }
      continue;
    }
    if (event.event_type === "note_delete") {
      const noteId = event.payload.note_id;
      if (typeof noteId === "string") {
        deleteNote(noteId);
      }
    }
  }
  renderAnnotationList();
  renderNotesList();
  renderAnnotationLayer();
}

async function refreshEvents(applyDomainState = false): Promise<void> {
  if (!state.session) {
    return;
  }
  const data = await apiGet<ListActionsResponse>(
    `/api/list-actions?session_id=${encodeURIComponent(state.session.id)}&limit=1000`,
  );

  els.eventsList.innerHTML = "";
  for (const event of data.events) {
    els.eventsList.appendChild(createEventListItem(event));
  }

  if (applyDomainState) {
    applyDomainStateFromEvents(data.events);
  }
}

async function ensurePageText(page: number): Promise<string> {
  const cached = state.pageTextCache.get(page);
  if (cached !== undefined) {
    return cached;
  }
  if (!state.pdfDoc) {
    return "";
  }
  const pdfPage = await state.pdfDoc.getPage(page);
  const textContent = await pdfPage.getTextContent();
  const text = readTextFromPdfItems(textContent.items);
  state.pageTextCache.set(page, text);
  return text;
}

async function runSearch(queryRaw: string): Promise<void> {
  state.searchQuery = queryRaw.trim();
  state.searchResults = [];
  state.searchCursor = 0;

  if (!state.searchQuery || !state.pdfDoc) {
    renderSearchResults();
    updateSearchInfo();
    applySearchHighlightsToCurrentPage();
    return;
  }

  const query = state.searchQuery.toLowerCase();
  await withStageLoading("Searching document...", async () => {
    for (let page = 1; page <= state.pdfDoc!.numPages; page += 1) {
      const text = await ensurePageText(page);
      const lower = text.toLowerCase();
      let startIndex = 0;
      while (true) {
        const hit = lower.indexOf(query, startIndex);
        if (hit === -1) {
          break;
        }
        const snippetStart = Math.max(0, hit - 40);
        const snippetEnd = Math.min(text.length, hit + state.searchQuery.length + 40);
        state.searchResults.push({
          page,
          snippet: text.slice(snippetStart, snippetEnd).replace(/\s+/g, " "),
          matchIndex: hit,
        });
        startIndex = hit + state.searchQuery.length;
        if (state.searchResults.length >= 300) {
          break;
        }
      }
      if (state.searchResults.length >= 300) {
        break;
      }
    }
  });

  if (state.searchResults.length > 0) {
    await jumpToSearchResult(0);
    showToast(`${state.searchResults.length} matches found`, "success", 1600);
  } else {
    renderSearchResults();
    updateSearchInfo();
    applySearchHighlightsToCurrentPage();
    showToast("No matches found", "warning", 1600);
  }
}

async function jumpToSearchResult(index: number): Promise<void> {
  if (state.searchResults.length === 0) {
    return;
  }
  const normalized =
    ((index % state.searchResults.length) + state.searchResults.length) %
    state.searchResults.length;
  state.searchCursor = normalized;
  const target = state.searchResults[normalized];

  if (state.page !== target.page) {
    await renderPage(target.page, true);
  } else {
    applySearchHighlightsToCurrentPage();
  }
  renderSearchResults();
  updateSearchInfo();
}

function getSelectionRectsAndQuote(clearSelection = true): PendingSelection | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }
  const range = selection.getRangeAt(0);
  if (!els.textLayer.contains(range.commonAncestorContainer)) {
    return null;
  }

  const quote = selection.toString().trim();
  if (!quote) {
    return null;
  }

  const layerRect = els.textLayer.getBoundingClientRect();
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
    anchorX: rangeRect.left - layerRect.left + els.pdfStage.scrollLeft,
    anchorY: rangeRect.top - layerRect.top + els.pdfStage.scrollTop,
  };
}

async function createAnnotation(
  type: AnnotationType,
  selectedInput?: PendingSelection,
  commentOverride?: string,
): Promise<void> {
  const selected = selectedInput ?? getSelectionRectsAndQuote();
  if (!selected) {
    setStatus("Select text directly on the PDF text layer first.");
    showToast("Select text on PDF before annotating.", "warning");
    return;
  }
  const annotationId = uid("ann");
  const now = nowIso();
  const annotation: Annotation = {
    id: annotationId,
    page: state.page,
    type,
    quote: selected.quote,
    comment: commentOverride ?? els.annotationCommentInput.value.trim(),
    tags: parseTags(els.annotationTagsInput.value),
    rects: selected.rects,
    createdAt: now,
    updatedAt: now,
  };

  upsertAnnotation(annotation);
  renderAnnotationList();
  renderAnnotationLayer();
  await recordAction("annotation_upsert", { annotation }, state.page, annotation.quote);
  if (annotation.comment) {
    await recordAction(
      "comment",
      { annotation_id: annotation.id, text: annotation.comment, tags: annotation.tags },
      state.page,
      annotation.quote,
    );
  }
  await refreshEvents();
  hideQuickAnnotator();
  window.getSelection()?.removeAllRanges();
  setStatus(`Annotation ${type} saved.`);
  showToast(`${type === "highlight" ? "Highlight" : "Underline"} saved`, "success");
}

async function updateSelectedAnnotationMeta(): Promise<void> {
  const existing = selectedAnnotation();
  if (!existing) {
    return;
  }
  const updated: Annotation = {
    ...existing,
    comment: els.annotationCommentInput.value.trim(),
    tags: parseTags(els.annotationTagsInput.value),
    updatedAt: nowIso(),
  };
  upsertAnnotation(updated);
  renderAnnotationList();
  renderAnnotationLayer();
  await recordAction("annotation_upsert", { annotation: updated }, existing.page, existing.quote);
  if (updated.comment) {
    await recordAction(
      "comment",
      { annotation_id: updated.id, text: updated.comment, tags: updated.tags },
      updated.page,
      updated.quote,
    );
  }
  await refreshEvents();
  showToast("Annotation metadata updated", "success", 1400);
}

async function jumpToAnnotation(annotationId: string): Promise<void> {
  const annotation = state.annotations.find((item) => item.id === annotationId);
  if (!annotation) {
    return;
  }
  if (state.page !== annotation.page) {
    await renderPage(annotation.page, true);
  }
  setSelectedAnnotation(annotation.id);
}

async function deleteSelectedAnnotation(): Promise<void> {
  const annotation = selectedAnnotation();
  if (!annotation) {
    return;
  }
  deleteAnnotation(annotation.id);
  await recordAction(
    "annotation_delete",
    { annotation_id: annotation.id },
    annotation.page,
    annotation.quote,
  );
  await refreshEvents();
  setStatus("Annotation deleted.");
  showToast("Annotation deleted", "success");
}

async function saveNote(): Promise<void> {
  const now = nowIso();
  const existing = selectedNote();
  const note: Note = {
    id: existing?.id ?? uid("note"),
    title: els.noteTitleInput.value.trim(),
    markdown: els.noteMarkdownInput.value,
    linkedAnnotationIds: parseLinkedIds(els.noteLinkedIdsInput.value),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  upsertNote(note);
  renderNotesList();
  await recordAction("note_upsert", { note }, state.page);
  await refreshEvents();
  setStatus("Note saved.");
  showToast("Note saved", "success");
}

async function deleteSelectedNote(): Promise<void> {
  const note = selectedNote();
  if (!note) {
    return;
  }
  deleteNote(note.id);
  await recordAction("note_delete", { note_id: note.id }, state.page);
  await refreshEvents();
  setStatus("Note deleted.");
  showToast("Note deleted", "success");
}

function newNoteDraft(): void {
  setSelectedNote(null);
}

function exportJson(): void {
  const payload = {
    exported_at: nowIso(),
    paper_ref: state.paperRef,
    pdf_uri: state.pdfUri,
    session: state.session,
    annotations: state.annotations,
    notes: state.notes,
    search_query: state.searchQuery,
    progress: getProgress(state.paperRef),
  };
  downloadFile(
    `${state.paperRef || "paper"}-reading-data.json`,
    JSON.stringify(payload, null, 2),
    "application/json",
  );
  showToast("JSON export ready", "success");
}

function exportMarkdown(): void {
  const lines: string[] = [];
  lines.push(`# Reading Notes: ${state.paperRef || "Unknown Paper"}`);
  lines.push("");
  lines.push(`- PDF URI: ${state.pdfUri || "-"}`);
  lines.push(`- Session: ${state.session?.id ?? "-"}`);
  lines.push(`- Exported At: ${nowIso()}`);
  lines.push("");
  lines.push("## Annotations");
  lines.push("");

  if (state.annotations.length === 0) {
    lines.push("_No annotations_");
  } else {
    const sorted = state.annotations.slice().sort((a, b) => a.page - b.page);
    for (const annotation of sorted) {
      lines.push(`### ${annotation.id} (p.${annotation.page}, ${annotation.type})`);
      if (annotation.tags.length > 0) {
        lines.push(`Tags: ${annotation.tags.join(", ")}`);
      }
      lines.push(`> ${annotation.quote}`);
      lines.push(annotation.comment ? `Comment: ${annotation.comment}` : "Comment: -");
      lines.push("");
    }
  }

  lines.push("## Notes");
  lines.push("");
  if (state.notes.length === 0) {
    lines.push("_No notes_");
  } else {
    for (const note of state.notes) {
      lines.push(`### ${note.title || note.id}`);
      if (note.linkedAnnotationIds.length > 0) {
        lines.push(`Linked annotations: ${note.linkedAnnotationIds.join(", ")}`);
      }
      lines.push("");
      lines.push(note.markdown || "_(empty)_");
      lines.push("");
    }
  }

  downloadFile(`${state.paperRef || "paper"}-reading-notes.md`, lines.join("\n"), "text/markdown");
  showToast("Markdown export ready", "success");
}

async function resolveOutlinePage(dest: unknown): Promise<number | null> {
  if (!state.pdfDoc || !dest) {
    return null;
  }
  let destination: unknown = dest;
  if (typeof dest === "string") {
    destination = await state.pdfDoc.getDestination(dest);
  }
  if (!Array.isArray(destination) || destination.length === 0) {
    return null;
  }
  try {
    const pageIndex = await state.pdfDoc.getPageIndex(destination[0]);
    return pageIndex + 1;
  } catch {
    return null;
  }
}

async function buildOutline(): Promise<void> {
  state.outline = [];
  els.outlineList.innerHTML = "";
  if (!state.pdfDoc) {
    return;
  }
  const outline = await state.pdfDoc.getOutline();
  if (!outline || outline.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No outline";
    li.classList.add("muted");
    els.outlineList.appendChild(li);
    return;
  }

  async function walk(nodes: PdfOutlineNode[], level: number): Promise<void> {
    for (const node of nodes) {
      const page = await resolveOutlinePage(node.dest);
      if (page !== null) {
        state.outline.push({
          title: node.title || "Untitled",
          page,
          level,
        });
      }
      if (node.items && node.items.length > 0) {
        await walk(node.items, level + 1);
      }
    }
  }
  await walk(outline, 0);
  renderOutline();
}

function renderOutline(): void {
  els.outlineList.innerHTML = "";
  if (state.outline.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No outline";
    li.classList.add("muted");
    els.outlineList.appendChild(li);
    return;
  }
  for (const item of state.outline) {
    const li = document.createElement("li");
    li.style.marginLeft = `${item.level * 12}px`;
    const btn = document.createElement("button");
    btn.textContent = `p.${item.page} ${item.title}`;
    btn.addEventListener("click", async () => {
      await renderPage(item.page, true);
    });
    li.appendChild(btn);
    els.outlineList.appendChild(li);
  }
}

async function loadPdf(pdfUri: string, preferredPage: number): Promise<void> {
  const source = `/api/pdf?uri=${encodeURIComponent(pdfUri)}`;
  await withStageLoading("Loading PDF...", async () => {
    const loadingTask = pdfjsLib.getDocument(source);
    state.pdfDoc = (await loadingTask.promise) as unknown as PdfDocumentLike;
    state.pageTextCache.clear();
    await buildOutline();

    const normalizedPage = clamp(preferredPage, 1, state.pdfDoc!.numPages);
    await renderPage(normalizedPage, true);
    updateZoomInfo();
  });
}

async function openPaper(): Promise<void> {
  const paperRef = els.paperRef.value.trim();
  const pdfUri = els.pdfUri.value.trim();
  if (!paperRef || !pdfUri) {
    setStatus("paper_ref and pdf_uri are required");
    return;
  }
  setStatus("opening session...");

  const session = await apiPost<PaperSession>("/api/open-paper", {
    paper_ref: paperRef,
    pdf_uri: pdfUri,
    agent_id: DEFAULT_AGENT_ID,
    user_id: DEFAULT_USER_ID,
  });

  state.session = session;
  state.paperRef = paperRef;
  state.pdfUri = pdfUri;
  state.searchQuery = "";
  state.searchResults = [];
  state.searchCursor = 0;
  state.selectedAnnotationId = null;
  state.selectedNoteId = null;
  state.annotations = [];
  state.notes = [];
  els.searchInput.value = "";

  const progress = getProgress(paperRef);
  state.zoom = progress?.zoom ?? 1.35;
  updateZoomInfo();
  els.sessionInfo.textContent = `Session: ${session.id}`;

  const preferredPage = progress?.lastPage ?? 1;
  await loadPdf(pdfUri, preferredPage);
  await refreshEvents(true);
  renderRecentList();
  renderSearchResults();
  updateSearchInfo();
  setStatus("session ready");
  showToast("Session opened", "success");
}

async function closeSession(): Promise<void> {
  if (!state.session) {
    return;
  }
  await apiPost("/api/close-paper", { session_id: state.session.id });
  setStatus("session closed");
  showToast("Session closed", "success");
}

async function goPrevPage(): Promise<void> {
  if (!state.pdfDoc || state.page <= 1) {
    return;
  }
  await renderPage(state.page - 1, true);
}

async function goNextPage(): Promise<void> {
  if (!state.pdfDoc || state.page >= state.pdfDoc.numPages) {
    return;
  }
  await renderPage(state.page + 1, true);
}

async function jumpToPageInput(): Promise<void> {
  if (!state.pdfDoc) {
    return;
  }
  const page = Number(els.pageJumpInput.value);
  if (!Number.isFinite(page)) {
    return;
  }
  await renderPage(clamp(Math.round(page), 1, state.pdfDoc.numPages), true);
}

async function applyZoom(nextZoom: number): Promise<void> {
  if (!state.pdfDoc) {
    return;
  }
  const zoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
  if (Math.abs(zoom - state.zoom) < 0.001) {
    return;
  }
  state.zoom = zoom;
  updateZoomInfo();
  await recordAction("zoom_change", { zoom: state.zoom }, state.page);
  await renderPage(state.page, false);
}

async function fitWidth(): Promise<void> {
  if (!state.pdfDoc) {
    return;
  }
  const page = await state.pdfDoc.getPage(state.page);
  const baseViewport = page.getViewport({ scale: 1 });
  const target = (els.pdfStage.clientWidth - 24) / baseViewport.width;
  await applyZoom(target);
}

function bindUiEvents(): void {
  els.openPaperBtn.addEventListener("click", async () => {
    try {
      await openPaper();
    } catch (error) {
      reportError(error, "Failed to open paper");
    }
  });

  els.closePaperBtn.addEventListener("click", async () => {
    try {
      await closeSession();
      await refreshEvents();
    } catch (error) {
      reportError(error, "Failed to close session");
    }
  });

  els.refreshBtn.addEventListener("click", async (event) => {
    // Keep refresh action from toggling the parent <details> summary.
    event.preventDefault();
    event.stopPropagation();
    try {
      await refreshEvents();
    } catch (error) {
      reportError(error, "Failed to refresh timeline");
    }
  });

  els.refreshRecentBtn.addEventListener("click", () => {
    renderRecentList();
  });

  els.prevBtn.addEventListener("click", async () => {
    try {
      await goPrevPage();
    } catch (error) {
      reportError(error, "Failed to go to previous page");
    }
  });

  els.nextBtn.addEventListener("click", async () => {
    try {
      await goNextPage();
    } catch (error) {
      reportError(error, "Failed to go to next page");
    }
  });

  els.pageJumpBtn.addEventListener("click", async () => {
    try {
      await jumpToPageInput();
    } catch (error) {
      reportError(error, "Failed to jump page");
    }
  });

  els.zoomInBtn.addEventListener("click", async () => {
    await applyZoom(state.zoom + ZOOM_STEP);
  });

  els.zoomOutBtn.addEventListener("click", async () => {
    await applyZoom(state.zoom - ZOOM_STEP);
  });

  els.fitWidthBtn.addEventListener("click", async () => {
    try {
      await fitWidth();
    } catch (error) {
      reportError(error, "Failed to fit width");
    }
  });

  els.searchBtn.addEventListener("click", async () => {
    await runSearch(els.searchInput.value);
  });

  els.searchInput.addEventListener("keydown", async (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const query = els.searchInput.value.trim();
      if (!query) {
        await runSearch("");
        return;
      }
      if (state.searchQuery === query && state.searchResults.length > 0) {
        if (event.shiftKey) {
          await jumpToSearchResult(state.searchCursor - 1);
        } else {
          await jumpToSearchResult(state.searchCursor + 1);
        }
        return;
      }
      await runSearch(query);
    }
  });

  els.searchPrevBtn.addEventListener("click", async () => {
    await jumpToSearchResult(state.searchCursor - 1);
  });

  els.searchNextBtn.addEventListener("click", async () => {
    await jumpToSearchResult(state.searchCursor + 1);
  });

  els.highlightBtn.addEventListener("click", async () => {
    try {
      await createAnnotation("highlight");
    } catch (error) {
      reportError(error, "Failed to create highlight");
    }
  });

  els.underlineBtn.addEventListener("click", async () => {
    try {
      await createAnnotation("underline");
    } catch (error) {
      reportError(error, "Failed to create underline");
    }
  });

  els.annotationCommentInput.addEventListener("change", async () => {
    await updateSelectedAnnotationMeta();
  });

  els.annotationTagsInput.addEventListener("change", async () => {
    await updateSelectedAnnotationMeta();
  });

  els.deleteAnnotationBtn.addEventListener("click", async () => {
    try {
      await deleteSelectedAnnotation();
    } catch (error) {
      reportError(error, "Failed to delete annotation");
    }
  });

  els.saveNoteBtn.addEventListener("click", async () => {
    try {
      await saveNote();
    } catch (error) {
      reportError(error, "Failed to save note");
    }
  });

  els.newNoteBtn.addEventListener("click", () => {
    newNoteDraft();
  });

  els.deleteNoteBtn.addEventListener("click", async () => {
    try {
      await deleteSelectedNote();
    } catch (error) {
      reportError(error, "Failed to delete note");
    }
  });

  els.exportJsonBtn.addEventListener("click", () => {
    exportJson();
  });

  els.exportMarkdownBtn.addEventListener("click", () => {
    exportMarkdown();
  });

  els.textLayer.addEventListener("copy", async () => {
    const selected = window.getSelection()?.toString().trim() ?? "";
    if (!selected) {
      return;
    }
    await recordAction("copy", { chars: selected.length }, state.page, selected);
    await refreshEvents();
  });

  els.textLayer.addEventListener("mouseup", () => {
    const selected = getSelectionRectsAndQuote(false);
    if (!selected) {
      hideQuickAnnotator();
      return;
    }
    showQuickAnnotator(selected);
  });

  els.quickHighlightBtn.addEventListener("click", async () => {
    if (!state.pendingSelection) {
      return;
    }
    try {
      await createAnnotation(
        "highlight",
        state.pendingSelection,
        els.quickCommentInput.value.trim(),
      );
    } catch (error) {
      reportError(error, "Failed to create quick highlight");
    }
  });

  els.quickUnderlineBtn.addEventListener("click", async () => {
    if (!state.pendingSelection) {
      return;
    }
    try {
      await createAnnotation(
        "underline",
        state.pendingSelection,
        els.quickCommentInput.value.trim(),
      );
    } catch (error) {
      reportError(error, "Failed to create quick underline");
    }
  });

  els.quickDismissBtn.addEventListener("click", () => {
    hideQuickAnnotator();
  });

  document.addEventListener("mousedown", (event) => {
    const target = event.target as Node | null;
    if (!target) {
      return;
    }
    if (els.quickAnnotator.contains(target) || els.textLayer.contains(target)) {
      return;
    }
    hideQuickAnnotator();
  });

  document.addEventListener("keydown", async (event) => {
    const target = event.target as HTMLElement | null;
    const editable =
      target &&
      (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
    if (editable) {
      return;
    }
    if (event.key === "j") {
      event.preventDefault();
      await goNextPage();
      return;
    }
    if (event.key === "k") {
      event.preventDefault();
      await goPrevPage();
      return;
    }
    if (event.key === "f") {
      event.preventDefault();
      els.searchInput.focus();
      els.searchInput.select();
      return;
    }
    if (event.key === "Escape") {
      hideQuickAnnotator();
    }
  });
}

function initialize(): void {
  bindUiEvents();
  renderRecentList();
  renderAnnotationList();
  renderNotesList();
  renderSearchResults();
  updateSearchInfo();
  updateZoomInfo();
}

initialize();
