import type { HostedWorkflow } from "../app/useHostedWorkflow";

export function WorkflowPanel({
  workflow,
  view,
  onOpenBrief,
}: {
  workflow: HostedWorkflow;
  view: "evidence" | "brief";
  onOpenBrief: () => void;
}) {
  const { data, preview, busy, selected, message, error, run } = workflow;
  if (!data?.enabled) return null;
  const brief = data.brief;
  function downloadBrief() {
    const url = URL.createObjectURL(new Blob([brief?.text ?? ""], { type: "text/markdown" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "reading-brief.md";
    anchor.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section
      className="workflow-card"
      aria-label={view === "brief" ? "Project brief" : "Evidence import"}
    >
      {view === "evidence" ? (
        <>
          <div className="selection-actions">
            <span className="muted">
              {selected.length
                ? `${selected.length} selected`
                : "Select highlights or notes to keep as evidence."}
            </span>
            {(!preview || preview.applied) && (
              <button
                className={preview?.applied ? "secondary-btn" : "primary-btn"}
                disabled={busy || !selected.length}
                onClick={() => void run("preview")}
              >
                Preview selected evidence
              </button>
            )}
          </div>
          {preview && (
            <section aria-label="Import preview" className="workflow-preview">
              <details open={!preview.applied}>
                <summary className="section-head">
                  <span>{preview.applied ? "Imported selection" : "Review your selection"}</span>
                  {preview.applied && <span className="status-badge success">Imported</span>}
                </summary>
                <p className="muted">
                  {preview.counts.addition} new · {preview.counts.unchanged} unchanged ·{" "}
                  {preview.counts.conflict} conflicts
                </p>
                {preview.items.map((item) => (
                  <article className="preview-item" key={`${item.kind}:${item.id}`}>
                    {item.passages.map((passage, index) => (
                      <blockquote key={index}>
                        <small>Page {passage.page}</small>
                        {passage.quote}
                      </blockquote>
                    ))}
                    {(item.content.comment || item.content.title) && (
                      <p>{item.content.comment || item.content.title}</p>
                    )}
                    {item.content.markdown && <pre>{item.content.markdown}</pre>}
                    <span className="status-badge">Review: {item.review.status}</span>
                  </article>
                ))}
                {!preview.applied && (
                  <button
                    className="primary-btn"
                    disabled={busy || preview.counts.conflict > 0}
                    onClick={() => void run("apply")}
                  >
                    Import evidence & create brief
                  </button>
                )}
                {preview.counts.conflict > 0 && (
                  <p className="notice error">
                    Resolve the reported conflicts before importing. No evidence has been changed.
                  </p>
                )}
                <details className="technical-details">
                  <summary>Import details</summary>
                  <pre>{JSON.stringify(preview.plan, null, 2)}</pre>
                </details>
              </details>
            </section>
          )}
          {brief && (
            <button className="secondary-btn full-width" onClick={onOpenBrief}>
              View project brief →
            </button>
          )}
        </>
      ) : (
        <>
          <div className="section-intro">
            <span className="eyebrow">Across your project</span>
            <h2>A brief you can trace back.</h2>
            <p className="muted">
              Quotations, interpretations and source links from your imported evidence. Review
              status stays explicit.
            </p>
          </div>
          {brief ? (
            <>
              <div className="brief-stats">
                {brief.counts && (
                  <>
                    <div>
                      <strong>{brief.counts.evidence}</strong>
                      <span>Evidence items</span>
                    </div>
                    <div>
                      <strong>{brief.counts.unreviewed}</strong>
                      <span>Unreviewed</span>
                    </div>
                  </>
                )}
                <div>
                  <strong>{brief.passage_urls.length}</strong>
                  <span>Source links</span>
                </div>
              </div>
              <button className="primary-btn full-width" onClick={downloadBrief}>
                Download brief
              </button>
              <details className="brief-text">
                <summary>Read the brief</summary>
                <pre>{brief.text}</pre>
              </details>
              <div className="section-intro">
                <h3>Return to the sources</h3>
                <p className="muted">Each link opens its paper and supporting passage.</p>
              </div>
              <ol className="source-links">
                {brief.passage_urls.map((url, index) => (
                  <li key={`${url}:${index}`}>
                    <a href={url}>
                      Open supporting passage {index + 1}
                      <span aria-hidden="true"> ↗</span>
                    </a>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <div className="empty-state">
              <h3>Your evidence comes first.</h3>
              <p>
                Choose saved highlights in Evidence, preview the selection, then import it to create
                your project brief.
              </p>
              <p>Papers with no imported evidence stay visible as coverage gaps.</p>
            </div>
          )}
          <button
            className={brief ? "secondary-btn full-width" : "primary-btn full-width"}
            disabled={busy}
            onClick={() => void run("brief")}
          >
            {brief
              ? "Update brief from imported evidence"
              : "Generate brief from imported evidence"}
          </button>
        </>
      )}
      {(busy || message) && (
        <p
          className={`notice ${error ? "error" : ""}`}
          role={error ? "alert" : "status"}
          aria-live="polite"
        >
          {busy ? "Working…" : message}
        </p>
      )}
      {error && workflow.operationDetails != null && (
        <details className="technical-details">
          <summary>Conflict details</summary>
          <pre>{JSON.stringify(workflow.operationDetails, null, 2)}</pre>
        </details>
      )}
    </section>
  );
}
