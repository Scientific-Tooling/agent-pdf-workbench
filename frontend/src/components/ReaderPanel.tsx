import type { RefObject } from "react";

import type { PDFDocumentProxy } from "../types/pdfjs-types";
import { ReaderToolbar } from "./ReaderToolbar";

export interface ReaderPanelProps {
  paperTitle: string;
  paperByline?: string;
  projectTitles?: { title: string; byline: string }[];
  switching?: boolean;
  searchOpen: boolean;
  onOpenSearch: () => void;
  onCloseSearch: () => void;
  focusMode: boolean;
  onToggleFocus: () => void;
  pdfDoc: PDFDocumentProxy | null;
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
  toolbarRef: RefObject<HTMLDivElement | null>;
  pdfStageRef: RefObject<HTMLDivElement | null>;
  pdfPagesRef: RefObject<HTMLDivElement | null>;
  renderError: string;
  quickAnnotatorRef: RefObject<HTMLDivElement | null>;
  onPageJumpInputChange: (value: string) => void;
  onSearchInputValueChange: (value: string) => void;
  onQuickCommentInputChange: (value: string) => void;
  controlsOpen: boolean;
  /** With no paper open the session panel stays put, so the toggle would lie. */
  canToggleControls: boolean;
  workspaceOpen: boolean;
  onToggleControls: () => void;
  onToggleWorkspace: () => void;
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
    loadingCount,
    stageLoadingLabel,
    quickVisible,
    quickLeft,
    quickTop,
    quickCommentInput,
    hasPendingSelection,
    pdfStageRef,
    pdfPagesRef,
    quickAnnotatorRef,
    onQuickCommentInputChange,
    onTextLayerCopy,
    onTextLayerMouseUp,
    onQuickHighlight,
    onQuickUnderline,
    onHideQuickAnnotator,
    onError,
  } = props;

  return (
    <>
      <ReaderToolbar {...props} />
      <section className="panel reader" aria-label="Document reader" aria-busy={props.switching}>
        {/* PDF Stage */}
        <div id="pdfStage" ref={pdfStageRef} className="pdf-stage">
          {!pdfDoc && loadingCount === 0 && !props.switching && (
            <div className="reader-welcome">
              <span className="eyebrow">A little space to think</span>
              <h2>
                Read closely.
                <br />
                Keep what matters.
              </h2>
              <p>
                Open a paper to highlight passages, connect your notes and return to the evidence
                behind every idea.
              </p>
              <span className="welcome-line" aria-hidden="true" />
            </div>
          )}
          <div
            ref={pdfPagesRef}
            className="pdf-pages"
            inert={props.switching}
            aria-hidden={props.switching}
            onCopy={async () => {
              try {
                await onTextLayerCopy();
              } catch (error) {
                onError(error, "Failed to record copy action");
              }
            }}
            onMouseUp={onTextLayerMouseUp}
          />
          <div
            id="quickAnnotator"
            ref={quickAnnotatorRef}
            className={`quick-annotator ${quickVisible ? "" : "hidden"}`}
            style={{ left: `${quickLeft}px`, top: `${quickTop}px` }}
          >
            <input
              id="quickCommentInput"
              aria-label="Comment on selected passage"
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
              <button
                id="quickDismissBtn"
                aria-label="Dismiss selection tools"
                className="ghost-btn"
                onClick={() => onHideQuickAnnotator()}
              >
                ✕
              </button>
            </div>
          </div>
        </div>
        {props.renderError && (
          <div className="reader-render-error" role="alert">
            {props.renderError}
          </div>
        )}
        <div
          id="stageLoading"
          role="status"
          className={`stage-loading ${loadingCount > 0 || props.switching ? "" : "hidden"}`}
        >
          {props.switching ? "Loading paper…" : stageLoadingLabel}
        </div>
      </section>
    </>
  );
}
