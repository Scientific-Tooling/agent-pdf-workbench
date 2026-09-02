import { buildEventLines } from "../utils/timeline";
import type { ActionEvent, Annotation, Note, SearchResult } from "../types/types";

interface WorkspacePanelProps {
  sortedAnnotations: Annotation[];
  sortedNotes: Note[];
  selectedAnnotationId: string | null;
  annotationCommentInput: string;
  annotationTagsInput: string;
  selectedNoteId: string | null;
  noteTitleInput: string;
  noteLinkedIdsInput: string;
  noteMarkdownInput: string;
  searchQuery: string;
  searchResults: SearchResult[];
  searchCursor: number;
  events: ActionEvent[];
  onCreateAnnotation: (type: "highlight" | "underline") => Promise<void>;
  onDeleteSelectedAnnotation: () => Promise<void>;
  onAnnotationCommentInputChange: (value: string) => void;
  onAnnotationTagsInputChange: (value: string) => void;
  onUpdateSelectedAnnotationMeta: () => Promise<void>;
  onSelectAnnotation: (annotationId: string) => void;
  onJumpToAnnotation: (annotationId: string) => Promise<void>;
  onNoteTitleInputChange: (value: string) => void;
  onNoteLinkedIdsInputChange: (value: string) => void;
  onNoteMarkdownInputChange: (value: string) => void;
  onSaveNote: () => Promise<void>;
  onNewNoteDraft: () => void;
  onDeleteSelectedNote: () => Promise<void>;
  onSelectNote: (noteId: string) => void;
  onJumpToSearchResult: (index: number) => Promise<void>;
  onExportJson: () => void;
  onExportMarkdown: () => void;
  onRefreshWorkspace: () => Promise<void>;
  onError: (error: unknown, fallback: string) => void;
}

export function WorkspacePanel(props: WorkspacePanelProps) {
  const {
    sortedAnnotations,
    sortedNotes,
    selectedAnnotationId,
    annotationCommentInput,
    annotationTagsInput,
    selectedNoteId,
    noteTitleInput,
    noteLinkedIdsInput,
    noteMarkdownInput,
    searchQuery,
    searchResults,
    searchCursor,
    events,
    onCreateAnnotation,
    onDeleteSelectedAnnotation,
    onAnnotationCommentInputChange,
    onAnnotationTagsInputChange,
    onUpdateSelectedAnnotationMeta,
    onSelectAnnotation,
    onJumpToAnnotation,
    onNoteTitleInputChange,
    onNoteLinkedIdsInputChange,
    onNoteMarkdownInputChange,
    onSaveNote,
    onNewNoteDraft,
    onDeleteSelectedNote,
    onSelectNote,
    onJumpToSearchResult,
    onExportJson,
    onExportMarkdown,
    onRefreshWorkspace,
    onError,
  } = props;

  return (
    <aside className="panel workspace">
      {/* Annotation section */}
      <details className="card collapsible" open>
        <summary>
          <span className="collapsible-arrow">›</span>
          <h2 style={{ margin: 0 }}>Annotations</h2>
          <span className="pill count-pill" title="Annotations on this paper">
            {sortedAnnotations.length}
          </span>
        </summary>
        <div className="card-body">
          <div className="row">
            <button
              id="highlightBtn"
              className="amber-btn"
              onClick={async () => {
                try {
                  await onCreateAnnotation("highlight");
                } catch (error) {
                  onError(error, "Failed to create highlight");
                }
              }}
            >
              Highlight
            </button>
            <button
              id="underlineBtn"
              className="rose-btn"
              onClick={async () => {
                try {
                  await onCreateAnnotation("underline");
                } catch (error) {
                  onError(error, "Failed to create underline");
                }
              }}
            >
              Underline
            </button>
            <button
              id="deleteAnnotationBtn"
              className="danger-btn"
              onClick={async () => {
                try {
                  await onDeleteSelectedAnnotation();
                } catch (error) {
                  onError(error, "Failed to delete annotation");
                }
              }}
            >
              Delete
            </button>
          </div>
          <label>
            Comment
            <input
              id="annotationCommentInput"
              placeholder="Add a comment…"
              value={annotationCommentInput}
              onChange={(event) => onAnnotationCommentInputChange(event.target.value)}
              onBlur={async () => {
                await onUpdateSelectedAnnotationMeta();
              }}
            />
          </label>
          <label>
            Tags
            <input
              id="annotationTagsInput"
              placeholder="method, result, question"
              value={annotationTagsInput}
              onChange={(event) => onAnnotationTagsInputChange(event.target.value)}
              onBlur={async () => {
                await onUpdateSelectedAnnotationMeta();
              }}
            />
          </label>
          <ul id="annotationList" className="list">
            {sortedAnnotations.length === 0 && (
              <li className="muted" style={{ cursor: "default" }}>
                No annotations yet
              </li>
            )}
            {sortedAnnotations.map((annotation) => (
              <li
                key={annotation.id}
                className={annotation.id === selectedAnnotationId ? "selected" : undefined}
                onClick={() => onSelectAnnotation(annotation.id)}
              >
                <div className="row" style={{ gap: "6px" }}>
                  <span className={`ann-type ${annotation.type}`}>{annotation.type}</span>
                  <span className="ann-page">p.{annotation.page}</span>
                </div>
                <div className="quote-text">{annotation.quote || "(empty quote)"}</div>
                {annotation.comment && <div className="muted">{annotation.comment}</div>}
                {annotation.tags.length > 0 && (
                  <div className="pill-list">
                    {annotation.tags.map((tag) => (
                      <span key={`${annotation.id}:${tag}`} className="pill">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                <button
                  className="ghost-btn"
                  style={{ alignSelf: "flex-start", marginTop: "2px" }}
                  onClick={async (event) => {
                    event.stopPropagation();
                    await onJumpToAnnotation(annotation.id);
                  }}
                >
                  Jump to ›
                </button>
              </li>
            ))}
          </ul>
        </div>
      </details>

      {/* Notes section */}
      <details className="card collapsible" open>
        <summary>
          <span className="collapsible-arrow">›</span>
          <h2 style={{ margin: 0 }}>Notes</h2>
          <span className="pill count-pill" title="Notes on this paper">
            {sortedNotes.length}
          </span>
        </summary>
        <div className="card-body">
          <label>
            Title
            <input
              id="noteTitleInput"
              placeholder="Key idea from this paper"
              value={noteTitleInput}
              onChange={(event) => onNoteTitleInputChange(event.target.value)}
            />
          </label>
          <label>
            Linked Annotation IDs
            <input
              id="noteLinkedIdsInput"
              placeholder="ann_abc123, ann_def456"
              value={noteLinkedIdsInput}
              onChange={(event) => onNoteLinkedIdsInputChange(event.target.value)}
            />
          </label>
          <label>
            Content
            <textarea
              id="noteMarkdownInput"
              rows={5}
              placeholder="Write notes in Markdown…"
              value={noteMarkdownInput}
              onChange={(event) => onNoteMarkdownInputChange(event.target.value)}
            />
          </label>
          <div className="row">
            <button
              id="saveNoteBtn"
              className="success-btn"
              onClick={async () => {
                try {
                  await onSaveNote();
                } catch (error) {
                  onError(error, "Failed to save note");
                }
              }}
            >
              Save Note
            </button>
            <button id="newNoteBtn" className="ghost-btn" onClick={() => onNewNoteDraft()}>
              New Note
            </button>
            <button
              id="deleteNoteBtn"
              className="danger-btn"
              onClick={async () => {
                try {
                  await onDeleteSelectedNote();
                } catch (error) {
                  onError(error, "Failed to delete note");
                }
              }}
            >
              Delete
            </button>
          </div>
          <ul id="notesList" className="list">
            {sortedNotes.length === 0 && (
              <li className="muted" style={{ cursor: "default" }}>
                No notes yet
              </li>
            )}
            {sortedNotes.map((note) => (
              <li
                key={note.id}
                className={note.id === selectedNoteId ? "selected" : undefined}
                onClick={() => onSelectNote(note.id)}
              >
                <div style={{ fontWeight: 600, fontSize: "0.84rem" }}>
                  {note.title || "(untitled note)"}
                </div>
                <div className="muted">
                  {note.markdown.length > 120 ? `${note.markdown.slice(0, 120)}…` : note.markdown}
                </div>
                {note.linkedAnnotationIds.length > 0 && (
                  <div className="pill-list">
                    {note.linkedAnnotationIds.map((annId) => (
                      <button
                        key={`${note.id}:${annId}`}
                        className="pill"
                        onClick={async (event) => {
                          event.stopPropagation();
                          await onJumpToAnnotation(annId);
                        }}
                      >
                        {annId.slice(-8)}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      </details>

      {/* Search results */}
      <details className="card collapsible" open>
        <summary>
          <span className="collapsible-arrow">›</span>
          <h2 style={{ margin: 0 }}>Search Results</h2>
          {searchResults.length > 0 && (
            <span className="pill" style={{ marginLeft: "auto" }}>
              {searchResults.length}
            </span>
          )}
        </summary>
        <div className="card-body">
          <ul id="searchResultsList" className="list compact-list">
            {!searchQuery && (
              <li className="muted" style={{ cursor: "default" }}>
                No query
              </li>
            )}
            {searchQuery && searchResults.length === 0 && (
              <li className="muted" style={{ cursor: "default" }}>
                No matches
              </li>
            )}
            {searchResults.map((result, index) => (
              <li
                key={`${result.page}:${result.matchIndex}:${index}`}
                className={index === searchCursor ? "selected" : undefined}
                onClick={async () => onJumpToSearchResult(index)}
              >
                <span className="ann-page" style={{ fontWeight: 600 }}>{`p.${result.page}`}</span>
                <div className="muted">{result.snippet}</div>
              </li>
            ))}
          </ul>
        </div>
      </details>

      {/* Exports */}
      <details className="card collapsible" open>
        <summary>
          <span className="collapsible-arrow">›</span>
          <h2 style={{ margin: 0 }}>Export</h2>
        </summary>
        <div className="card-body">
          <div className="row">
            <button id="exportJsonBtn" className="ghost-btn" onClick={() => onExportJson()}>
              Export JSON
            </button>
            <button id="exportMarkdownBtn" className="ghost-btn" onClick={() => onExportMarkdown()}>
              Export Markdown
            </button>
          </div>
        </div>
      </details>

      {/* Action Timeline */}
      <details className="card collapsible" open>
        <summary>
          <span className="collapsible-arrow">›</span>
          <h2 style={{ margin: 0 }}>Action Timeline</h2>
          <button
            id="refreshBtn"
            className="ghost-btn"
            style={{ marginLeft: "auto", padding: "2px 8px", fontSize: "0.75rem" }}
            onClick={async (event) => {
              event.preventDefault();
              event.stopPropagation();
              try {
                await onRefreshWorkspace();
              } catch (error) {
                onError(error, "Failed to refresh workspace data");
              }
            }}
          >
            Refresh
          </button>
        </summary>
        <div className="card-body">
          <ul id="eventsList" className="list compact-list">
            {events.map((event) => (
              <li key={event.id} style={{ cursor: "default" }}>
                {buildEventLines(event).map((line, lineIndex) => (
                  <div key={`${event.id}:${lineIndex}`}>{line}</div>
                ))}
              </li>
            ))}
          </ul>
        </div>
      </details>
    </aside>
  );
}
