import { useState, type RefObject } from "react";

import type { PdfDocumentLike } from "../app/app-types";

interface ReaderPanelProps {
  pdfDoc: PdfDocumentLike | null;
  page: number;
  pageJumpInput: string;
  zoom: number;
  searchInputValue: string;
  searchQuery: string;
  searchResultsCount: number;
  searchCursor: number;
  searchInfoText: string;
  loadingCount: number;
  stageLoadingLabel: string;
  quickVisible: boolean;
  quickLeft: number;
  quickTop: number;
  quickCommentInput: string;
  hasPendingSelection: boolean;
  searchInputRef: RefObject<HTMLInputElement | null>;
  pdfStageRef: RefObject<HTMLDivElement | null>;
  pdfCanvasRef: RefObject<HTMLCanvasElement | null>;
  textLayerRef: RefObject<HTMLDivElement | null>;
  annotationLayerRef: RefObject<HTMLDivElement | null>;
  quickAnnotatorRef: RefObject<HTMLDivElement | null>;
  onPageJumpInputChange: (value: string) => void;
  onSearchInputValueChange: (value: string) => void;
  onQuickCommentInputChange: (value: string) => void;
  onGoPrevPage: () => Promise<void>;
  onGoNextPage: () => Promise<void>;
  onJumpToPageInput: () => Promise<void>;
  onApplyZoom: (zoom: number) => Promise<void>;
  onFitWidth: () => Promise<void>;
  onRunSearch: (query: string) => Promise<void>;
  onJumpToSearchResult: (index: number) => Promise<void>;
  onTextLayerCopy: () => Promise<void>;
  onTextLayerMouseUp: () => void;
  onQuickHighlight: () => Promise<void>;
  onQuickUnderline: () => Promise<void>;
  onHideQuickAnnotator: () => void;
  onError: (error: unknown, fallback: string) => void;
}

export function ReaderPanel(props: ReaderPanelProps) {
  const [searchExpanded, setSearchExpanded] = useState(false);

  const {
    pdfDoc,
    page,
    pageJumpInput,
    zoom,
    searchInputValue,
    searchQuery,
    searchResultsCount,
    searchCursor,
    searchInfoText,
    loadingCount,
    stageLoadingLabel,
    quickVisible,
    quickLeft,
    quickTop,
    quickCommentInput,
    hasPendingSelection,
    searchInputRef,
    pdfStageRef,
    pdfCanvasRef,
    textLayerRef,
    annotationLayerRef,
    quickAnnotatorRef,
    onPageJumpInputChange,
    onSearchInputValueChange,
    onQuickCommentInputChange,
    onGoPrevPage,
    onGoNextPage,
    onJumpToPageInput,
    onApplyZoom,
    onFitWidth,
    onRunSearch,
    onJumpToSearchResult,
    onTextLayerCopy,
    onTextLayerMouseUp,
    onQuickHighlight,
    onQuickUnderline,
    onHideQuickAnnotator,
    onError,
  } = props;

  return (
    <section className="panel reader">
      <div className="toolbar reader-toolbar">
        {/* Page navigation */}
        <div className="row">
          <button
            id="prevBtn"
            className="ghost-btn icon-btn"
            title="Previous page (j)"
            onClick={async () => {
              try {
                await onGoPrevPage();
              } catch (error) {
                onError(error, "Failed to go to previous page");
              }
            }}
          >
            ‹ Prev
          </button>
          <button
            id="nextBtn"
            className="ghost-btn icon-btn"
            title="Next page (k)"
            onClick={async () => {
              try {
                await onGoNextPage();
              } catch (error) {
                onError(error, "Failed to go to next page");
              }
            }}
          >
            Next ›
          </button>
        </div>

        <div className="toolbar-divider" />

        {/* Page jump */}
        <div className="row">
          <label className="inline-label">
            Page
            <input
              id="pageJumpInput"
              type="number"
              min={1}
              value={pageJumpInput}
              onChange={(event) => onPageJumpInputChange(event.target.value)}
              onKeyDown={async (event) => {
                if (event.key === "Enter") {
                  try {
                    await onJumpToPageInput();
                  } catch (error) {
                    onError(error, "Failed to jump page");
                  }
                }
              }}
            />
          </label>
          <button
            id="pageJumpBtn"
            className="ghost-btn"
            onClick={async () => {
              try {
                await onJumpToPageInput();
              } catch (error) {
                onError(error, "Failed to jump page");
              }
            }}
          >
            Go
          </button>
          <span id="pageInfo" className="page-info">
            {pdfDoc ? `${page} / ${pdfDoc.numPages}` : "— / —"}
          </span>
        </div>

        <div className="toolbar-divider" />

        {/* Zoom */}
        <div className="row">
          <button
            id="zoomOutBtn"
            className="ghost-btn icon-btn"
            title="Zoom out"
            onClick={async () => onApplyZoom(zoom - 0.2)}
          >
            −
          </button>
          <span id="zoomInfo" className="zoom-info">
            {`${Math.round(zoom * 100)}%`}
          </span>
          <button
            id="zoomInBtn"
            className="ghost-btn icon-btn"
            title="Zoom in"
            onClick={async () => onApplyZoom(zoom + 0.2)}
          >
            +
          </button>
          <button
            id="fitWidthBtn"
            className="ghost-btn"
            onClick={async () => {
              try {
                await onFitWidth();
              } catch (error) {
                onError(error, "Failed to fit width");
              }
            }}
          >
            Fit Width
          </button>
        </div>
      </div>

      {/* Search area */}
      {searchExpanded ? (
        <div className="search-toolbar">
          <input
            id="searchInput"
            ref={searchInputRef}
            placeholder="Find…"
            value={searchInputValue}
            onChange={(event) => onSearchInputValueChange(event.target.value)}
            onKeyDown={async (event) => {
              if (event.key === "Escape") {
                setSearchExpanded(false);
                return;
              }
              if (event.key !== "Enter") {
                return;
              }
              event.preventDefault();
              const query = searchInputValue.trim();
              if (!query) {
                await onRunSearch("");
                return;
              }
              if (searchQuery === query && searchResultsCount > 0) {
                if (event.shiftKey) {
                  await onJumpToSearchResult(searchCursor - 1);
                } else {
                  await onJumpToSearchResult(searchCursor + 1);
                }
                return;
              }
              await onRunSearch(query);
            }}
          />
          <button id="searchBtn" title="Search" onClick={async () => onRunSearch(searchInputValue)}>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </button>
          <button
            id="searchPrevBtn"
            className="ghost-btn icon-btn"
            title="Previous match (Shift+Enter)"
            onClick={async () => onJumpToSearchResult(searchCursor - 1)}
          >
            ‹
          </button>
          <button
            id="searchNextBtn"
            className="ghost-btn icon-btn"
            title="Next match (Enter)"
            onClick={async () => onJumpToSearchResult(searchCursor + 1)}
          >
            ›
          </button>
          {searchInfoText && (
            <span id="searchInfo" className="search-info">
              {searchInfoText}
            </span>
          )}
          <button
            className="ghost-btn icon-btn"
            title="Close search (Esc)"
            onClick={() => setSearchExpanded(false)}
          >
            ✕
          </button>
        </div>
      ) : (
        <button
          id="searchToggleBtn"
          className="search-toggle-btn"
          title="Search"
          onClick={() => {
            setSearchExpanded(true);
            setTimeout(() => searchInputRef.current?.focus(), 0);
          }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        </button>
      )}

      {/* PDF Stage */}
      <div id="pdfStage" ref={pdfStageRef} className="pdf-stage">
        <div className="pdf-document-container">
          <canvas id="pdfCanvas" ref={pdfCanvasRef} />
          <div
            id="textLayer"
            ref={textLayerRef}
            className="text-layer"
            onCopy={async () => {
              try {
                await onTextLayerCopy();
              } catch (error) {
                onError(error, "Failed to record copy action");
              }
            }}
            onMouseUp={() => {
              onTextLayerMouseUp();
            }}
          />
          <div id="annotationLayer" ref={annotationLayerRef} className="annotation-layer" />
        </div>
        <div id="stageLoading" className={`stage-loading ${loadingCount > 0 ? "" : "hidden"}`}>
          {stageLoadingLabel}
        </div>
        <div
          id="quickAnnotator"
          ref={quickAnnotatorRef}
          className={`quick-annotator ${quickVisible ? "" : "hidden"}`}
          style={{ left: `${quickLeft}px`, top: `${quickTop}px` }}
        >
          <input
            id="quickCommentInput"
            placeholder="Quick comment (optional)"
            value={quickCommentInput}
            onChange={(event) => onQuickCommentInputChange(event.target.value)}
          />
          <div className="row">
            <button
              id="quickHighlightBtn"
              className="amber-btn"
              onClick={async () => {
                if (!hasPendingSelection) {
                  return;
                }
                try {
                  await onQuickHighlight();
                } catch (error) {
                  onError(error, "Failed to create quick highlight");
                }
              }}
            >
              Highlight
            </button>
            <button
              id="quickUnderlineBtn"
              className="rose-btn"
              onClick={async () => {
                if (!hasPendingSelection) {
                  return;
                }
                try {
                  await onQuickUnderline();
                } catch (error) {
                  onError(error, "Failed to create quick underline");
                }
              }}
            >
              Underline
            </button>
            <button id="quickDismissBtn" className="ghost-btn" onClick={() => onHideQuickAnnotator()}>
              ✕
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
