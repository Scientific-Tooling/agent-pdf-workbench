import { useEffect, useRef, useState } from "react";
import { apiGet, apiPost } from "../services/api";

interface Evidence {
  note_id: string;
  revision: string;
  status: string;
  source_status: string;
  paper?: { key: string; title: string };
  record: {
    item: {
      content: { comment?: string; title?: string; markdown?: string };
      review: { status: string };
      passages: { page: number; quote: string }[];
    };
  };
  passages?: { page: number; quote: string; url: string | null; message: string }[];
}
interface Review {
  id: string;
  reviewer: string;
  reviewed_at: string;
  scope: string;
  decision: string;
  statement: string;
}
interface Cell {
  key: string;
  criterion_id: string;
  paper_source: string;
  paper: { key: string; title: string };
  text: string;
  conditions: string;
  origin: string;
  support_status: string;
  evidence: Evidence[];
  review: { status: string; latest: Review | null; history: Review[] };
}
interface Comparison {
  id: string;
  revision: string;
  title: string;
  question: string;
  criteria: { id: string; label: string }[];
  papers: { key: string; title: string; paper_source: string }[];
  cells: Cell[];
  excluded_papers: string[];
  markdown: string;
}
interface Data {
  comparisons: { id: string; title: string }[];
  comparison?: Comparison;
  evidence?: Evidence[];
}
type Run = (action: string, payload: object) => Promise<void>;
const label = (value: string) => value.replaceAll("_", " ");

export function ComparisonPanel({ sessionId }: { sessionId: string }) {
  const [data, setData] = useState<Data>({ comparisons: [] });
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [criteria, setCriteria] = useState("");
  const [selectedCell, setSelectedCell] = useState("");
  const epoch = useRef(0);
  const working = useRef(false);
  const savedRequest = useRef<{ body: string; id: string } | null>(null);
  const endpoint = (id = "") =>
    `/api/workflow/comparisons?${new URLSearchParams({ session_id: sessionId, comparison_id: id })}`;
  useEffect(() => {
    const generation = ++epoch.current;
    apiGet<Data>(`/api/workflow/comparisons?session_id=${encodeURIComponent(sessionId)}`)
      .then((value) => {
        if (epoch.current === generation) setData(value);
      })
      .catch((caught: unknown) => {
        if (epoch.current === generation)
          setError(caught instanceof Error ? caught.message : "Could not load comparisons.");
      })
      .finally(() => {
        if (epoch.current === generation) setBusy(false);
      });
    return () => {
      epoch.current += 1;
    };
  }, [sessionId]);

  async function load(id = "") {
    if (working.current) return;
    const generation = ++epoch.current;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await apiGet<Data>(endpoint(id));
      if (generation === epoch.current) {
        setData(result);
        setSelectedCell("");
      }
    } catch (caught) {
      if (generation === epoch.current)
        setError(caught instanceof Error ? caught.message : "Could not load comparison.");
    } finally {
      if (generation === epoch.current) {
        working.current = false;
        setBusy(false);
      }
    }
  }
  async function run(action: string, payload: object) {
    if (working.current) return;
    const generation = ++epoch.current;
    working.current = true;
    setBusy(true);
    setError("");
    const body = {
      action: `comparison_${action}`,
      session_id: sessionId,
      payload,
      comparison_id: action === "create" ? null : data.comparison?.id,
      expected_revision: action === "create" ? null : data.comparison?.revision,
    };
    const encoded = JSON.stringify(body);
    if (savedRequest.current?.body !== encoded)
      savedRequest.current = { body: encoded, id: crypto.randomUUID().replaceAll("-", "") };
    try {
      const result = await apiPost<{ comparison: Comparison }>("/api/workflow", {
        ...body,
        request_id: savedRequest.current.id,
      });
      const refreshed = await apiGet<Data>(endpoint(result.comparison.id));
      if (generation === epoch.current) {
        setData(refreshed);
        savedRequest.current = null;
      }
    } catch (caught) {
      if (generation === epoch.current)
        setError(
          caught instanceof Error
            ? caught.message
            : "Comparison operation failed. Reload before editing a changed comparison.",
        );
    } finally {
      if (generation === epoch.current) {
        working.current = false;
        setBusy(false);
      }
    }
  }
  const comparison = data.comparison;
  const cell =
    comparison?.cells.find((value) => value.key === selectedCell) ?? comparison?.cells[0];
  function download() {
    if (!comparison) return;
    const url = URL.createObjectURL(new Blob([comparison.markdown], { type: "text/markdown" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "comparison.md";
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section className="comparison-panel" aria-label="Compare and review findings">
      <h3>Compare and review findings</h3>
      <p className="muted">
        Keep interpretations, experimental conditions and supporting quotations together. Missing
        information stays visible.
      </p>
      <label>
        Saved comparison
        <select
          aria-label="Saved comparison"
          value={comparison?.id ?? ""}
          disabled={busy}
          onChange={(e) => void load(e.target.value)}
        >
          <option value="">Choose a comparison</option>
          {data.comparisons.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </select>
      </label>
      <button className="secondary-btn" disabled={busy} onClick={() => void load(comparison?.id)}>
        Reload comparisons
      </button>
      <details className="comparison-create" open={!comparison && !data.comparisons.length}>
        <summary>New comparison</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run("create", {
              title,
              criteria: criteria
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean),
            });
          }}
        >
          <label>
            Comparison title
            <input required value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label>
            Criteria, one per line
            <textarea
              required
              value={criteria}
              placeholder={"Dataset\nMethod assumptions\nLimitations"}
              onChange={(e) => setCriteria(e.target.value)}
            />
          </label>
          <button className="primary-btn" disabled={busy}>
            Create comparison
          </button>
        </form>
      </details>
      {busy && <p role="status">Loading comparison…</p>}
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {comparison && (
        <>
          <h3>{comparison.title}</h3>
          <p className="muted">{comparison.question}</p>
          <div
            className="comparison-table"
            tabIndex={0}
            role="region"
            aria-label="Comparison matrix"
          >
            <table>
              <caption>Interpretations by criterion and paper</caption>
              <thead>
                <tr>
                  <th scope="col">Criterion</th>
                  {comparison.papers.map((paper) => (
                    <th scope="col" key={paper.key}>
                      {paper.key}: {paper.title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {comparison.criteria.map((criterion) => (
                  <tr key={criterion.id}>
                    <th scope="row">{criterion.label}</th>
                    {comparison.papers.map((paper) => {
                      const item = comparison.cells.find(
                        (value) =>
                          value.criterion_id === criterion.id &&
                          value.paper_source === paper.paper_source,
                      )!;
                      return (
                        <td key={paper.key}>
                          <p>{item.text || "Missing information"}</p>
                          <p className="muted">
                            Origin: {item.origin}
                            <br />
                            Conditions: {item.conditions || "Not recorded"}
                          </p>
                          <p>
                            Support: {label(item.support_status)}
                            <br />
                            Review: {label(item.review.status)}
                          </p>
                          <button
                            className="secondary-btn"
                            disabled={busy}
                            onClick={() => setSelectedCell(item.key)}
                            aria-label={`Inspect ${paper.key} ${criterion.label}`}
                          >
                            Inspect / edit
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!!comparison.excluded_papers.length && (
            <p className="notice">
              Papers added after this comparison: {comparison.excluded_papers.join(", ")}. Create a
              new comparison to include them.
            </p>
          )}
          {cell && (
            <CellEditor
              key={`${comparison.id}:${comparison.revision}:${cell.key}`}
              cell={cell}
              criterion={comparison.criteria.find((c) => c.id === cell.criterion_id)!.label}
              options={(data.evidence ?? []).filter((e) => e.paper?.key === cell.paper.key)}
              busy={busy}
              run={run}
            />
          )}
          <button className="secondary-btn full-width" onClick={download}>
            Download comparison
          </button>
          <details className="technical-details">
            <summary>Comparison identity and revision</summary>
            <p>{comparison.id}</p>
            <p>{comparison.revision}</p>
          </details>
        </>
      )}
    </section>
  );
}

function CellEditor({
  cell,
  criterion,
  options,
  busy,
  run,
}: {
  cell: Cell;
  criterion: string;
  options: Evidence[];
  busy: boolean;
  run: Run;
}) {
  const [text, setText] = useState(cell.text);
  const [conditions, setConditions] = useState(cell.conditions);
  const [origin, setOrigin] = useState(cell.origin === "agent" ? "agent" : "human");
  const [selected, setSelected] = useState(cell.evidence.map((e) => `${e.note_id}@${e.revision}`));
  const [reviewer, setReviewer] = useState("");
  const [scope, setScope] = useState("");
  const [statement, setStatement] = useState("");
  const [decision, setDecision] = useState("needs_changes");
  const [confirmed, setConfirmed] = useState(false);
  const target = { paper: cell.paper.key, criterion_id: cell.criterion_id };
  const dirty =
    text !== cell.text ||
    conditions !== cell.conditions ||
    (cell.origin !== "unspecified" && origin !== cell.origin) ||
    JSON.stringify([...selected].sort()) !==
      JSON.stringify(cell.evidence.map((e) => `${e.note_id}@${e.revision}`).sort());
  return (
    <section className="comparison-cell" aria-label="Selected comparison entry">
      <h4>
        {cell.paper.key}: {criterion}
      </h4>
      <p>
        Interpretation origin: {cell.origin}. Support: {label(cell.support_status)}. Review:{" "}
        {label(cell.review.status)}.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run("set", {
            ...target,
            text,
            conditions,
            origin,
            evidence: selected.map((value) => {
              const [note_id, revision] = value.split("@");
              return { note_id, revision };
            }),
          });
        }}
      >
        <fieldset disabled={busy}>
          <label>
            Interpretation
            <textarea
              aria-label="Interpretation"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <label>
            Experimental conditions
            <textarea
              aria-label="Experimental conditions"
              value={conditions}
              onChange={(e) => setConditions(e.target.value)}
              placeholder="Dataset, population, metric, units, assumptions—or state what is unknown."
            />
          </label>
          <label>
            Interpretation origin
            <select
              aria-label="Interpretation origin"
              value={origin}
              onChange={(e) => setOrigin(e.target.value)}
            >
              <option value="human">Human-written interpretation</option>
              <option value="agent">Agent-proposed interpretation</option>
            </select>
          </label>
          <p>Choose imported evidence for this paper:</p>
          {!options.length && (
            <p className="muted">
              No imported evidence. Save an unsupported draft or import selected passages first.
            </p>
          )}
          {selected
            .filter((key) => !options.some((e) => `${e.note_id}@${e.revision}` === key))
            .map((key) => (
              <label className="comparison-evidence-choice" key={key}>
                <input
                  type="checkbox"
                  checked
                  onChange={() => setSelected(selected.filter((value) => value !== key))}
                />
                <span>
                  Previously selected evidence changed or disappeared. Uncheck to remove this old
                  selection: {key.split("@")[0]}
                </span>
              </label>
            ))}
          {options.map((evidence) => {
            const key = `${evidence.note_id}@${evidence.revision}`;
            const item = evidence.record.item;
            return (
              <label className="comparison-evidence-choice" key={key}>
                <input
                  type="checkbox"
                  checked={selected.includes(key)}
                  onChange={() =>
                    setSelected(
                      selected.includes(key)
                        ? selected.filter((v) => v !== key)
                        : [...selected, key],
                    )
                  }
                />
                <span>
                  {item.passages.map((p) => `Page ${p.page}: ${p.quote}`).join(" · ") ||
                    item.content.title ||
                    item.content.markdown ||
                    "Unlinked note"}
                  <small>
                    Imported review: {item.review.status} · {label(evidence.status)} ·{" "}
                    {label(evidence.source_status)}
                  </small>
                </span>
              </label>
            );
          })}
          <button className="primary-btn">Save interpretation</button>
        </fieldset>
      </form>
      <section aria-label="Selected supporting evidence">
        <h4>Recorded supporting evidence</h4>
        {!cell.evidence.length && (
          <p className="muted">
            No evidence selected. This entry remains a gap or unsupported interpretation.
          </p>
        )}
        {cell.evidence.map((evidence) => (
          <article className="preview-item" key={`${evidence.note_id}:${evidence.revision}`}>
            <p>
              Imported review: {evidence.record.item.review.status} · {label(evidence.status)}
            </p>
            {(evidence.passages ?? []).map((passage, index) => (
              <div key={index}>
                <small>Source quotation · page {passage.page}</small>
                <blockquote>{passage.quote}</blockquote>
                {passage.url ? (
                  <a href={passage.url}>Open comparison source · page {passage.page}</a>
                ) : (
                  <p className="notice">{passage.message}</p>
                )}
              </div>
            ))}
            <p className="muted">
              Imported commentary:{" "}
              {evidence.record.item.content.comment ||
                evidence.record.item.content.markdown ||
                evidence.record.item.content.title ||
                "None"}
            </p>
            <details className="technical-details">
              <summary>Selected evidence revision</summary>
              <p>{evidence.note_id}</p>
              <p>{evidence.revision}</p>
            </details>
          </article>
        ))}
      </section>
      <details className="comparison-review">
        <summary>Record human review</summary>
        <p>
          Review this saved interpretation, its conditions and the exact selected evidence. A
          decision does not change the imported evidence's review status.
        </p>
        {dirty && <p className="notice">Save interpretation changes before recording a review.</p>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (confirmed && !dirty)
              void run("review", { ...target, reviewer, scope, statement, decision });
          }}
        >
          <fieldset disabled={busy || dirty}>
            <label>
              Reviewer
              <input required value={reviewer} onChange={(e) => setReviewer(e.target.value)} />
            </label>
            <label>
              Review scope
              <input
                required
                value={scope}
                placeholder="For example: numerical values, conditions and negation"
                onChange={(e) => setScope(e.target.value)}
              />
            </label>
            <label>
              Review statement
              <textarea required value={statement} onChange={(e) => setStatement(e.target.value)} />
            </label>
            <label>
              Decision
              <select
                aria-label="Review decision"
                value={decision}
                onChange={(e) => setDecision(e.target.value)}
              >
                <option value="needs_changes">Needs changes</option>
                <option value="accepted" disabled={cell.support_status !== "linked"}>
                  Accept within the stated scope
                </option>
              </select>
            </label>
            <label className="comparison-evidence-choice">
              <input
                type="checkbox"
                required
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              <span>I performed this review and am recording my decision.</span>
            </label>
            <button className="primary-btn" disabled={!confirmed}>
              Record review decision
            </button>
          </fieldset>
        </form>
      </details>
      {!!cell.review.history.length && (
        <details className="comparison-review">
          <summary>Review history · {label(cell.review.status)}</summary>
          {cell.review.history.map((review) => (
            <article key={review.id}>
              <p>
                {review.reviewer} · {review.reviewed_at} · {label(review.decision)}
              </p>
              <p>Scope: {review.scope}</p>
              <p>{review.statement}</p>
            </article>
          ))}
        </details>
      )}
    </section>
  );
}
