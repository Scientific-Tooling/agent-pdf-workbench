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
  onLoadRecent: (paper: RecentPaper) => void;
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
      <h1>Agent PDF Workbench</h1>

      <section className="card">
        <h2>Session</h2>
        <label>
          Paper Ref
          <input id="paperRef" value={paperRef} onChange={(event) => onPaperRefChange(event.target.value)} />
        </label>
        <label>
          PDF URI (local path or URL)
          <input id="pdfUri" value={pdfUri} onChange={(event) => onPdfUriChange(event.target.value)} />
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
        <p id="sessionInfo">Session: {sessionId ?? "-"}</p>
        <p id="statusText">Status: {status}</p>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Recent Papers</h2>
          <button id="refreshRecentBtn" onClick={() => onRefreshRecent()}>
            Refresh
          </button>
        </div>
        <ul id="recentList" className="list compact-list">
          {recentPapers.length === 0 && <li className="muted">No recent papers</li>}
          {recentPapers.map((recent) => (
            <li key={`${recent.paperRef}:${recent.updatedAt}`}>
              <div>{`${recent.paperRef} (p.${recent.lastPage})`}</div>
              <div className="muted">{recent.pdfUri}</div>
              <button onClick={() => onLoadRecent(recent)}>Load</button>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>Outline</h2>
        <ul id="outlineList" className="list compact-list">
          {outline.length === 0 && <li className="muted">No outline</li>}
          {outline.map((item) => (
            <li key={`${item.level}-${item.page}-${item.title}`} style={{ marginLeft: `${item.level * 12}px` }}>
              <button
                onClick={async () => {
                  try {
                    await onJumpToOutlinePage(item.page);
                  } catch (error) {
                    onError(error, "Failed to jump to outline page");
                  }
                }}
              >
                {`p.${item.page} ${item.title}`}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
