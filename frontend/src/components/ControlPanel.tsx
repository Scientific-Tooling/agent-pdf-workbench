import type { OutlineItem, RecentPaper } from "../types/types";
import { fileNameOf } from "../utils/main-utils";

interface ControlPanelProps {
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
  const {
    paperRef,
    pdfUri,
    sessionId,
    status,
    recentPapers,
    outline,
    onPaperRefChange,
    onPdfUriChange,
    onOpenPaper,
    onCloseSession,
    onRefreshRecent,
    onLoadRecent,
    onJumpToOutlinePage,
    onError,
  } = props;

  return (
    <aside className="panel controls" aria-label="Session and navigation">
      <div className="app-header">
        <div className="app-logo">📄</div>
        <h1>PDF Workbench</h1>
      </div>

      <section className="card session-card">
        {sessionId ? (
          <div className="session-summary">
            <div className="session-summary-main">
              <span className="status-dot" aria-hidden="true" />
              <span id="sessionPaperRef" className="session-paper-ref" title={pdfUri}>
                {paperRef}
              </span>
              <button
                id="closePaperBtn"
                className="ghost-btn danger-btn session-close-btn"
                title="Close this reading session"
                onClick={async () => {
                  try {
                    await onCloseSession();
                  } catch (error) {
                    onError(error, "Failed to close session");
                  }
                }}
              >
                Close
              </button>
            </div>
            <div id="statusText" className="session-status" role="status" aria-live="polite">
              {status}
            </div>
            <details className="session-details">
              <summary id="sessionDetailsToggle">Change paper</summary>
              <div className="session-form">
                <label>
                  Paper Ref
                  <input
                    id="paperRef"
                    value={paperRef}
                    onChange={(event) => onPaperRefChange(event.target.value)}
                  />
                </label>
                <label>
                  PDF URI (local path or URL)
                  <input
                    id="pdfUri"
                    value={pdfUri}
                    onChange={(event) => onPdfUriChange(event.target.value)}
                  />
                </label>
                <div className="row">
                  <button
                    id="openPaperBtn"
                    onClick={async () => {
                      try {
                        await onOpenPaper();
                      } catch (error) {
                        onError(error, "Failed to open paper");
                      }
                    }}
                  >
                    Open Paper
                  </button>
                </div>
                <div className="session-id" title="Session id (for agent tools)">
                  <span className="session-id-label">Session</span>
                  <span id="sessionInfo" className="session-id-value">
                    {sessionId}
                  </span>
                </div>
              </div>
            </details>
          </div>
        ) : (
          <>
            <h2>Open a paper</h2>
            <label>
              Paper Ref
              <input
                id="paperRef"
                value={paperRef}
                onChange={(event) => onPaperRefChange(event.target.value)}
              />
            </label>
            <label>
              PDF URI (local path or URL)
              <input
                id="pdfUri"
                value={pdfUri}
                onChange={(event) => onPdfUriChange(event.target.value)}
              />
            </label>
            <div className="row">
              <button
                id="openPaperBtn"
                onClick={async () => {
                  try {
                    await onOpenPaper();
                  } catch (error) {
                    onError(error, "Failed to open paper");
                  }
                }}
              >
                Open Paper
              </button>
              <button
                id="closePaperBtn"
                className="danger-btn"
                disabled
                title="No session to close"
                onClick={async () => {
                  try {
                    await onCloseSession();
                  } catch (error) {
                    onError(error, "Failed to close session");
                  }
                }}
              >
                Close Session
              </button>
            </div>
            <div className="info-row">
              <div className="info-chip">
                <span className="info-chip-label">ID</span>
                <span id="sessionInfo" className="info-chip-value">
                  —
                </span>
              </div>
              <div className="info-chip">
                <span className="info-chip-label">Status</span>
                <span id="statusText" className="info-chip-value" role="status" aria-live="polite">
                  {status}
                </span>
              </div>
            </div>
          </>
        )}
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Recent Papers</h2>
          <button id="refreshRecentBtn" className="ghost-btn" onClick={() => onRefreshRecent()}>
            Refresh
          </button>
        </div>
        <ul id="recentList" className="list compact-list">
          {recentPapers.length === 0 && <li className="muted">No recent papers</li>}
          {recentPapers.map((recent) => (
            <li key={`${recent.paperRef}:${recent.updatedAt}`} title={recent.pdfUri}>
              <div className="recent-ref">{recent.paperRef}</div>
              <div className="muted recent-meta">
                {`p.${recent.lastPage} · ${fileNameOf(recent.pdfUri)}`}
              </div>
              <button
                className="ghost-btn"
                onClick={async () => {
                  try {
                    await onLoadRecent(recent);
                  } catch (error) {
                    onError(error, "Failed to load recent paper");
                  }
                }}
              >
                Load
              </button>
            </li>
          ))}
        </ul>
      </section>

      {outline.length > 0 && (
        <section className="card">
          <h2>Outline</h2>
          <ul id="outlineList" className="list compact-list">
            {outline.map((item) => (
              <li
                key={`${item.level}-${item.page}-${item.title}`}
                style={{ marginLeft: `${item.level * 10}px` }}
              >
                <button
                  className="ghost-btn outline-btn"
                  onClick={async () => {
                    try {
                      await onJumpToOutlinePage(item.page);
                    } catch (error) {
                      onError(error, "Failed to jump to outline page");
                    }
                  }}
                >
                  <span
                    className="muted"
                    style={{ fontSize: "0.72rem", flexShrink: 0 }}
                  >{`p.${item.page}`}</span>
                  {item.title}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}
