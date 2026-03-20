import { buildEventLines } from "../utils/timeline";
import type { ActionEvent, Annotation, Note, SearchResult } from "../types/types";

interface WorkspacePanelProps {
  sortedAnnotations: Annotation[];
  sortedNotes: Note[];
  selectedAnnotation: Annotation | null;
  selectedAnnotationId: string | null;
  annotationCommentInput: string;
  annotationTagsInput: string;
  selectedNote: Note | null;
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
    selectedAnnotation,
    selectedAnnotationId,
    annotationCommentInput,
    annotationTagsInput,
    selectedNote,
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
      <details className="card collapsible" open>
        <summary>Annotation</summary>
        <div className="card-body">
          <div className="row">
            <button
              id="highlightBtn"
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
              onClick={async () => {
                try {
                  await onDeleteSelectedAnnotation();
                } catch (error) {
                  onError(error, "Failed to delete annotation");
                }
              }}
            >
              Delete Selected
            </button>
          </div>
          <label>
            Annotation Comment
            <input
              id="annotationCommentInput"
              placeholder="Comment for current selection"
              value={annotationCommentInput}
              onChange={(event) => onAnnotationCommentInputChange(event.target.value)}
              onBlur={async () => {
                await onUpdateSelectedAnnotationMeta();
              }}
            />
          </label>
          <label>
            Tags (comma separated)
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
          <p id="selectedAnnotationInfo">Selected annotation: {selectedAnnotation ? selectedAnnotation.id : "-"}</p>
          <ul id="annotationList" className="list">
            {sortedAnnotations.length === 0 && <li className="muted">No annotations yet</li>}
            {sortedAnnotations.map((annotation) => (
              <li
                key={annotation.id}
                style={annotation.id === selectedAnnotationId ? { borderColor: "#0ea5e9" } : undefined}
                onClick={() => onSelectAnnotation(annotation.id)}
              >
                <div>
                  <strong>{annotation.type}</strong>
                  {` | p.${annotation.page}`}
                </div>
                <div>{annotation.quote || "(empty quote)"}</div>
                <div className="muted">{annotation.comment || "No comment"}</div>
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
                  onClick={async (event) => {
                    event.stopPropagation();
                    await onJumpToAnnotation(annotation.id);
                  }}
                >
                  Go
                </button>
              </li>
            ))}
          </ul>
        </div>
      </details>

      <details className="card collapsible" open>
        <summary>Notes (Markdown)</summary>
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
            Linked Annotation IDs (comma separated)
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
              rows={6}
              placeholder="Write notes in Markdown"
              value={noteMarkdownInput}
              onChange={(event) => onNoteMarkdownInputChange(event.target.value)}
            />
          </label>
          <div className="row">
            <button
              id="saveNoteBtn"
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
            <button id="newNoteBtn" onClick={() => onNewNoteDraft()}>
              New Note
            </button>
            <button
              id="deleteNoteBtn"
              onClick={async () => {
                try {
                  await onDeleteSelectedNote();
                } catch (error) {
                  onError(error, "Failed to delete note");
                }
              }}
            >
              Delete Selected
            </button>
          </div>
          <p id="selectedNoteInfo">Selected note: {selectedNote ? selectedNote.id : "-"}</p>
          <ul id="notesList" className="list">
            {sortedNotes.length === 0 && <li className="muted">No notes yet</li>}
            {sortedNotes.map((note) => (
              <li
                key={note.id}
                style={note.id === selectedNoteId ? { borderColor: "#0ea5e9" } : undefined}
                onClick={() => onSelectNote(note.id)}
              >
                <div>
                  <strong>{note.title || "(untitled note)"}</strong>
                </div>
                <div>{note.markdown.length > 160 ? `${note.markdown.slice(0, 160)}...` : note.markdown}</div>
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
                        {annId}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      </details>

      <details className="card collapsible" open>
        <summary>Search Results</summary>
        <div className="card-body">
          <ul id="searchResultsList" className="list compact-list">
            {!searchQuery && <li className="muted">No query</li>}
            {searchQuery && searchResults.length === 0 && <li className="muted">No matches</li>}
            {searchResults.map((result, index) => (
              <li
                key={`${result.page}:${result.matchIndex}:${index}`}
                style={index === searchCursor ? { borderColor: "#0ea5e9" } : undefined}
                onClick={async () => onJumpToSearchResult(index)}
              >
                <div>
                  <strong>{`p.${result.page}`}</strong>
                </div>
                <div>{result.snippet}</div>
              </li>
            ))}
          </ul>
        </div>
      </details>

      <details className="card collapsible" open>
        <summary>Exports</summary>
        <div className="card-body">
          <div className="row">
            <button id="exportJsonBtn" onClick={() => onExportJson()}>
              Export JSON
            </button>
            <button id="exportMarkdownBtn" onClick={() => onExportMarkdown()}>
              Export Markdown
            </button>
          </div>
        </div>
      </details>

      <details className="card collapsible" open>
        <summary>
          <span>Action Timeline</span>
          <button
            id="refreshBtn"
            className="ghost-btn"
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
              <li key={event.id}>
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
