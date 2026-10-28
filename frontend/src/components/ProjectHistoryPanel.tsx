import { useEffect, useRef, useState } from "react";
import { apiGet, apiPost } from "../services/api";

interface Edition {
  id: string;
  created_at: string;
  text: string;
}
interface Change {
  category: string;
  id: string;
  change: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}
interface Update {
  freshness: "current" | "outdated" | "unverified";
  checked_at: string;
  baseline_id: string | null;
  changes: Change[];
  attention: {
    kind: string;
    id: string;
    paper?: string;
    cell?: string;
    message: string;
    text?: string;
  }[];
  history: {
    editions: Omit<Edition, "text">[];
    pending_briefs: string[];
    legacy_briefs: { path: string; freshness: string }[];
  };
}
function describe(value: Record<string, unknown> | null) {
  if (!value) return "Not present";
  if (typeof value.title === "string") return value.title;
  const record = value.record as
    { item?: { content?: { comment?: string; title?: string; markdown?: string } } } | undefined;
  const content = record?.item?.content;
  if (content)
    return (
      content.comment ||
      [content.title, content.markdown].filter(Boolean).join("\n") ||
      "Saved quotation"
    );
  return String(value.key ?? value.id ?? "Project settings");
}
export function ProjectHistoryPanel({
  sessionId,
  editionId,
  refresh,
}: {
  sessionId: string;
  editionId?: string;
  refresh: () => Promise<void>;
}) {
  const [data, setData] = useState<Update | null>(null);
  const [edition, setEdition] = useState<Edition | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const epoch = useRef(0);
  const working = useRef(false);
  const endpoint = `/api/workflow/maintenance?session_id=${encodeURIComponent(sessionId)}`;
  useEffect(() => {
    const generation = ++epoch.current;
    setBusy(true);
    setData(null);
    setError("");
    setMessage("");
    apiGet<Update>(endpoint)
      .then((result) => {
        if (generation === epoch.current) setData(result);
      })
      .catch((caught: unknown) => {
        if (generation === epoch.current) setError(String(caught));
      })
      .finally(() => {
        if (generation === epoch.current) setBusy(false);
      });
    return () => {
      epoch.current += 1;
    };
  }, [endpoint, editionId]);
  async function perform(action: "check" | "save" | "edition" | "retry", id = "") {
    if (working.current) return;
    const generation = ++epoch.current;
    working.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (action === "edition") {
        const result = await apiGet<Edition>(`${endpoint}&edition_id=${encodeURIComponent(id)}`);
        if (generation === epoch.current) setEdition(result);
      } else {
        if (action === "retry") {
          await apiPost("/api/workflow", {
            action: "brief",
            session_id: sessionId,
            request_id: id,
          });
          if (generation !== epoch.current) return;
          await refresh();
        }
        const result =
          action === "save"
            ? await apiPost<Update>("/api/workflow", {
                action: "project_update",
                session_id: sessionId,
              })
            : await apiGet<Update>(endpoint);
        if (generation === epoch.current) {
          setData(result);
          if (action === "save")
            setMessage("Change report saved. Evidence and review decisions are unchanged.");
        }
      }
    } catch (caught) {
      if (generation === epoch.current) {
        setData(null); // A failed check cannot leave an earlier "current" label visible.
        setError(caught instanceof Error ? caught.message : "Could not check project changes.");
      }
    } finally {
      working.current = false;
      if (generation === epoch.current) setBusy(false);
    }
  }
  function download() {
    if (!edition) return;
    const url = URL.createObjectURL(new Blob([edition.text], { type: "text/markdown" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `brief-${edition.id}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section className="project-history workflow-card" aria-label="Project changes and history">
      <div className="section-intro">
        <span className="eyebrow">Living project</span>
        <h2>What changed since your brief?</h2>
        <p className="muted">
          Check sources, imported evidence and reviews. Earlier editions keep the material that
          supported them.
        </p>
      </div>
      {busy && <p role="status">Checking saved project records…</p>}
      {error && (
        <p role="alert" className="notice error">
          Freshness could not be verified. {error}
        </p>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {data && (
        <>
          <p
            hidden={busy}
            className={`notice ${data.freshness === "outdated" ? "error" : ""}`}
            role="status"
          >
            {data.freshness === "current"
              ? "Brief matches the project at this check."
              : data.freshness === "outdated"
                ? "Your saved brief is outdated. Inspect the changes before creating a new edition."
                : "No verified brief baseline yet. Generate a new edition from imported evidence."}
            <small>
              Checked {new Date(data.checked_at).toLocaleString()}. This checks recorded state, not
              scientific validity.
            </small>
          </p>
          <p>
            {data.changes.length} {data.changes.length === 1 ? "change" : "changes"} ·{" "}
            {data.attention.length} {data.attention.length === 1 ? "item needs" : "items need"}{" "}
            attention
          </p>
          {!!data.attention.length && (
            <details open>
              <summary>Needs attention</summary>
              <ul className="history-items">
                {data.attention.map((item, i) => (
                  <li key={`${item.id}:${item.cell ?? i}`}>
                    <strong>
                      {item.paper ? `${item.paper} · ` : ""}
                      {item.kind}
                    </strong>
                    {item.text && <blockquote>{item.text}</blockquote>}
                    <p>{item.message.replaceAll("_", " ")}</p>
                    <small>{item.id}</small>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {!!data.changes.length && (
            <details>
              <summary>Changes since the last edition</summary>
              <ul className="history-items">
                {data.changes.map((change) => (
                  <li key={`${change.category}:${change.id}`}>
                    <strong>
                      {change.category} · {change.change}
                    </strong>
                    <p>{describe(change.after ?? change.before)}</p>
                    {change.change === "changed" && (
                      <p className="muted">Earlier: {describe(change.before)}</p>
                    )}
                    <details className="technical-details">
                      <summary>Exact saved changes</summary>
                      <pre>
                        {JSON.stringify({ before: change.before, after: change.after }, null, 2)}
                      </pre>
                    </details>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <details>
            <summary>Earlier brief editions ({data.history.editions.length})</summary>
            <label>
              Saved edition
              <select
                aria-label="Saved brief edition"
                value={edition?.id ?? ""}
                disabled={busy}
                onChange={(event) => {
                  if (event.target.value) void perform("edition", event.target.value);
                }}
              >
                <option value="">Choose an edition</option>
                {data.history.editions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {new Date(item.created_at).toLocaleString()} · {item.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
            {edition && (
              <>
                <p className="muted">
                  Retained edition from {new Date(edition.created_at).toLocaleString()}. Source
                  links may need repair if the originals changed.
                </p>
                <button className="secondary-btn" onClick={download}>
                  Download this edition
                </button>
                <pre className="history-text">{edition.text}</pre>
              </>
            )}
            {!!data.history.legacy_briefs.length && (
              <p>
                {data.history.legacy_briefs.length} earlier files remain in the workspace. Their
                inputs were not captured, so freshness is unverified.
              </p>
            )}
          </details>
          {data.history.pending_briefs.map((id) => (
            <p key={id}>
              Interrupted brief: {id.slice(0, 8)}{" "}
              <button
                className="secondary-btn"
                disabled={busy}
                onClick={() => void perform("retry", id)}
              >
                Resume this brief
              </button>
            </p>
          ))}
        </>
      )}
      <div className="row">
        <button className="secondary-btn" disabled={busy} onClick={() => void perform("check")}>
          Check changes
        </button>
        <button className="secondary-btn" disabled={busy} onClick={() => void perform("save")}>
          Save change report
        </button>
      </div>
    </section>
  );
}
