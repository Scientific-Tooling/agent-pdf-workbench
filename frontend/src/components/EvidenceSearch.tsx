import { useEffect, useId, useRef, useState } from "react";
import { apiGet } from "../services/api";

interface SearchResult {
  query: string;
  total: number;
  offset: number;
  limit: number;
  has_more: boolean;
  outcome: string;
  pending_papers: string[];
  unavailable_evidence: { note_id: string; reason: string }[];
  results: {
    source_key: string;
    note_id: string;
    revision: string;
    paper: { key: string; title: string };
    record: {
      document: { sha256: string };
      item: { review: { status: string } };
    };
    matches: { role: string; field: string; text: string; page?: number }[];
    passages: { annotation_id: string; page: number; url: string | null; message: string }[];
  }[];
}

/** Mounted per reading session; stale requests cannot populate a different paper or filter. */
export function EvidenceSearch({
  sessionId,
  papers,
}: {
  sessionId: string;
  papers: { key: string; title: string }[];
}) {
  const labelId = useId();
  const [query, setQuery] = useState("");
  const [paper, setPaper] = useState("");
  const [review, setReview] = useState("all");
  const [mode, setMode] = useState("lexical");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const pending = useRef(false);
  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );

  function invalidate() {
    generation.current += 1;
    pending.current = false;
    setResult(null);
    setError("");
    setBusy(false);
  }

  async function search(offset = 0) {
    if (pending.current || !query.trim()) return;
    pending.current = true;
    const epoch = ++generation.current;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const params = new URLSearchParams({
        session_id: sessionId,
        q: query,
        paper,
        review,
        mode,
        offset: String(offset),
      });
      const response = await apiGet<SearchResult>(`/api/workflow/search?${params}`);
      if (generation.current === epoch) setResult(response);
    } catch (caught) {
      if (generation.current === epoch)
        setError(caught instanceof Error ? caught.message : "Evidence search failed. Try again.");
    } finally {
      if (generation.current === epoch) {
        pending.current = false;
        setBusy(false);
      }
    }
  }

  return (
    <section className="evidence-search" aria-label="Find project evidence">
      <h3>Find project evidence</h3>
      <p className="muted">Search imported quotations and commentary across your papers.</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <label>
          Search imported evidence
          <input
            type="search"
            value={query}
            maxLength={2000}
            placeholder="Find a method, result or limitation"
            onChange={(event) => {
              invalidate();
              setQuery(event.target.value);
            }}
          />
        </label>
        <div className="evidence-search-filters">
          <label>
            <span id={`${labelId}-paper`}>Paper</span>
            <select
              aria-labelledby={`${labelId}-paper`}
              value={paper}
              onChange={(event) => {
                invalidate();
                setPaper(event.target.value);
              }}
            >
              <option value="">All project papers</option>
              {papers.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.key}: {item.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span id={`${labelId}-review`}>Review status</span>
            <select
              aria-labelledby={`${labelId}-review`}
              value={review}
              onChange={(event) => {
                invalidate();
                setReview(event.target.value);
              }}
            >
              <option value="all">Any review status</option>
              <option value="unreviewed">Unreviewed</option>
              <option value="reviewed">Reviewed</option>
            </select>
          </label>
          <label>
            <span id={`${labelId}-mode`}>Match</span>
            <select
              aria-labelledby={`${labelId}-mode`}
              value={mode}
              onChange={(event) => {
                invalidate();
                setMode(event.target.value);
              }}
            >
              <option value="lexical">Any search word</option>
              <option value="phrase">Exact phrase</option>
            </select>
          </label>
        </div>
        <button className="secondary-btn full-width" disabled={busy || !query.trim()}>
          {busy ? "Searching…" : "Search evidence"}
        </button>
      </form>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {result && (
        <>
          <p role="status" className="muted">
            {result.total
              ? `${result.total} evidence matches`
              : "No imported evidence matches this search."}{" "}
            Unimported highlights and full paper text are outside this search.
          </p>
          {result.pending_papers.length > 0 && (
            <p className="notice">
              Papers still being prepared: {result.pending_papers.join(", ")}
            </p>
          )}
          {result.unavailable_evidence.length > 0 && (
            <details className="technical-details">
              <summary>{result.unavailable_evidence.length} imports need attention</summary>
              <p>
                Some imported notes were changed or removed in RKS. Inspect them before searching
                their evidence.
              </p>
              <pre>{JSON.stringify(result.unavailable_evidence, null, 2)}</pre>
            </details>
          )}
          {result.results.map((entry) => (
            <article className="preview-item" key={entry.source_key}>
              <h4>
                {entry.paper.key}: {entry.paper.title}
              </h4>
              <span className="status-badge">Review: {entry.record.item.review.status}</span>
              {entry.matches.map((match, index) => (
                <div key={index}>
                  <small>
                    {match.role === "source"
                      ? `Source quotation · page ${match.page}`
                      : "Commentary"}
                  </small>
                  {match.role === "source" ? (
                    <blockquote>{match.text}</blockquote>
                  ) : (
                    <p className="evidence-commentary">{match.text}</p>
                  )}
                </div>
              ))}
              {entry.passages.map((passage, index) => (
                <p key={`${passage.annotation_id}:${index}`}>
                  {passage.url ? (
                    <a href={passage.url}>Open supporting passage · page {passage.page}</a>
                  ) : (
                    <span className="notice">
                      Page {passage.page} unavailable: {passage.message}
                    </span>
                  )}
                </p>
              ))}
              {!entry.passages.length && (
                <p className="muted">No supporting passage is linked to this note.</p>
              )}
              <details className="technical-details">
                <summary>Evidence identity and source revision</summary>
                <dl>
                  <dt>RKS note</dt>
                  <dd>{entry.note_id}</dd>
                  <dt>Evidence revision</dt>
                  <dd>{entry.revision}</dd>
                  <dt>PDF SHA-256</dt>
                  <dd>{entry.record.document.sha256}</dd>
                  <dt>External identity</dt>
                  <dd>{entry.source_key}</dd>
                </dl>
              </details>
            </article>
          ))}
          <div className="selection-actions">
            {result.offset > 0 && (
              <button
                className="secondary-btn"
                onClick={() => void search(Math.max(0, result.offset - result.limit))}
              >
                Previous matches
              </button>
            )}
            {result.has_more && (
              <button
                className="secondary-btn"
                onClick={() => void search(result.offset + result.limit)}
              >
                Next matches
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
