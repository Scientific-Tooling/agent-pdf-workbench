import type { OutlineItem, RecentPaper } from "../types/types";

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
    <aside className="panel controls">
      <div className="app-header">
        <div className="app-logo">📄</div>
        <h1>PDF Workbench</h1>
      </div>

      <section className="card">
        <h2>Session</h2>
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
              {sessionId ?? "—"}
            </span>
          </div>
          <div className="info-chip">
            <span className="info-chip-label">Status</span>
            <span id="statusText" className="info-chip-value">
              {status}
            </span>
          </div>
        </div>
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
            <li key={`${recent.paperRef}:${recent.updatedAt}`}>
              <div style={{ fontWeight: 600 }}>{`${recent.paperRef}`}</div>
              <div className="muted">{`p.${recent.lastPage} · ${recent.pdfUri}`}</div>
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

      <section className="card">
        <h2>Outline</h2>
        <ul id="outlineList" className="list compact-list">
          {outline.length === 0 && <li className="muted">No outline</li>}
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
    </aside>
  );
}
