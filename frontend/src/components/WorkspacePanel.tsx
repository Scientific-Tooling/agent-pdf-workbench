import { useState } from "react";
import { buildEventLines } from "../utils/timeline";
import { WorkflowPanel } from "./WorkflowPanel";
import { EvidenceSearch } from "./EvidenceSearch";
import { ComparisonPanel } from "./ComparisonPanel";
import type { HostedWorkflow } from "../app/useHostedWorkflow";
import type { ActionEvent, Annotation, Note, SearchResult } from "../types/types";

interface WorkspacePanelProps {
  sessionId: string | null;
  workflow: HostedWorkflow;
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
  const [tab, setTab] = useState("evidence");
  const {
    workflow,
    sortedAnnotations: annotations,
    sortedNotes: notes,
    selectedAnnotationId,
    selectedNoteId,
  } = props;
  const tabs = [
    { id: "evidence", label: "Evidence", count: annotations.length },
    { id: "notes", label: "Notes", count: notes.length },
    ...(workflow.data?.capabilities?.comparisons ? [{ id: "compare", label: "Compare" }] : []),
    { id: "brief", label: "Brief" },
  ];
  const hosted = workflow.data?.enabled;
  const linkedIds = props.noteLinkedIdsInput
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  async function safely(operation: () => Promise<void>) {
    try {
      await operation();
    } catch (error) {
      props.onError(error, "Could not save this change");
    }
  }
  return (
    <aside className="panel workspace" aria-label="Annotations, notes and export">
      <header className="workspace-heading">
        <span className="eyebrow">Your reading workspace</span>
        <h2>Make the useful parts yours.</h2>
      </header>
      <div className="workspace-tabs" role="tablist" aria-label="Reading tools">
        {tabs.map((item, index) => (
          <button
            key={item.id}
            id={`tab-${item.id}`}
            className="tab-btn"
            role="tab"
            aria-selected={tab === item.id}
            aria-controls={`panel-${item.id}`}
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => setTab(item.id)}
            onKeyDown={(event) => {
              const next =
                event.key === "ArrowRight"
                  ? (index + 1) % tabs.length
                  : event.key === "ArrowLeft"
                    ? (index + tabs.length - 1) % tabs.length
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? tabs.length - 1
                        : -1;
              if (next >= 0) {
                event.preventDefault();
                setTab(tabs[next].id);
                document.getElementById(`tab-${tabs[next].id}`)?.focus();
              }
            }}
          >
            {item.label}
            {item.count !== undefined && <span className="tab-count">{item.count}</span>}
          </button>
        ))}
      </div>
      <div className="workspace-body">
        {props.searchQuery && (
          <details className="search-results" open>
            <summary>
              Search results <span className="count-pill">{props.searchResults.length}</span>
            </summary>
            <ul id="searchResultsList" className="list compact-list">
              {!props.searchResults.length && (
                <li className="muted">No matches in this document.</li>
              )}
              {props.searchResults.map((result, index) => (
                <li
                  key={`${result.page}:${index}`}
                  className={index === props.searchCursor ? "selected" : undefined}
                >
                  <button
                    className="ghost-btn text-card"
                    onClick={() => void safely(() => props.onJumpToSearchResult(index))}
                  >
                    <span className="ann-page">Page {result.page}</span>
                    {result.snippet}
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
        <section
          id="panel-evidence"
          role="tabpanel"
          aria-labelledby="tab-evidence"
          tabIndex={0}
          hidden={tab !== "evidence"}
        >
          {workflow.sessionId && workflow.data?.capabilities?.evidence_search && (
            <EvidenceSearch
              key={`${workflow.sessionId}:${workflow.data.preview?.id}:${workflow.data.preview?.applied}`}
              sessionId={workflow.sessionId}
              papers={workflow.data.papers ?? []}
            />
          )}
          <div className="section-intro">
            <h3>Saved highlights</h3>
            <p className="muted">
              Select text in the paper to highlight it and add a thought.
              {hosted
                ? " Choose the passages you want to keep as evidence."
                : " Your highlights stay with this paper."}
            </p>
          </div>
          <ul id="annotationList" className="list annotation-list">
            {!annotations.length && (
              <li className="empty-state">
                <span className="empty-mark" aria-hidden="true">
                  “
                </span>
                <h3>A useful passage starts here.</h3>
                <p>No annotations yet. Select a sentence in the PDF, then choose Highlight.</p>
              </li>
            )}
            {annotations.map((annotation) => (
              <li
                key={annotation.id}
                className={annotation.id === selectedAnnotationId ? "selected" : undefined}
              >
                <div className="evidence-card-top">
                  <span className={`ann-type ${annotation.type}`}>{annotation.type}</span>
                  <span className="ann-page">Page {annotation.page}</span>
                  {hosted && (
                    <label className="evidence-check">
                      <input
                        type="checkbox"
                        disabled={workflow.busy}
                        aria-label={`Include highlight on page ${annotation.page}: ${annotation.quote}`}
                        checked={workflow.selected.includes(`annotation:${annotation.id}`)}
                        onChange={() => workflow.toggle(`annotation:${annotation.id}`)}
                      />
                      <span className="sr-only">Include in evidence</span>
                    </label>
                  )}
                </div>
                <button
                  className="ghost-btn annotation-select"
                  aria-label={`Edit highlight on page ${annotation.page}: ${annotation.quote}`}
                  onClick={() => props.onSelectAnnotation(annotation.id)}
                >
                  <span className="quote-text">{annotation.quote || "(No text quote)"}</span>
                  {annotation.comment && (
                    <span className="annotation-comment">{annotation.comment}</span>
                  )}
                </button>
                {!!annotation.tags.length && (
                  <div className="pill-list">
                    {annotation.tags.map((tag) => (
                      <span key={tag} className="pill">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                <button
                  className="ghost-btn passage-button"
                  onClick={() => void safely(() => props.onJumpToAnnotation(annotation.id))}
                >
                  Open passage ↗
                </button>
              </li>
            ))}
          </ul>
          <details
            className="annotation-editor"
            key={selectedAnnotationId ?? "draft"}
            open={!!selectedAnnotationId}
          >
            <summary>
              {selectedAnnotationId ? "Edit selected highlight" : "Highlight tools & comments"}
            </summary>
            <fieldset disabled={workflow.busy || !props.sessionId}>
              <label>
                Comment
                <input
                  id="annotationCommentInput"
                  placeholder="What does this passage tell you?"
                  value={props.annotationCommentInput}
                  onChange={(event) => props.onAnnotationCommentInputChange(event.target.value)}
                  onBlur={() => void safely(props.onUpdateSelectedAnnotationMeta)}
                />
              </label>
              <label>
                Tags
                <input
                  id="annotationTagsInput"
                  placeholder="method, result, question"
                  value={props.annotationTagsInput}
                  onChange={(event) => props.onAnnotationTagsInputChange(event.target.value)}
                  onBlur={() => void safely(props.onUpdateSelectedAnnotationMeta)}
                />
              </label>
              <div className="row">
                <button
                  id="highlightBtn"
                  className="amber-btn"
                  onClick={() => void safely(() => props.onCreateAnnotation("highlight"))}
                >
                  Highlight
                </button>
                <button
                  id="underlineBtn"
                  className="rose-btn"
                  onClick={() => void safely(() => props.onCreateAnnotation("underline"))}
                >
                  Underline
                </button>
                <button
                  id="deleteAnnotationBtn"
                  className="danger-btn"
                  disabled={!selectedAnnotationId}
                  onClick={() => void safely(props.onDeleteSelectedAnnotation)}
                >
                  Delete
                </button>
              </div>
            </fieldset>
          </details>
          {hosted && !!notes.length && (
            <details className="notes-selection">
              <summary>
                Include saved notes <span className="count-pill">{notes.length}</span>
              </summary>
              {notes.map((note) => (
                <label className="check-row" key={note.id}>
                  <input
                    type="checkbox"
                    disabled={workflow.busy}
                    checked={workflow.selected.includes(`note:${note.id}`)}
                    onChange={() => workflow.toggle(`note:${note.id}`)}
                  />
                  <span>{note.title || "Untitled note"}</span>
                </label>
              ))}
            </details>
          )}
          <WorkflowPanel workflow={workflow} view="evidence" onOpenBrief={() => setTab("brief")} />
          {workflow.error && !hosted && (
            <p className="notice error" role="alert">
              {workflow.message}
              <button className="secondary-btn" onClick={() => void workflow.refresh()}>
                Retry project connection
              </button>
            </p>
          )}
        </section>
        <section
          id="panel-notes"
          role="tabpanel"
          aria-labelledby="tab-notes"
          tabIndex={0}
          hidden={tab !== "notes"}
        >
          <div className="section-intro">
            <h3>Think alongside the paper.</h3>
            <p className="muted">Connect your interpretation to the passages behind it.</p>
          </div>
          <fieldset disabled={!props.sessionId || workflow.busy} className="note-editor">
            <label>
              Title
              <input
                id="noteTitleInput"
                placeholder="A useful idea or question"
                value={props.noteTitleInput}
                onChange={(event) => props.onNoteTitleInputChange(event.target.value)}
              />
            </label>
            <label>
              Note
              <textarea
                id="noteMarkdownInput"
                rows={7}
                placeholder="What matters here? What would you check next?"
                value={props.noteMarkdownInput}
                onChange={(event) => props.onNoteMarkdownInputChange(event.target.value)}
              />
            </label>
            <details className="linked-passages">
              <summary>
                Link supporting highlights <span className="count-pill">{linkedIds.length}</span>
              </summary>
              {!annotations.length && <p className="muted">Highlight a passage to link it here.</p>}
              {annotations.map((annotation) => (
                <label className="check-row" key={annotation.id}>
                  <input
                    type="checkbox"
                    checked={linkedIds.includes(annotation.id)}
                    onChange={() =>
                      props.onNoteLinkedIdsInputChange(
                        (linkedIds.includes(annotation.id)
                          ? linkedIds.filter((id) => id !== annotation.id)
                          : [...linkedIds, annotation.id]
                        ).join(", "),
                      )
                    }
                  />
                  <span>
                    Page {annotation.page}: {annotation.quote}
                  </span>
                </label>
              ))}
              <details className="technical-details">
                <summary>Annotation identifiers</summary>
                <label>
                  Linked Annotation IDs
                  <input
                    id="noteLinkedIdsInput"
                    value={props.noteLinkedIdsInput}
                    onChange={(event) => props.onNoteLinkedIdsInputChange(event.target.value)}
                  />
                </label>
              </details>
            </details>
            <div className="row">
              <button
                id="saveNoteBtn"
                className="primary-btn"
                onClick={() => void safely(props.onSaveNote)}
              >
                Save note
              </button>
              <button id="newNoteBtn" className="secondary-btn" onClick={props.onNewNoteDraft}>
                New note
              </button>
              <button
                id="deleteNoteBtn"
                className="danger-btn"
                disabled={!selectedNoteId}
                onClick={() => void safely(props.onDeleteSelectedNote)}
              >
                Delete
              </button>
            </div>
          </fieldset>
          <ul id="notesList" className="list">
            {!notes.length && (
              <li className="empty-state">
                <p>Your saved notes will appear here.</p>
              </li>
            )}
            {notes.map((note) => (
              <li key={note.id} className={note.id === selectedNoteId ? "selected" : undefined}>
                <button className="ghost-btn text-card" onClick={() => props.onSelectNote(note.id)}>
                  <strong>{note.title || "Untitled note"}</strong>
                  <span className="muted">
                    {note.markdown.length > 160 ? `${note.markdown.slice(0, 160)}…` : note.markdown}
                  </span>
                </button>
                {!!note.linkedAnnotationIds.length && (
                  <div className="pill-list">
                    {note.linkedAnnotationIds.map((id) => (
                      <button
                        key={id}
                        className="ghost-btn passage-button"
                        onClick={() => void safely(() => props.onJumpToAnnotation(id))}
                      >
                        Page {annotations.find((a) => a.id === id)?.page ?? "?"} ↗
                      </button>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
        {tab === "compare" && workflow.sessionId && workflow.data?.capabilities?.comparisons && (
          <section id="panel-compare" role="tabpanel" aria-labelledby="tab-compare" tabIndex={0}>
            <ComparisonPanel key={workflow.sessionId} sessionId={workflow.sessionId} />
          </section>
        )}
        <section
          id="panel-brief"
          role="tabpanel"
          aria-labelledby="tab-brief"
          tabIndex={0}
          hidden={tab !== "brief"}
        >
          {hosted ? (
            <WorkflowPanel workflow={workflow} view="brief" onOpenBrief={() => setTab("brief")} />
          ) : (
            <div className="empty-state">
              <h3>Keep a copy of your reading.</h3>
              <p>
                Export this paper's annotations and notes below. Project briefs are available when
                you open the reader through sci.
              </p>
            </div>
          )}
          <details className="export-options">
            <summary>Export annotations & notes</summary>
            <p className="muted">A copy of this paper's saved reading material.</p>
            <div className="row">
              <button
                id="exportMarkdownBtn"
                className="secondary-btn"
                onClick={props.onExportMarkdown}
              >
                Export Markdown
              </button>
              <button id="exportJsonBtn" className="secondary-btn" onClick={props.onExportJson}>
                Export JSON
              </button>
            </div>
          </details>
        </section>
        <details className="technical-details activity-details">
          <summary>Activity & details</summary>
          <button
            id="refreshBtn"
            className="secondary-btn"
            onClick={() =>
              void safely(async () => {
                await props.onRefreshWorkspace();
                await workflow.refresh();
              })
            }
          >
            Refresh workspace
          </button>
          <ul id="eventsList" className="list compact-list">
            {props.events.map((event) => (
              <li key={event.id}>
                {buildEventLines(event).map((line, index) => (
                  <div key={index}>{line}</div>
                ))}
              </li>
            ))}
          </ul>
        </details>
      </div>
    </aside>
  );
}
