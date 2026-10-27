import type { OutlineItem, RecentPaper } from "../types/types";
import type { HostedWorkflow } from "../app/useHostedWorkflow";
import { fileNameOf } from "../utils/main-utils";

interface ControlPanelProps {
  workflow: HostedWorkflow;
  onDismiss: () => void;
  paperRef: string;
  pdfUri: string;
  sessionId: string | null;
  status: string;
  recentPapers: RecentPaper[];
  outline: OutlineItem[];
  onPaperRefChange: (value: string) => void;
  onPdfUriChange: (value: string) => void;
  onOpenPaper: () => Promise<void>;
  onCloseSession: () => Promise<void>;
  onRefreshRecent: () => void;
  onLoadRecent: (paper: RecentPaper) => Promise<void>;
  onJumpToOutlinePage: (page: number) => Promise<void>;
  onError: (error: unknown, fallback: string) => void;
}

export function ControlPanel(props: ControlPanelProps) {
  const { workflow, sessionId, pdfUri, paperRef, outline, recentPapers } = props;
  const hosted = workflow.data?.enabled;
  async function safely(operation: () => Promise<void>) {
    try {
      await operation();
    } catch (error) {
      props.onError(error, "Could not open this paper");
    }
  }
  const form = (
    <div className="session-form">
      <label>
        Paper label
        <input
          id="paperRef"
          placeholder="A name for this paper"
          value={paperRef}
          onChange={(event) => props.onPaperRefChange(event.target.value)}
        />
      </label>
      <label>
        PDF path
        <input
          id="pdfUri"
          placeholder="Path to a local PDF"
          value={pdfUri}
          onChange={(event) => props.onPdfUriChange(event.target.value)}
        />
      </label>
      <button
        id="openPaperBtn"
        className="primary-btn"
        onClick={() => void safely(props.onOpenPaper)}
      >
        Open paper
      </button>
    </div>
  );
  return (
    <aside className="panel controls" aria-label="Session and navigation">
      <div className="app-header">
        <span className="app-logo" aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            width="24"
            height="24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          >
            <path d="M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-3H4zM13 7h7v14h-3a4 4 0 0 0-4-3" />
          </svg>
        </span>
        <div>
          <span className="brand-label">Scientific Tooling</span>
          <h1>Paper workspace</h1>
        </div>
        {sessionId && (
          <button
            className="ghost-btn drawer-close"
            aria-label="Close paper navigation"
            onClick={props.onDismiss}
          >
            ×
          </button>
        )}
      </div>
      {hosted ? (
        <>
          <section className="project-context">
            <span className="eyebrow">Research question</span>
            <p>{workflow.data?.question}</p>
            <span className="local-label">
              <span className="status-dot" />
              Saved in your project
            </span>
          </section>
          <nav aria-label="Project papers" className="project-papers">
            <div className="section-head">
              <h2>
                Papers <span className="count-pill">{workflow.data?.papers?.length ?? 0}</span>
              </h2>
              <button
                className="ghost-btn"
                disabled={workflow.busy}
                onClick={() => void workflow.refresh()}
                aria-label="Refresh project"
              >
                ↻
              </button>
            </div>
            <ul>
              {workflow.data?.papers?.map((paper) => (
                <li key={paper.key}>
                  {paper.viewer_url ? (
                    <a
                      href={paper.viewer_url}
                      aria-current={paper.session_id === sessionId ? "page" : undefined}
                    >
                      <span className="paper-index">{paper.key}</span>
                      <span className="paper-name">
                        {paper.title}
                        <small>
                          {paper.phase === "imported" || paper.phase === "brief"
                            ? "Evidence saved"
                            : paper.phase === "preview"
                              ? "Selection ready"
                              : paper.phase === "initializing"
                                ? "Preparing paper"
                                : "Ready to read"}
                        </small>
                      </span>
                      {paper.session_id === sessionId && (
                        <span className="current-dot" aria-label="Current paper" />
                      )}
                    </a>
                  ) : (
                    <span className="paper-pending">{paper.title} · Preparing</span>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        </>
      ) : (
        <section className="card session-card">
          {sessionId ? (
            <>
              <span className="eyebrow">Reading now</span>
              <h2 className="current-paper-title">{fileNameOf(pdfUri)}</h2>
            </>
          ) : (
            <>
              <div className="section-intro">
                <h2>Begin with a paper.</h2>
                <p className="muted">Read, highlight and keep your thoughts close to the source.</p>
              </div>
              {form}
            </>
          )}
        </section>
      )}
      {outline.length > 0 && (
        <section className="outline-section">
          <h2>In this paper</h2>
          <ul id="outlineList" className="list compact-list">
            {outline.map((item) => (
              <li
                key={`${item.level}-${item.page}-${item.title}`}
                style={{ marginLeft: `${item.level * 10}px` }}
              >
                <button
                  className="ghost-btn outline-btn"
                  onClick={() => void safely(() => props.onJumpToOutlinePage(item.page))}
                >
                  <span>{item.title}</span>
                  <small>{item.page}</small>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {!hosted && (
        <section className="recent-section">
          <div className="section-head">
            <h2>Recent papers</h2>
            <button id="refreshRecentBtn" className="ghost-btn" onClick={props.onRefreshRecent}>
              Refresh
            </button>
          </div>
          <ul id="recentList" className="list compact-list">
            {!recentPapers.length && (
              <li className="muted">Your reading history will appear here.</li>
            )}
            {recentPapers.map((recent) => (
              <li key={`${recent.paperRef}:${recent.updatedAt}`} title={recent.pdfUri}>
                <div className="recent-ref">{fileNameOf(recent.pdfUri)}</div>
                <div className="muted recent-meta">Page {recent.lastPage}</div>
                <button
                  className="ghost-btn"
                  onClick={() => void safely(() => props.onLoadRecent(recent))}
                >
                  Load
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <footer className="navigation-footer">
        <div id="statusText" className="session-status" role="status" aria-live="polite">
          {props.status}
        </div>
        <details className="technical-details">
          <summary>Session details</summary>
          <dl>
            <dt>Paper reference</dt>
            <dd id="sessionPaperRef">{paperRef || "—"}</dd>
            <dt>Session</dt>
            <dd id="sessionInfo">{sessionId ?? "—"}</dd>
            <dt>Source</dt>
            <dd>{pdfUri || "No paper open"}</dd>
          </dl>
          {sessionId && (
            <>
              <details className="session-details">
                <summary id="sessionDetailsToggle">Open another paper</summary>
                {form}
              </details>
              <button
                id="closePaperBtn"
                className="danger-btn"
                onClick={() => void safely(props.onCloseSession)}
              >
                Close session
              </button>
            </>
          )}
        </details>
      </footer>
    </aside>
  );
}
