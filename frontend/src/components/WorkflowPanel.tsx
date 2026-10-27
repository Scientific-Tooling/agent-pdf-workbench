import { useEffect, useState } from "react";
import { apiGet, apiPost } from "../services/api";
import type { Annotation, Note } from "../types/types";

interface EvidenceItem {
  kind: "annotation" | "note";
  id: string;
  content: { comment?: string; title?: string; markdown?: string };
  passages: { page: number; quote: string }[];
  review: { status: string };
}
interface Preview {
  id: string;
  counts: { addition: number; unchanged: number; conflict: number };
  items: EvidenceItem[];
  plan: unknown;
  applied: boolean;
}
interface WorkflowStatus {
  enabled: boolean;
  question?: string;
  preview?: Preview | null;
  brief?: { text: string; passage_urls: string[] } | null;
}

export function WorkflowPanel({
  sessionId,
  annotations,
  notes,
}: {
  sessionId: string | null;
  annotations: Annotation[];
  notes: Note[];
}) {
  const [state, setState] = useState<WorkflowStatus | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    if (sessionId) {
      apiGet<WorkflowStatus>(`/api/workflow?session_id=${encodeURIComponent(sessionId)}`)
        .then((value) => {
          if (!active) return;
          setState(value);
          setPreview(value.preview ?? null);
          setSelected(value.preview?.items.map((item) => `${item.kind}:${item.id}`) ?? []);
          setMessage("");
        })
        .catch((error: unknown) => {
          if (active)
            setMessage(error instanceof Error ? error.message : "Could not load workflow");
        });
    }
    return () => {
      active = false;
    };
  }, [sessionId]);

  if (!sessionId || !state?.enabled) return null;

  function toggle(key: string) {
    setSelected((values) =>
      values.includes(key) ? values.filter((value) => value !== key) : [...values, key],
    );
    setPreview(null);
    setMessage("");
  }

  async function run(action: "preview" | "apply" | "brief") {
    setBusy(true);
    setMessage("");
    try {
      const result = await apiPost<{
        preview?: Preview;
        applied?: boolean;
        brief_error?: string;
        result?: unknown;
      }>("/api/workflow", {
        action,
        session_id: sessionId,
        preview_id: preview?.id,
        annotation_ids: selected
          .filter((value) => value.startsWith("annotation:"))
          .map((value) => value.slice("annotation:".length)),
        note_ids: selected
          .filter((value) => value.startsWith("note:"))
          .map((value) => value.slice("note:".length)),
      });
      if (action === "preview") {
        setPreview(result.preview ?? null);
      } else {
        const latest = await apiGet<WorkflowStatus>(
          `/api/workflow?session_id=${encodeURIComponent(sessionId ?? "")}`,
        );
        setState(latest);
        setPreview(latest.preview ?? null);
        setMessage(
          result.brief_error
            ? `Evidence imported. Brief needs attention: ${result.brief_error}`
            : result.applied === false
              ? `Import was not applied. Inspect conflicts and preview again: ${JSON.stringify(result.result)}`
              : action === "apply"
                ? "Evidence imported. Its review status is unchanged. Your brief is ready."
                : "Your brief is ready.",
        );
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Workflow operation failed");
    } finally {
      setBusy(false);
    }
  }

  function downloadBrief() {
    const url = URL.createObjectURL(
      new Blob([state?.brief?.text ?? ""], { type: "text/markdown" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "reading-brief.md";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <details className="card collapsible workflow-card" open>
      <summary>
        <span className="collapsible-arrow">›</span>
        <h2 style={{ margin: 0 }}>Evidence & brief</h2>
      </summary>
      <div className="card-body">
        <p className="workflow-question">{state.question}</p>
        <p className="muted">Choose saved highlights or notes to keep as evidence.</p>
        <fieldset disabled={busy} className="workflow-selection">
          <legend className="sr-only">Evidence selection</legend>
          {annotations.map((item) => (
            <label key={`annotation:${item.id}`}>
              <input
                type="checkbox"
                checked={selected.includes(`annotation:${item.id}`)}
                onChange={() => toggle(`annotation:${item.id}`)}
              />
              <span>
                Page {item.page}: {item.quote || "(no text quote)"}
              </span>
            </label>
          ))}
          {notes.map((item) => (
            <label key={`note:${item.id}`}>
              <input
                type="checkbox"
                checked={selected.includes(`note:${item.id}`)}
                onChange={() => toggle(`note:${item.id}`)}
              />
              <span>Note: {item.title || "Untitled"}</span>
            </label>
          ))}
          {!annotations.length && !notes.length && (
            <p className="muted">Highlight a passage in the PDF to get started.</p>
          )}
        </fieldset>
        <button disabled={busy || !selected.length} onClick={() => void run("preview")}>
          Preview selected evidence
        </button>
        {preview && (
          <section aria-label="Import preview" className="workflow-preview">
            <p>
              {preview.counts.addition} new · {preview.counts.unchanged} unchanged ·{" "}
              {preview.counts.conflict} conflicts
            </p>
            {preview.items.map((item) => (
              <div key={`${item.kind}:${item.id}`}>
                {item.passages.map((passage, index) => (
                  <blockquote key={index}>
                    Page {passage.page}: {passage.quote}
                  </blockquote>
                ))}
                <p>{item.content.comment || item.content.title}</p>
                {item.content.markdown && <pre>{item.content.markdown}</pre>}
                <p className="muted">Review status: {item.review.status}</p>
              </div>
            ))}
            <details>
              <summary>Import details</summary>
              <pre>{JSON.stringify(preview.plan, null, 2)}</pre>
            </details>
            <button
              disabled={busy || preview.counts.conflict > 0 || preview.applied}
              onClick={() => void run("apply")}
            >
              {preview.applied ? "Evidence imported" : "Import evidence & create brief"}
            </button>
            {preview.counts.conflict > 0 && (
              <p className="muted">Resolve the reported conflicts before importing.</p>
            )}
          </section>
        )}
        <p role="status" aria-live="polite">
          {busy ? "Working…" : message}
        </p>
        {(preview?.applied || state.brief) && (
          <button disabled={busy} onClick={() => void run("brief")}>
            Generate brief from imported evidence
          </button>
        )}
        {state.brief && (
          <section aria-label="Reading brief">
            <button onClick={downloadBrief}>Download brief</button>
            {state.brief.passage_urls.map((url, index) => (
              <p key={url}>
                <a href={url}>Open supporting passage {index + 1}</a>
              </p>
            ))}
            <details>
              <summary>Read the brief</summary>
              <pre>{state.brief.text}</pre>
            </details>
          </section>
        )}
      </div>
    </details>
  );
}
