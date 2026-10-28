import { useEffect, useRef, useState } from "react";
import { apiGet, apiPost } from "../services/api";

interface Candidate {
  id: string;
  title: string;
  authors: string[];
  year: string | number | null;
  venue: string | null;
  identifiers: Record<string, string>;
  landing_url: string;
  abstract: string | null;
  pdf_sources: { url: string; source: string }[];
}
interface Discovery {
  id: string;
  query: string;
  provider: string;
  retrieved_at: string;
  status: string;
  error: string | null;
  candidates: Candidate[];
  candidate_changes?: {
    added: string[];
    changed: string[];
    not_returned: string[];
    unchanged: string[];
  };
}
interface Selection {
  request: { id: string; discovery_id: string; candidate_id: string };
  candidate_title?: string;
  status: string;
  paper_key: string | null;
  error: string | null;
}
interface Listing {
  discoveries: Omit<Discovery, "candidates">[];
  selections: Selection[];
  discovery?: Discovery;
}
const safeLink = (url: string) => /^https:\/\/[^/@\s]+\//.test(url);

export function DiscoveryPanel({
  sessionId,
  refresh,
}: {
  sessionId: string;
  refresh: () => Promise<void>;
}) {
  const [data, setData] = useState<Listing>({ discoveries: [], selections: [] });
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState("pubmed");
  const [mode, setMode] = useState("search");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const epoch = useRef(0);
  const working = useRef(false);
  const request = useRef<{ body: string; id: string } | null>(null);
  const endpoint = (id = "") =>
    `/api/workflow/discovery?${new URLSearchParams({ session_id: sessionId, discovery_id: id })}`;
  useEffect(() => {
    const generation = ++epoch.current;
    apiGet<Listing>(`/api/workflow/discovery?session_id=${encodeURIComponent(sessionId)}`)
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
  }, [sessionId]);
  async function perform(action: string, payload: object = {}) {
    if (working.current) return;
    const generation = ++epoch.current;
    working.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (action === "load") {
        const result = await apiGet<Listing>(endpoint((payload as { id?: string }).id));
        if (generation === epoch.current) setData(result);
      } else {
        const body = { action: `discovery_${action}`, session_id: sessionId, ...payload };
        const encoded = JSON.stringify(body);
        if (request.current?.body !== encoded)
          request.current = { body: encoded, id: crypto.randomUUID().replaceAll("-", "") };
        const result = await apiPost<{ discovery?: Discovery; selection?: Selection }>(
          "/api/workflow",
          {
            request_id: request.current.id,
            ...body,
          },
        );
        if (generation !== epoch.current) return;
        const selected = result.selection;
        const id = result.discovery?.id ?? data.discovery?.id;
        const listing = await apiGet<Listing>(endpoint(id));
        if (generation !== epoch.current) return;
        setData(listing);
        if (selected) {
          setMessage(
            selected.status === "added"
              ? `${selected.paper_key}: PDF added. Open it from Project papers.`
              : (selected.error ?? selected.status),
          );
          await refresh();
        }
        request.current = null;
      }
    } catch (caught) {
      if (generation === epoch.current)
        setError(
          caught instanceof Error
            ? caught.message
            : "Discovery failed. Saved requests are available after reload.",
        );
    } finally {
      if (generation === epoch.current) {
        working.current = false;
        setBusy(false);
      }
    }
  }
  const run = data.discovery;
  return (
    <details className="discovery-panel">
      <summary>Discover and add papers</summary>
      <section aria-label="Discover and add papers">
        <p className="muted">
          Find candidates, inspect their sources, then choose what to add. Discovery does not import
          evidence or record a review.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void perform(mode, { query, provider, limit: 10 });
          }}
        >
          <fieldset disabled={busy}>
            <label>
              Find by
              <select
                aria-label="Discovery mode"
                value={mode}
                onChange={(event) => setMode(event.target.value)}
              >
                <option value="search">Research query</option>
                <option value="lookup">DOI or PMID</option>
              </select>
            </label>
            {mode === "search" && (
              <label>
                Provider
                <select
                  aria-label="Discovery provider"
                  value={provider}
                  onChange={(event) => setProvider(event.target.value)}
                >
                  <option value="pubmed">PubMed</option>
                  <option value="crossref">Crossref</option>
                </select>
              </label>
            )}
            <label>
              {mode === "search" ? "Research query" : "DOI or PMID"}
              <input
                aria-label="Discovery query or identifier"
                required
                maxLength={1500}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <button className="primary-btn">Find candidate papers</button>
          </fieldset>
        </form>
        <label>
          Saved discovery
          <select
            aria-label="Saved discovery"
            disabled={busy}
            value={run?.id ?? ""}
            onChange={(event) => void perform("load", { id: event.target.value })}
          >
            <option value="">Choose a saved search</option>
            {data.discoveries.map((item) => (
              <option key={item.id} value={item.id}>
                {item.provider}: {item.query} ({item.status})
              </option>
            ))}
          </select>
        </label>
        <button
          className="secondary-btn"
          disabled={busy}
          onClick={() => void perform("load", { id: run?.id })}
        >
          Reload discoveries
        </button>
        {(busy || message) && (
          <p role="status">{busy ? "Working with selected sources…" : message}</p>
        )}
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        {run && (
          <>
            <p>
              {run.provider}: {run.query}
              <br />
              <small>Retrieved {run.retrieved_at}</small>
            </p>
            {run.error && <p className="notice">{run.error}</p>}
            {run.status === "complete" && (
              <button
                className="secondary-btn"
                disabled={busy}
                onClick={() => void perform("repeat", { discovery_id: run.id })}
              >
                Repeat this saved discovery
              </button>
            )}
            {run.candidate_changes && (
              <p className="notice">
                {run.candidate_changes.added.length} new candidates ·{" "}
                {run.candidate_changes.changed.length} metadata changes ·{" "}
                {run.candidate_changes.not_returned.length} not returned this time. A bounded result
                list does not establish that a paper was removed. Inspect candidates before
                selecting any PDF.
              </p>
            )}
            {run.status === "complete" && !run.candidates.length && (
              <p>No candidates returned. Try a different query.</p>
            )}
            {run.candidates.map((candidate) => (
              <CandidateCard
                key={`${run.id}:${candidate.id}`}
                candidate={candidate}
                busy={busy}
                select={(source) =>
                  perform("select", {
                    discovery_id: run.id,
                    candidate_id: candidate.id,
                    ...(source ? { source } : {}),
                  })
                }
              />
            ))}
          </>
        )}
        {!!data.selections.length && (
          <details>
            <summary>Selected papers and recovery</summary>
            {data.selections.map((selection) => (
              <article key={selection.request.id}>
                <p>
                  {selection.candidate_title ?? selection.request.candidate_id}:{" "}
                  {selection.status.replaceAll("_", " ")}
                  {selection.paper_key ? ` · ${selection.paper_key}` : ""}
                </p>
                {selection.error && <p>{selection.error}</p>}
                {["pending", "downloading", "retained", "failed"].includes(selection.status) && (
                  <button
                    className="secondary-btn"
                    disabled={busy}
                    onClick={() => void perform("retry", { request_id: selection.request.id })}
                  >
                    Retry selected paper
                  </button>
                )}
              </article>
            ))}
          </details>
        )}
      </section>
    </details>
  );
}

function CandidateCard({
  candidate,
  busy,
  select,
}: {
  candidate: Candidate;
  busy: boolean;
  select: (source?: number) => Promise<void>;
}) {
  const [source, setSource] = useState(candidate.pdf_sources.length === 1 ? "1" : "");
  return (
    <article className="discovery-candidate">
      <h3>{candidate.title}</h3>
      <p>
        {candidate.authors.join(", ")}
        <br />
        {candidate.year ?? "Year unknown"} · {candidate.venue}
      </p>
      <p className="muted">
        {Object.entries(candidate.identifiers)
          .map(([key, value]) => `${key}: ${value}`)
          .join(" · ")}
      </p>
      {safeLink(candidate.landing_url) && (
        <a href={candidate.landing_url} target="_blank" rel="noreferrer">
          Open publication record
        </a>
      )}
      {candidate.abstract && (
        <details>
          <summary>Abstract · metadata only</summary>
          <p>{candidate.abstract}</p>
        </details>
      )}
      {candidate.pdf_sources.length ? (
        <label>
          Reported PDF source
          <select
            aria-label={`PDF source for ${candidate.id}`}
            disabled={busy}
            value={source}
            onChange={(event) => setSource(event.target.value)}
          >
            <option value="">Choose a source</option>
            {candidate.pdf_sources.map((item, index) => (
              <option key={item.url} value={String(index + 1)}>
                {index + 1}: {item.url}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="muted">
          No downloadable PDF reported. Keep the reference and supply a local PDF from the CLI when
          available.
        </p>
      )}
      <button
        className="secondary-btn"
        disabled={busy || (!!candidate.pdf_sources.length && !source)}
        onClick={() => void select(source ? Number(source) : undefined)}
      >
        {candidate.pdf_sources.length ? "Add selected PDF" : "Keep reference without PDF"}
      </button>
    </article>
  );
}
