import type { ReaderPanelProps } from "./ReaderPanel";
import { ReaderIcon } from "./ReaderIcon";

export function ReaderToolbar(props: ReaderPanelProps) {
  const {
    pdfDoc,
    pageJumpInput,
    zoom,
    searchInputValue,
    searchQuery,
    searchResultsCount,
    searchCursor,
  } = props;
  async function safely(operation: () => Promise<void>) {
    try {
      await operation();
    } catch (error) {
      props.onError(error, "Could not update the reader");
    }
  }
  return (
    <div className="reader-toolbar" ref={props.toolbarRef}>
      <div className="reader-title-row">
        <div className="reader-title-content">
          <h2 className="reader-title">{props.paperTitle}</h2>
          {props.paperByline && <p className="reader-byline">{props.paperByline}</p>}
        </div>
        {props.projectTitles?.map((paper, index) => (
          <div key={index} className="reader-title-measure" aria-hidden="true">
            <div className="reader-title">{paper.title}</div>
            {paper.byline && <p className="reader-byline">{paper.byline}</p>}
          </div>
        ))}
      </div>
      <div className="reader-controls" aria-label="Reading controls">
        <button
          id="toggleControlsBtn"
          className="ghost-btn icon-btn"
          title={props.controlsOpen ? "Hide papers" : "Show papers"}
          aria-label={props.controlsOpen ? "Hide session panel" : "Show session panel"}
          aria-expanded={props.controlsOpen}
          disabled={!props.canToggleControls}
          onClick={props.onToggleControls}
        >
          <ReaderIcon name="papers" />
          <span className="toolbar-button-label">Papers</span>
        </button>
        <div
          className="toolbar-group"
          role="group"
          aria-label="Page navigation"
          inert={props.switching}
        >
          <button
            id="prevBtn"
            className="ghost-btn icon-btn"
            title="Previous page (k)"
            aria-label="Previous page"
            disabled={!pdfDoc || props.page <= 1}
            onClick={() => void safely(props.onGoPrevPage)}
          >
            ‹
          </button>
          <label className="inline-label">
            <span className="sr-only">Page</span>
            <input
              id="pageJumpInput"
              type="number"
              min={1}
              max={pdfDoc?.numPages}
              disabled={!pdfDoc}
              value={pageJumpInput}
              onChange={(event) => props.onPageJumpInputChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void safely(props.onJumpToPageInput);
              }}
            />
          </label>
          <span id="pageInfo" className="page-info">
            / {pdfDoc?.numPages ?? "—"}
          </span>
          <button
            id="nextBtn"
            className="ghost-btn icon-btn"
            title="Next page (j)"
            aria-label="Next page"
            disabled={!pdfDoc || props.page >= pdfDoc.numPages}
            onClick={() => void safely(props.onGoNextPage)}
          >
            ›
          </button>
        </div>
        <div className="toolbar-group" role="group" aria-label="Zoom" inert={props.switching}>
          <button
            id="zoomOutBtn"
            className="ghost-btn icon-btn"
            title="Zoom out"
            aria-label="Zoom out"
            disabled={!pdfDoc}
            onClick={() => void safely(() => props.onApplyZoom(zoom - 0.2))}
          >
            −
          </button>
          <span id="zoomInfo" className="zoom-info">
            {Math.round(zoom * 100)}%
          </span>
          <button
            id="zoomInBtn"
            className="ghost-btn icon-btn"
            title="Zoom in"
            aria-label="Zoom in"
            disabled={!pdfDoc}
            onClick={() => void safely(() => props.onApplyZoom(zoom + 0.2))}
          >
            +
          </button>
          <button
            id="fitWidthBtn"
            className="ghost-btn"
            disabled={!pdfDoc}
            onClick={() => void safely(props.onFitWidth)}
          >
            Fit width
          </button>
        </div>
        <div className="reader-actions" role="group" aria-label="Reader options">
          <button
            id="findInDocumentBtn"
            className="ghost-btn icon-btn"
            title="Find in document (f)"
            aria-label="Find in document"
            aria-expanded={props.searchOpen}
            aria-controls="document-search"
            disabled={!pdfDoc}
            onClick={props.onOpenSearch}
          >
            <ReaderIcon name="search" />
          </button>
          <button
            id="focusModeBtn"
            className="ghost-btn"
            aria-pressed={props.focusMode}
            onClick={props.onToggleFocus}
            disabled={!pdfDoc}
          >
            <ReaderIcon name="focus" />
            {props.focusMode ? "Exit focus" : "Focus"}
          </button>
          <button
            id="toggleWorkspaceBtn"
            className="ghost-btn"
            title={props.workspaceOpen ? "Hide workspace panel" : "Show workspace panel"}
            aria-label={props.workspaceOpen ? "Hide workspace panel" : "Show workspace panel"}
            aria-expanded={props.workspaceOpen}
            onClick={props.onToggleWorkspace}
          >
            <ReaderIcon name="workspace" />
            <span className="toolbar-button-label">Workspace</span>
          </button>
        </div>
      </div>
      {props.searchOpen && (
        <div
          id="document-search"
          className="toolbar-search"
          role="search"
          aria-label="Search this paper"
        >
          <input
            id="searchInput"
            ref={props.searchInputRef}
            type="search"
            placeholder="Find in document"
            aria-label="Find in document"
            value={searchInputValue}
            onChange={(event) => props.onSearchInputValueChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                props.onCloseSearch();
                return;
              }
              if (event.key !== "Enter") return;
              event.preventDefault();
              const query = searchInputValue.trim();
              void safely(() =>
                query && searchQuery === query && searchResultsCount > 0
                  ? props.onJumpToSearchResult(searchCursor + (event.shiftKey ? -1 : 1))
                  : props.onRunSearch(query),
              );
            }}
          />
          <button
            id="searchBtn"
            className="ghost-btn icon-btn"
            title="Search"
            aria-label="Search"
            onClick={() => void safely(() => props.onRunSearch(searchInputValue))}
          >
            <ReaderIcon name="search" />
          </button>
          {props.searchInfoText && (
            <span id="searchInfo" className="search-info" role="status">
              {props.searchInfoText}
            </span>
          )}
          <button
            id="searchPrevBtn"
            className="ghost-btn icon-btn"
            title="Previous match (Shift+Enter)"
            aria-label="Previous match"
            disabled={!searchResultsCount}
            onClick={() => void safely(() => props.onJumpToSearchResult(searchCursor - 1))}
          >
            ‹
          </button>
          <button
            id="searchNextBtn"
            className="ghost-btn icon-btn"
            title="Next match (Enter)"
            aria-label="Next match"
            disabled={!searchResultsCount}
            onClick={() => void safely(() => props.onJumpToSearchResult(searchCursor + 1))}
          >
            ›
          </button>
          <button
            className="ghost-btn icon-btn"
            aria-label="Close document search"
            onClick={props.onCloseSearch}
          >
            <ReaderIcon name="close" />
          </button>
        </div>
      )}
    </div>
  );
}
