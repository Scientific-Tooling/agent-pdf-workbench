import type { RefObject } from "react";

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
        <div className="row">
          <button
            id="prevBtn"
            onClick={async () => {
              try {
                await onGoPrevPage();
              } catch (error) {
                onError(error, "Failed to go to previous page");
              }
            }}
          >
            Prev
          </button>
          <button
            id="nextBtn"
            onClick={async () => {
              try {
                await onGoNextPage();
              } catch (error) {
                onError(error, "Failed to go to next page");
              }
            }}
          >
            Next
          </button>
        </div>
        <div className="row">
          <label className="inline-label">
            Page
            <input
              id="pageJumpInput"
              type="number"
              min={1}
              value={pageJumpInput}
              onChange={(event) => onPageJumpInputChange(event.target.value)}
            />
          </label>
          <button
            id="pageJumpBtn"
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
          <span id="pageInfo">{pdfDoc ? `Page ${page} / ${pdfDoc.numPages}` : "Page - / -"}</span>
        </div>
        <div className="row">
          <button id="zoomOutBtn" onClick={async () => onApplyZoom(zoom - 0.2)}>
            -
          </button>
          <span id="zoomInfo">{`${Math.round(zoom * 100)}%`}</span>
          <button id="zoomInBtn" onClick={async () => onApplyZoom(zoom + 0.2)}>
            +
          </button>
          <button
            id="fitWidthBtn"
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

      <div className="toolbar search-toolbar">
        <input
          id="searchInput"
          ref={searchInputRef}
          placeholder="Search in document (press Enter)"
          value={searchInputValue}
          onChange={(event) => onSearchInputValueChange(event.target.value)}
          onKeyDown={async (event) => {
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
        <button id="searchBtn" onClick={async () => onRunSearch(searchInputValue)}>
          Search
        </button>
        <button id="searchPrevBtn" onClick={async () => onJumpToSearchResult(searchCursor - 1)}>
          Prev Hit
        </button>
        <button id="searchNextBtn" onClick={async () => onJumpToSearchResult(searchCursor + 1)}>
          Next Hit
        </button>
        <span id="searchInfo">{searchInfoText}</span>
      </div>

      <div id="pdfStage" ref={pdfStageRef} className="pdf-stage">
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
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
