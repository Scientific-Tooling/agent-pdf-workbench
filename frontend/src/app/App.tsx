import { useEffect, useMemo, useRef, useState } from "react";

import * as pdfjsLib from "pdfjs-dist/build/pdf.mjs";
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import { ControlPanel } from "../components/ControlPanel";
import { ReaderPanel } from "../components/ReaderPanel";
import { ToastStack } from "../components/ToastStack";
import { WorkspacePanel } from "../components/WorkspacePanel";
import { useGlobalWorkspaceShortcuts } from "../hooks/useGlobalWorkspaceShortcuts";
import { useSyncedRef } from "../hooks/useSyncedRef";
import { useToastStack } from "../hooks/useToastStack";
import { apiGet, apiPost } from "../services/api";
import {
  getSelectionRectsAndQuote as getSelectionRectsAndQuoteFromDom,
  renderAnnotationLayer as renderAnnotationLayerFromDom,
} from "../pdf/annotation-helpers";
import {
  ANCHOR_CONTEXT_CHARS,
  DEFAULT_AGENT_ID,
  DEFAULT_USER_ID,
  MAX_ZOOM,
  MIN_ZOOM,
} from "./app-types";
import type { PendingSelection, PdfDocumentLike, PdfOutlineNode } from "./app-types";
import { exportJson as exportJsonFile, exportMarkdown as exportMarkdownFile } from "../services/exporters";
import { asAnnotation, asAnnotationRecord, asNote, asNoteRecord } from "../pdf/main-parsers";
import { clamp, errorMessage, nowIso, parseLinkedIds, parseTags, uid } from "../utils/main-utils";
import {
  applySearchHighlightsToCurrentPage as applySearchHighlightsToCurrentPageInDom,
} from "../ui/list-renderers";
import { readTextFromPdfItems, renderTextLayer, updateCanvasAndLayersSize } from "../pdf/pdf-layer";
import { getProgress, getRecentPapers, upsertProgress, upsertRecentPaper } from "../services/storage";
import type {
  ActionEvent,
  Annotation,
  AnnotationRecord,
  AnnotationType,
  ListAnnotationsResponse,
  ListActionsResponse,
  ListNotesResponse,
  Note,
  NoteRecord,
  OutlineItem,
  PaperSession,
  RecentPaper,
  SearchResult,
} from "../types/types";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

export function App() {
  const [session, setSession] = useState<PaperSession | null>(null);
  const [pdfDoc, setPdfDoc] = useState<PdfDocumentLike | null>(null);
  const [paperRef, setPaperRef] = useState("p_demo_001");
  const [pdfUri, setPdfUri] = useState("/tmp/paper.pdf");
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1.35);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [events, setEvents] = useState<ActionEvent[]>([]);
  const [searchInputValue, setSearchInputValue] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchCursor, setSearchCursor] = useState(0);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [recentPapers, setRecentPapers] = useState<RecentPaper[]>(() => getRecentPapers());
  const [status, setStatus] = useState("idle");
  const [loadingCount, setLoadingCount] = useState(0);
  const [stageLoadingLabel, setStageLoadingLabel] = useState("Loading PDF...");
  const [annotationCommentInput, setAnnotationCommentInput] = useState("");
  const [annotationTagsInput, setAnnotationTagsInput] = useState("");
  const [noteTitleInput, setNoteTitleInput] = useState("");
  const [noteLinkedIdsInput, setNoteLinkedIdsInput] = useState("");
  const [noteMarkdownInput, setNoteMarkdownInput] = useState("");
  const [pageJumpInput, setPageJumpInput] = useState("");
  const [quickVisible, setQuickVisible] = useState(false);
  const [quickLeft, setQuickLeft] = useState(8);
  const [quickTop, setQuickTop] = useState(8);
  const [quickCommentInput, setQuickCommentInput] = useState("");
  const [pendingSelection, setPendingSelection] = useState<PendingSelection | null>(null);

  const { toasts, showToast } = useToastStack();

  const pageTextCacheRef = useRef<Map<number, string>>(new Map());
  const sessionRef = useSyncedRef<PaperSession | null>(session);
  const pdfDocRef = useSyncedRef<PdfDocumentLike | null>(pdfDoc);
  const pageRef = useSyncedRef<number>(page);
  const zoomRef = useSyncedRef<number>(zoom);

  const pdfStageRef = useRef<HTMLDivElement | null>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const annotationLayerRef = useRef<HTMLDivElement | null>(null);
  const quickAnnotatorRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const selectedAnnotation = useMemo(
    () => annotations.find((annotation) => annotation.id === selectedAnnotationId) ?? null,
    [annotations, selectedAnnotationId],
  );

  const selectedNote = useMemo(
    () => notes.find((note) => note.id === selectedNoteId) ?? null,
    [notes, selectedNoteId],
  );

  const sortedAnnotations = useMemo(
    () => annotations.slice().sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
    [annotations],
  );
  const sortedNotes = useMemo(
    () => notes.slice().sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
    [notes],
  );

  useEffect(() => {
    if (!selectedAnnotation) {
      setAnnotationCommentInput("");
      setAnnotationTagsInput("");
      return;
    }
    setAnnotationCommentInput(selectedAnnotation.comment);
    setAnnotationTagsInput(selectedAnnotation.tags.join(", "));
  }, [selectedAnnotation]);

  useEffect(() => {
    if (!selectedNote) {
      setNoteTitleInput("");
      setNoteLinkedIdsInput("");
      setNoteMarkdownInput("");
      return;
    }
    setNoteTitleInput(selectedNote.title);
    setNoteLinkedIdsInput(selectedNote.linkedAnnotationIds.join(", "));
    setNoteMarkdownInput(selectedNote.markdown);
  }, [selectedNote]);

  const searchInfoText = useMemo(() => {
    if (!searchQuery) {
      return "";
    }
    if (searchResults.length === 0) {
      return "0 matches";
    }
    return `${searchCursor + 1}/${searchResults.length} matches`;
  }, [searchCursor, searchQuery, searchResults.length]);

  function reportError(error: unknown, fallback = "Operation failed"): void {
    const message = errorMessage(error) || fallback;
    setStatus(message);
    showToast(message, "error", 3200);
  }

  async function withStageLoading<T>(label: string, task: () => Promise<T>): Promise<T> {
    setLoadingCount((count) => count + 1);
    setStageLoadingLabel(label);
    try {
      return await task();
    } finally {
      setLoadingCount((count) => Math.max(0, count - 1));
    }
  }

  function hideQuickAnnotator(clearPending = true): void {
    setQuickVisible(false);
    if (clearPending) {
      setPendingSelection(null);
    }
  }

  function showQuickAnnotator(selection: PendingSelection): void {
    const stage = pdfStageRef.current;
    if (!stage) {
      setPendingSelection(selection);
      setQuickVisible(true);
      return;
    }
    const left = clamp(selection.anchorX + 8, 8, Math.max(8, stage.clientWidth - 320));
    const top = clamp(selection.anchorY - 56, 8, Math.max(8, stage.clientHeight - 120));
    setPendingSelection(selection);
    setQuickLeft(left);
    setQuickTop(top);
    setQuickCommentInput("");
    setQuickVisible(true);
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

  function resetWorkspaceState(): void {
    setSession(null);
    setPdfDoc(null);
    pdfDocRef.current = null;
    setPaperRef("");
    setPdfUri("");
    setPage(1);
    pageRef.current = 1;
    setPageJumpInput("");
    setZoom(1.35);
    zoomRef.current = 1.35;
    setAnnotations([]);
    setSelectedAnnotationId(null);
    setNotes([]);
    setSelectedNoteId(null);
    setEvents([]);
    setSearchInputValue("");
    setSearchQuery("");
    setSearchResults([]);
    setSearchCursor(0);
    setOutline([]);
    setAnnotationCommentInput("");
    setAnnotationTagsInput("");
    setNoteTitleInput("");
    setNoteLinkedIdsInput("");
    setNoteMarkdownInput("");
    setLoadingCount(0);
    setStageLoadingLabel("Loading PDF...");
    hideQuickAnnotator();
    pageTextCacheRef.current.clear();
    clearViewerDom();
  }

  function persistReadingProgress(nextPage: number, nextZoom: number, sid: string): void {
    const progress = {
      paperRef,
      pdfUri,
      sessionId: sid,
      lastPage: nextPage,
      zoom: nextZoom,
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
    setRecentPapers(getRecentPapers());
  }

  async function refreshEvents(sessionIdOverride?: string): Promise<void> {
    const sid = sessionIdOverride ?? sessionRef.current?.id;
    if (!sid) {
      return;
    }
    const data = await apiGet<ListActionsResponse>(
      `/api/list-actions?session_id=${encodeURIComponent(sid)}&limit=1000`,
    );
    setEvents(data.events);
  }

  async function refreshAnnotations(sessionIdOverride?: string): Promise<void> {
    const sid = sessionIdOverride ?? sessionRef.current?.id;
    if (!sid) {
      return;
    }
    const data = await apiGet<ListAnnotationsResponse>(
      `/api/annotations?session_id=${encodeURIComponent(sid)}&limit=1000`,
    );
    const next: Annotation[] = [];
    for (const raw of data.annotations) {
      const parsed = asAnnotationRecord(raw);
      if (parsed) {
        next.push(parsed.annotation);
      }
    }
    setAnnotations(next);
    setSelectedAnnotationId((prev) => {
      if (!prev) {
        return null;
      }
      return next.some((annotation) => annotation.id === prev) ? prev : null;
    });
  }

  async function refreshNotes(sessionIdOverride?: string): Promise<void> {
    const sid = sessionIdOverride ?? sessionRef.current?.id;
    if (!sid) {
      return;
    }
    const data = await apiGet<ListNotesResponse>(`/api/notes?session_id=${encodeURIComponent(sid)}&limit=1000`);
    const next: Note[] = [];
    for (const raw of data.notes) {
      const parsed = asNoteRecord(raw);
      if (parsed) {
        next.push(parsed.note);
      }
    }
    setNotes(next);
    setSelectedNoteId((prev) => {
      if (!prev) {
        return null;
      }
      return next.some((note) => note.id === prev) ? prev : null;
    });
  }

  async function refreshDomainState(sessionIdOverride?: string): Promise<void> {
    await Promise.all([refreshAnnotations(sessionIdOverride), refreshNotes(sessionIdOverride)]);
  }

  async function recordAction(
    eventType: string,
    payload: Record<string, unknown> = {},
    eventPage: number | null = pageRef.current,
    selectionText: string | null = null,
    sessionIdOverride?: string,
  ): Promise<void> {
    const sid = sessionIdOverride ?? sessionRef.current?.id;
    if (!sid) {
      return;
    }
    try {
      await apiPost("/api/record-action", {
        session_id: sid,
        event_type: eventType,
        page: eventPage,
        selection_text: selectionText,
        payload,
        source: "viewer",
      });
    } catch (error) {
      setStatus(`record_action failed: ${errorMessage(error)}`);
    }
  }

  async function ensurePageText(targetPage: number, doc?: PdfDocumentLike): Promise<string> {
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
    sessionIdOverride?: string,
    docOverride?: PdfDocumentLike,
  ): Promise<void> {
    const activeDoc = docOverride ?? pdfDocRef.current;
    const canvas = pdfCanvasRef.current;
    const textLayer = textLayerRef.current;
    const annotationLayer = annotationLayerRef.current;
    if (!activeDoc || !canvas || !textLayer || !annotationLayer) {
      return;
    }
    await withStageLoading("Rendering page...", async () => {
      const pdfPage = await activeDoc.getPage(pageNumber);
      const viewport = pdfPage.getViewport({ scale: zoomRef.current });
      updateCanvasAndLayersSize(canvas, textLayer, annotationLayer, viewport);

      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("Cannot initialize 2d canvas context");
      }
      await pdfPage.render({ canvasContext: context, viewport }).promise;

      const textContent = await pdfPage.getTextContent();
      renderTextLayer(textLayer, viewport, textContent.items);
      const pageText = readTextFromPdfItems(textContent.items);
      pageTextCacheRef.current.set(pageNumber, pageText);

      setPage(pageNumber);
      pageRef.current = pageNumber;
      setPageJumpInput(String(pageNumber));

      const sid = sessionIdOverride ?? sessionRef.current?.id;
      if (sid) {
        persistReadingProgress(pageNumber, zoomRef.current, sid);
      }
      if (emitPageChange) {
        await recordAction("page_change", { total_pages: activeDoc.numPages }, pageNumber, null, sid);
      }
    });
  }

  async function jumpToSearchResult(index: number, sourceResults?: SearchResult[]): Promise<void> {
    const activeResults = sourceResults ?? searchResults;
    if (activeResults.length === 0) {
      return;
    }
    const normalized = ((index % activeResults.length) + activeResults.length) % activeResults.length;
    setSearchCursor(normalized);
    const target = activeResults[normalized];
    if (pageRef.current !== target.page) {
      await renderPage(target.page, true);
    }
  }

  async function runSearch(queryRaw: string): Promise<void> {
    const query = queryRaw.trim();
    setSearchQuery(query);
    setSearchResults([]);
    setSearchCursor(0);

    const activeDoc = pdfDocRef.current;
    if (!query || !activeDoc) {
      return;
    }

    const results: SearchResult[] = [];
    await withStageLoading("Searching document...", async () => {
      for (let pageNumber = 1; pageNumber <= activeDoc.numPages; pageNumber += 1) {
        const text = await ensurePageText(pageNumber, activeDoc);
        const lower = text.toLowerCase();
        const lowerQuery = query.toLowerCase();
        let startIndex = 0;
        while (true) {
          const hit = lower.indexOf(lowerQuery, startIndex);
          if (hit === -1) {
            break;
          }
          const snippetStart = Math.max(0, hit - 40);
          const snippetEnd = Math.min(text.length, hit + query.length + 40);
          results.push({
            page: pageNumber,
            snippet: text.slice(snippetStart, snippetEnd).replace(/\s+/g, " "),
            matchIndex: hit,
          });
          startIndex = hit + query.length;
          if (results.length >= 300) {
            break;
          }
        }
        if (results.length >= 300) {
          break;
        }
      }
    });

    setSearchResults(results);
    if (results.length > 0) {
      setSearchCursor(0);
      await jumpToSearchResult(0, results);
      showToast(`${results.length} matches found`, "success", 1600);
    } else {
      showToast("No matches found", "warning", 1600);
    }
  }

  function getSelectionRectsAndQuote(clearSelection = true): PendingSelection | null {
    const textLayer = textLayerRef.current;
    const pdfStage = pdfStageRef.current;
    if (!textLayer || !pdfStage) {
      return null;
    }
    return getSelectionRectsAndQuoteFromDom(
      textLayer,
      pdfStage,
      pageRef.current,
      pageTextCacheRef.current,
      ANCHOR_CONTEXT_CHARS,
      clearSelection,
    );
  }

  function upsertAnnotation(annotation: Annotation): void {
    setAnnotations((prev) => {
      const next = prev.filter((item) => item.id !== annotation.id);
      next.push(annotation);
      return next;
    });
    setSelectedAnnotationId(annotation.id);
  }

  function deleteAnnotation(annotationId: string): void {
    setAnnotations((prev) => prev.filter((annotation) => annotation.id !== annotationId));
    setSelectedAnnotationId((prev) => (prev === annotationId ? null : prev));
  }

  function upsertNote(note: Note): void {
    setNotes((prev) => {
      const next = prev.filter((item) => item.id !== note.id);
      next.push(note);
      return next;
    });
    setSelectedNoteId(note.id);
  }

  function deleteNote(noteId: string): void {
    setNotes((prev) => prev.filter((note) => note.id !== noteId));
    setSelectedNoteId((prev) => (prev === noteId ? null : prev));
  }

  async function createAnnotation(
    type: AnnotationType,
    selectedInput?: PendingSelection,
    commentOverride?: string,
  ): Promise<void> {
    const activeSession = sessionRef.current;
    if (!activeSession) {
      setStatus("Open a paper session first.");
      return;
    }
    const selected = selectedInput ?? getSelectionRectsAndQuote();
    if (!selected) {
      setStatus("Select text directly on the PDF text layer first.");
      showToast("Select text on PDF before annotating.", "warning");
      return;
    }

    const now = nowIso();
    const annotation: Annotation = {
      id: uid("ann"),
      page: pageRef.current,
      type,
      quote: selected.quote,
      anchor: selected.anchor,
      comment: commentOverride ?? annotationCommentInput.trim(),
      tags: parseTags(annotationTagsInput),
      rects: selected.rects,
      createdAt: now,
      updatedAt: now,
    };

    const savedRecord = await apiPost<AnnotationRecord>("/api/annotations", {
      session_id: activeSession.id,
      annotation,
    });
    const saved = asAnnotation(savedRecord.annotation) ?? annotation;
    upsertAnnotation(saved);
    await recordAction("annotation_upsert", { annotation: saved }, pageRef.current, saved.quote, activeSession.id);
    if (saved.comment) {
      await recordAction(
        "comment",
        { annotation_id: saved.id, text: saved.comment, tags: saved.tags },
        pageRef.current,
        saved.quote,
        activeSession.id,
      );
    }
    await Promise.all([refreshEvents(activeSession.id), refreshAnnotations(activeSession.id)]);
    hideQuickAnnotator();
    window.getSelection()?.removeAllRanges();
    setStatus(`Annotation ${type} saved.`);
    showToast(type === "highlight" ? "Highlight saved" : "Underline saved", "success");
  }

  async function updateSelectedAnnotationMeta(): Promise<void> {
    if (!selectedAnnotation || !sessionRef.current) {
      return;
    }
    const updated: Annotation = {
      ...selectedAnnotation,
      comment: annotationCommentInput.trim(),
      tags: parseTags(annotationTagsInput),
      updatedAt: nowIso(),
    };
    const savedRecord = await apiPost<AnnotationRecord>("/api/annotations", {
      session_id: sessionRef.current.id,
      annotation: updated,
    });
    const saved = asAnnotation(savedRecord.annotation) ?? updated;
    upsertAnnotation(saved);
    await recordAction(
      "annotation_upsert",
      { annotation: saved },
      saved.page,
      saved.quote,
      sessionRef.current.id,
    );
    if (saved.comment) {
      await recordAction(
        "comment",
        { annotation_id: saved.id, text: saved.comment, tags: saved.tags },
        saved.page,
        saved.quote,
        sessionRef.current.id,
      );
    }
    await Promise.all([refreshEvents(sessionRef.current.id), refreshAnnotations(sessionRef.current.id)]);
    showToast("Annotation metadata updated", "success", 1400);
  }

  async function jumpToAnnotation(annotationId: string): Promise<void> {
    const annotation = annotations.find((item) => item.id === annotationId);
    if (!annotation) {
      return;
    }
    if (pageRef.current !== annotation.page) {
      await renderPage(annotation.page, true);
    }
    setSelectedAnnotationId(annotation.id);
  }

  async function deleteSelectedAnnotation(): Promise<void> {
    if (!selectedAnnotation || !sessionRef.current) {
      return;
    }
    await apiPost<{ deleted: boolean }>("/api/annotations/delete", {
      session_id: sessionRef.current.id,
      annotation_id: selectedAnnotation.id,
    });
    deleteAnnotation(selectedAnnotation.id);
    await recordAction(
      "annotation_delete",
      { annotation_id: selectedAnnotation.id },
      selectedAnnotation.page,
      selectedAnnotation.quote,
      sessionRef.current.id,
    );
    await Promise.all([refreshEvents(sessionRef.current.id), refreshAnnotations(sessionRef.current.id)]);
    setStatus("Annotation deleted.");
    showToast("Annotation deleted", "success");
  }

  async function saveNote(): Promise<void> {
    if (!sessionRef.current) {
      setStatus("Open a paper session first.");
      return;
    }
    const now = nowIso();
    const note: Note = {
      id: selectedNote?.id ?? uid("note"),
      title: noteTitleInput.trim(),
      markdown: noteMarkdownInput,
      linkedAnnotationIds: parseLinkedIds(noteLinkedIdsInput),
      createdAt: selectedNote?.createdAt ?? now,
      updatedAt: now,
    };
    const savedRecord = await apiPost<NoteRecord>("/api/notes", {
      session_id: sessionRef.current.id,
      note,
    });
    const saved = asNote(savedRecord.note) ?? note;
    upsertNote(saved);
    await recordAction("note_upsert", { note: saved }, pageRef.current, null, sessionRef.current.id);
    await Promise.all([refreshEvents(sessionRef.current.id), refreshNotes(sessionRef.current.id)]);
    setStatus("Note saved.");
    showToast("Note saved", "success");
  }

  async function deleteSelectedNote(): Promise<void> {
    if (!selectedNote || !sessionRef.current) {
      return;
    }
    await apiPost<{ deleted: boolean }>("/api/notes/delete", {
      session_id: sessionRef.current.id,
      note_id: selectedNote.id,
    });
    deleteNote(selectedNote.id);
    await recordAction("note_delete", { note_id: selectedNote.id }, pageRef.current, null, sessionRef.current.id);
    await Promise.all([refreshEvents(sessionRef.current.id), refreshNotes(sessionRef.current.id)]);
    setStatus("Note deleted.");
    showToast("Note deleted", "success");
  }

  function newNoteDraft(): void {
    setSelectedNoteId(null);
  }

  function exportJson(): void {
    exportJsonFile({
      paperRef,
      pdfUri,
      session,
      annotations,
      notes,
      searchQuery,
    });
    showToast("JSON export ready", "success");
  }

  function exportMarkdown(): void {
    exportMarkdownFile({
      paperRef,
      pdfUri,
      session,
      annotations,
      notes,
      searchQuery,
    });
    showToast("Markdown export ready", "success");
  }

  async function resolveOutlinePage(doc: PdfDocumentLike, dest: unknown): Promise<number | null> {
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

  async function buildOutline(doc: PdfDocumentLike): Promise<void> {
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
          next.push({
            title: node.title || "Untitled",
            page: outlinePage,
            level,
          });
        }
        if (node.items && node.items.length > 0) {
          await walk(node.items, level + 1);
        }
      }
    }
    await walk(docOutline, 0);
    setOutline(next);
  }

  async function loadPdf(
    nextPdfUri: string,
    preferredPage: number,
    sessionIdForInitialActions: string,
  ): Promise<void> {
    const source = `/api/pdf?uri=${encodeURIComponent(nextPdfUri)}`;
    await withStageLoading("Loading PDF...", async () => {
      const loadingTask = pdfjsLib.getDocument(source);
      const doc = (await loadingTask.promise) as unknown as PdfDocumentLike;
      setPdfDoc(doc);
      pdfDocRef.current = doc;
      pageTextCacheRef.current.clear();
      await buildOutline(doc);
      const normalizedPage = clamp(preferredPage, 1, doc.numPages);
      await renderPage(normalizedPage, true, sessionIdForInitialActions, doc);
    });
  }

  async function closeSession(options: { silent?: boolean } = {}): Promise<void> {
    const sid = sessionRef.current?.id;
    if (!sid) {
      return;
    }
    await apiPost("/api/close-paper", { session_id: sid });
    resetWorkspaceState();
    if (!options.silent) {
      setStatus("session closed");
      showToast("Session closed", "success");
    }
  }

  async function openPaper(): Promise<void> {
    const ref = paperRef.trim();
    const uri = pdfUri.trim();
    if (!ref || !uri) {
      setStatus("paper_ref and pdf_uri are required");
      return;
    }
    if (sessionRef.current) {
      await closeSession({ silent: true });
    }

    setStatus("opening session...");
    const openedSession = await apiPost<PaperSession>("/api/open-paper", {
      paper_ref: ref,
      pdf_uri: uri,
      agent_id: DEFAULT_AGENT_ID,
      user_id: DEFAULT_USER_ID,
    });

    setSession(openedSession);
    sessionRef.current = openedSession;
    setPaperRef(ref);
    setPdfUri(uri);
    setSearchInputValue("");
    setSearchQuery("");
    setSearchResults([]);
    setSearchCursor(0);
    setSelectedAnnotationId(null);
    setSelectedNoteId(null);
    setAnnotations([]);
    setNotes([]);
    setEvents([]);

    const progress = getProgress(ref);
    const nextZoom = progress?.zoom ?? 1.35;
    setZoom(nextZoom);
    zoomRef.current = nextZoom;

    try {
      const preferredPage = progress?.lastPage ?? 1;
      await loadPdf(uri, preferredPage, openedSession.id);
      await Promise.all([refreshEvents(openedSession.id), refreshDomainState(openedSession.id)]);
      setRecentPapers(getRecentPapers());
      setStatus("session ready");
      showToast("Session opened", "success");
    } catch (error) {
      try {
        await apiPost("/api/close-paper", { session_id: openedSession.id });
      } catch {
        // Keep original open error as primary signal.
      }
      resetWorkspaceState();
      throw error;
    }
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

  async function applyZoom(nextZoom: number): Promise<void> {
    const doc = pdfDocRef.current;
    if (!doc) {
      return;
    }
    const normalized = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
    if (Math.abs(normalized - zoomRef.current) < 0.001) {
      return;
    }
    setZoom(normalized);
    zoomRef.current = normalized;
    await recordAction("zoom_change", { zoom: normalized }, pageRef.current);
    await renderPage(pageRef.current, false);
  }

  async function fitWidth(): Promise<void> {
    const doc = pdfDocRef.current;
    const stage = pdfStageRef.current;
    if (!doc || !stage) {
      return;
    }
    const activePage = await doc.getPage(pageRef.current);
    const baseViewport = activePage.getViewport({ scale: 1 });
    const target = (stage.clientWidth - 24) / baseViewport.width;
    await applyZoom(target);
  }

  useEffect(() => {
    const textLayer = textLayerRef.current;
    if (!textLayer) {
      return;
    }
    applySearchHighlightsToCurrentPageInDom({
      textLayer,
      query: searchQuery,
      results: searchResults,
      cursor: searchCursor,
      page,
    });
  }, [page, searchCursor, searchQuery, searchResults]);

  useEffect(() => {
    const textLayer = textLayerRef.current;
    const annotationLayer = annotationLayerRef.current;
    if (!textLayer || !annotationLayer) {
      return;
    }
    renderAnnotationLayerFromDom({
      annotationLayer,
      textLayer,
      annotations,
      page,
      selectedAnnotationId,
      pageTextCache: pageTextCacheRef.current,
      onSelectAnnotation: setSelectedAnnotationId,
    });
  }, [annotations, page, selectedAnnotationId]);

  useGlobalWorkspaceShortcuts({
    quickAnnotatorRef,
    textLayerRef,
    searchInputRef,
    onHideQuickAnnotator: hideQuickAnnotator,
    onGoNextPage: goNextPage,
    onGoPrevPage: goPrevPage,
  });

  async function handleTextLayerCopy(): Promise<void> {
    const selectedText = window.getSelection()?.toString().trim() ?? "";
    if (!selectedText) {
      return;
    }
    await recordAction("copy", { chars: selectedText.length }, pageRef.current, selectedText);
    await refreshEvents();
  }

  function handleTextLayerMouseUp(): void {
    const selected = getSelectionRectsAndQuote(false);
    if (!selected) {
      hideQuickAnnotator();
      return;
    }
    showQuickAnnotator(selected);
  }

  async function handleQuickHighlight(): Promise<void> {
    if (!pendingSelection) {
      return;
    }
    await createAnnotation("highlight", pendingSelection, quickCommentInput.trim());
  }

  async function handleQuickUnderline(): Promise<void> {
    if (!pendingSelection) {
      return;
    }
    await createAnnotation("underline", pendingSelection, quickCommentInput.trim());
  }

  async function refreshWorkspace(): Promise<void> {
    await Promise.all([refreshEvents(), refreshDomainState()]);
  }

  return (
    <>
      <main className="layout">
        <ControlPanel
          paperRef={paperRef}
          pdfUri={pdfUri}
          sessionId={session?.id ?? null}
          status={status}
          recentPapers={recentPapers}
          outline={outline}
          onPaperRefChange={setPaperRef}
          onPdfUriChange={setPdfUri}
          onOpenPaper={openPaper}
          onCloseSession={closeSession}
          onRefreshRecent={() => setRecentPapers(getRecentPapers())}
          onLoadRecent={(recent) => {
            setPaperRef(recent.paperRef);
            setPdfUri(recent.pdfUri);
            setStatus(`Loaded recent paper. Resume suggestion: page ${recent.lastPage}`);
          }}
          onJumpToOutlinePage={async (targetPage) => {
            await renderPage(targetPage, true);
          }}
          onError={reportError}
        />

        <ReaderPanel
          pdfDoc={pdfDoc}
          page={page}
          pageJumpInput={pageJumpInput}
          zoom={zoom}
          searchInputValue={searchInputValue}
          searchQuery={searchQuery}
          searchResultsCount={searchResults.length}
          searchCursor={searchCursor}
          searchInfoText={searchInfoText}
          loadingCount={loadingCount}
          stageLoadingLabel={stageLoadingLabel}
          quickVisible={quickVisible}
          quickLeft={quickLeft}
          quickTop={quickTop}
          quickCommentInput={quickCommentInput}
          hasPendingSelection={Boolean(pendingSelection)}
          searchInputRef={searchInputRef}
          pdfStageRef={pdfStageRef}
          pdfCanvasRef={pdfCanvasRef}
          textLayerRef={textLayerRef}
          annotationLayerRef={annotationLayerRef}
          quickAnnotatorRef={quickAnnotatorRef}
          onPageJumpInputChange={setPageJumpInput}
          onSearchInputValueChange={setSearchInputValue}
          onQuickCommentInputChange={setQuickCommentInput}
          onGoPrevPage={goPrevPage}
          onGoNextPage={goNextPage}
          onJumpToPageInput={jumpToPageInput}
          onApplyZoom={applyZoom}
          onFitWidth={fitWidth}
          onRunSearch={runSearch}
          onJumpToSearchResult={jumpToSearchResult}
          onTextLayerCopy={handleTextLayerCopy}
          onTextLayerMouseUp={handleTextLayerMouseUp}
          onQuickHighlight={handleQuickHighlight}
          onQuickUnderline={handleQuickUnderline}
          onHideQuickAnnotator={() => hideQuickAnnotator()}
          onError={reportError}
        />

        <WorkspacePanel
          sortedAnnotations={sortedAnnotations}
          sortedNotes={sortedNotes}
          selectedAnnotation={selectedAnnotation}
          selectedAnnotationId={selectedAnnotationId}
          annotationCommentInput={annotationCommentInput}
          annotationTagsInput={annotationTagsInput}
          selectedNote={selectedNote}
          selectedNoteId={selectedNoteId}
          noteTitleInput={noteTitleInput}
          noteLinkedIdsInput={noteLinkedIdsInput}
          noteMarkdownInput={noteMarkdownInput}
          searchQuery={searchQuery}
          searchResults={searchResults}
          searchCursor={searchCursor}
          events={events}
          onCreateAnnotation={createAnnotation}
          onDeleteSelectedAnnotation={deleteSelectedAnnotation}
          onAnnotationCommentInputChange={setAnnotationCommentInput}
          onAnnotationTagsInputChange={setAnnotationTagsInput}
          onUpdateSelectedAnnotationMeta={updateSelectedAnnotationMeta}
          onSelectAnnotation={setSelectedAnnotationId}
          onJumpToAnnotation={jumpToAnnotation}
          onNoteTitleInputChange={setNoteTitleInput}
          onNoteLinkedIdsInputChange={setNoteLinkedIdsInput}
          onNoteMarkdownInputChange={setNoteMarkdownInput}
          onSaveNote={saveNote}
          onNewNoteDraft={newNoteDraft}
          onDeleteSelectedNote={deleteSelectedNote}
          onSelectNote={setSelectedNoteId}
          onJumpToSearchResult={jumpToSearchResult}
          onExportJson={exportJson}
          onExportMarkdown={exportMarkdown}
          onRefreshWorkspace={refreshWorkspace}
          onError={reportError}
        />
      </main>

      <ToastStack toasts={toasts} />
    </>
  );
}
