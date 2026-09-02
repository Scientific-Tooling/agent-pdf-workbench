import { useEffect, useRef, useState } from "react";

import { ControlPanel } from "../components/ControlPanel";
import { ReaderPanel } from "../components/ReaderPanel";
import { ToastStack } from "../components/ToastStack";
import { WorkspacePanel } from "../components/WorkspacePanel";
import { useGlobalWorkspaceShortcuts } from "../hooks/useGlobalWorkspaceShortcuts";
import { useSyncedRef } from "../hooks/useSyncedRef";
import { useToastStack } from "../hooks/useToastStack";
import {
  getSelectionRectsAndQuote as getSelectionRectsAndQuoteFromDom,
  renderAnnotationLayer as renderAnnotationLayerFromDom,
} from "../pdf/annotation-helpers";
import { ANCHOR_CONTEXT_CHARS } from "./app-types";
import type { PendingSelection } from "./app-types";
import {
  exportJson as exportJsonFile,
  exportMarkdown as exportMarkdownFile,
} from "../services/exporters";
import { clamp, errorMessage, nowIso } from "../utils/main-utils";
import { applySearchHighlightsToCurrentPage as applySearchHighlightsToCurrentPageInDom } from "../ui/search-highlight";
import { upsertProgress, upsertRecentPaper } from "../services/storage";
import { useWorkspaceSelection } from "./useWorkspaceSelection";
import type { PaperSession } from "../types/types";
import { usePaperSession } from "./usePaperSession";
import { usePdfReader } from "./usePdfReader";
import type { OpenDocument } from "./usePdfReader";
import { usePdfSearch } from "./usePdfSearch";
import { useWorkspaceCommands } from "./useWorkspaceCommands";
import { useWorkspaceData } from "./useWorkspaceData";

export function App() {
  const [status, setStatus] = useState("idle");
  const [quickVisible, setQuickVisible] = useState(false);
  const [quickLeft, setQuickLeft] = useState(8);
  const [quickTop, setQuickTop] = useState(8);
  const [quickCommentInput, setQuickCommentInput] = useState("");
  const [pendingSelection, setPendingSelection] = useState<PendingSelection | null>(null);

  const { toasts, showToast } = useToastStack();

  const sessionRef = useRef<PaperSession | null>(null);
  const {
    annotations,
    selectedAnnotationId,
    setSelectedAnnotationId,
    notes,
    selectedNoteId,
    setSelectedNoteId,
    events,
    recordAction,
    loadFor: loadWorkspaceFor,
    refreshEvents,
    refreshDomainState,
    upsertAnnotation,
    deleteAnnotation,
    upsertNote,
    deleteNote,
    clearWorkspaceData,
  } = useWorkspaceData({
    sessionRef,
    onError: (message) => setStatus(message),
  });

  const pdfStageRef = useRef<HTMLDivElement | null>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const annotationLayerRef = useRef<HTMLDivElement | null>(null);
  const quickAnnotatorRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // The reader owns the document, page rendering, caches, zoom and outline;
  // App keeps session, annotation, note and export orchestration.
  const {
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
    handleStageWheel,
  } = usePdfReader({
    pdfStageRef,
    pdfCanvasRef,
    textLayerRef,
    annotationLayerRef,
    onProgress: persistReadingProgress,
    onPageChange: async (renderedPage, totalPages, sessionId) => {
      await recordAction("page_change", { total_pages: totalPages }, renderedPage, null, sessionId);
    },
    onZoomChange: async (nextZoom, currentPage) => {
      await recordAction("zoom_change", { zoom: nextZoom }, currentPage);
    },
  });

  const {
    searchInputValue,
    setSearchInputValue,
    searchQuery,
    searchResults,
    searchCursor,
    searchInfoText,
    runSearch,
    jumpToSearchResult,
    clearSearch,
  } = usePdfSearch({
    pdfDocRef,
    pageRef,
    ensurePageText,
    withStageLoading,
    renderPage,
    onResultSummary: (message, kind) => showToast(message, kind, 1600),
  });

  // Subscribe once and dispatch through a ref, so the listener is not swapped
  // on every render.
  const stageWheelRef = useSyncedRef(handleStageWheel);
  useEffect(() => {
    const stage = pdfStageRef.current;
    if (!stage) {
      return;
    }
    const listener = (event: WheelEvent): void => stageWheelRef.current(event);
    stage.addEventListener("wheel", listener, { passive: true });
    return () => stage.removeEventListener("wheel", listener);
  }, [stageWheelRef]);
  // Written synchronously when a paper opens, because reading progress is
  // persisted from inside the same call stack that sets the React state.

  const {
    session,
    paperRef,
    setPaperRef,
    pdfUri,
    setPdfUri,
    recentPapers,
    refreshRecentPapers,
    openPaper,
    openPaperWithInputs,
    closeSession,
  } = usePaperSession({
    sessionRef,
    openDocument,
    loadWorkspaceFor,
    resetViewer,
    clearSearch,
    clearWorkspaceData,
    setStatus,
    showToast,
    onError: reportError,
  });

  const { selectedAnnotation, selectedNote, sortedAnnotations, sortedNotes } =
    useWorkspaceSelection({
      annotations,
      selectedAnnotationId,
      notes,
      selectedNoteId,
    });

  const {
    annotationCommentInput,
    setAnnotationCommentInput,
    annotationTagsInput,
    setAnnotationTagsInput,
    noteTitleInput,
    setNoteTitleInput,
    noteLinkedIdsInput,
    setNoteLinkedIdsInput,
    noteMarkdownInput,
    setNoteMarkdownInput,
    clearInputs,
    createAnnotation,
    updateSelectedAnnotationMeta,
    jumpToAnnotation,
    deleteSelectedAnnotation,
    saveNote,
    deleteSelectedNote,
    newNoteDraft,
  } = useWorkspaceCommands({
    sessionRef,
    pageRef,
    annotations,
    selectedAnnotation,
    selectedNote,
    setSelectedAnnotationId,
    setSelectedNoteId,
    upsertAnnotation,
    deleteAnnotationLocally: deleteAnnotation,
    upsertNote,
    deleteNoteLocally: deleteNote,
    recordAction,
    getSelectionRectsAndQuote,
    renderPage,
    onHideQuickAnnotator: hideQuickAnnotator,
    setStatus,
    showToast,
  });

  function reportError(error: unknown, fallback = "Operation failed"): void {
    const message = errorMessage(error) || fallback;
    setStatus(message);
    showToast(message, "error", 3200);
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

  /** Everything the viewer shows, minus which paper is open. */
  function resetViewer(): void {
    resetReader();
    clearSearch();
    clearWorkspaceData();
    clearInputs();
    hideQuickAnnotator();
  }

  function persistReadingProgress(nextPage: number, nextZoom: number, openDoc: OpenDocument): void {
    const progress = {
      paperRef: openDoc.paperRef,
      pdfUri: openDoc.pdfUri,
      sessionId: openDoc.sessionId,
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
    refreshRecentPapers();
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
  }, [annotations, page, pageTextCacheRef, selectedAnnotationId, setSelectedAnnotationId]);

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
          onRefreshRecent={refreshRecentPapers}
          onLoadRecent={async (recent) => {
            await openPaperWithInputs(recent.paperRef, recent.pdfUri, {
              preferredPage: recent.lastPage,
            });
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
