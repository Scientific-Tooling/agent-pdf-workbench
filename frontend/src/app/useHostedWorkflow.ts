import { useEffect, useRef, useState } from "react";
import { apiGet, apiPost } from "../services/api";

export interface EvidenceItem {
  kind: "annotation" | "note";
  id: string;
  content: { comment?: string; title?: string; markdown?: string };
  passages: { page: number; quote: string }[];
  review: { status: string };
}
export interface Preview {
  id: string;
  counts: { addition: number; unchanged: number; conflict: number };
  items: EvidenceItem[];
  plan: unknown;
  applied: boolean;
}
export interface WorkflowStatus {
  enabled: boolean;
  capabilities?: { evidence_search?: boolean; comparisons?: boolean };
  question?: string;
  title?: string;
  papers?: {
    key: string;
    title: string;
    phase: string;
    session_id: string | null;
    viewer_url: string | null;
  }[];
  preview?: Preview | null;
  brief?: {
    text: string;
    passage_urls: string[];
    counts?: { evidence: number; unreviewed: number };
    paper_count?: number;
  } | null;
}
interface State {
  sessionId: string | null;
  data: WorkflowStatus | null;
  selected: string[];
  preview: Preview | null;
  busy: boolean;
  message: string;
  error: boolean;
  operationDetails: unknown;
}
const empty = (sessionId: string | null): State => ({
  sessionId,
  data: null,
  selected: [],
  preview: null,
  busy: false,
  message: "",
  error: false,
  operationDetails: null,
});
const getStatus = (sessionId: string) =>
  apiGet<WorkflowStatus>(`/api/workflow?session_id=${encodeURIComponent(sessionId)}`);
const restored = (sessionId: string, data: WorkflowStatus): State => ({
  ...empty(sessionId),
  data,
  preview: data.preview ?? null,
  selected: data.preview?.items.map((item) => `${item.kind}:${item.id}`) ?? [],
});

/** One session-bound model shared by project navigation, evidence and brief views. */
export function useHostedWorkflow(sessionId: string | null) {
  const [state, setState] = useState<State>(() => empty(sessionId));
  const generation = useRef<symbol | null>(null);
  const working = useRef(false);
  const current = state.sessionId === sessionId ? state : empty(sessionId);

  useEffect(() => {
    const epoch = Symbol();
    generation.current = epoch;
    working.current = false;
    if (sessionId) {
      getStatus(sessionId)
        .then((data) => {
          if (generation.current === epoch) setState(restored(sessionId, data));
        })
        .catch((error: unknown) => {
          if (generation.current === epoch)
            setState({
              ...empty(sessionId),
              error: true,
              message:
                error instanceof Error ? error.message : "Could not load project. Try refreshing.",
            });
        });
    }
    return () => {
      generation.current = null;
    };
  }, [sessionId]);

  async function refresh() {
    if (!sessionId || working.current) return;
    const epoch = Symbol();
    generation.current = epoch;
    working.current = true;
    setState({ ...current, busy: true });
    try {
      const data = await getStatus(sessionId);
      if (generation.current === epoch) setState(restored(sessionId, data));
    } catch (error) {
      if (generation.current === epoch)
        setState({
          ...current,
          busy: false,
          error: true,
          message: error instanceof Error ? error.message : "Could not refresh project.",
        });
    } finally {
      if (generation.current === epoch) working.current = false;
    }
  }

  async function run(action: "preview" | "apply" | "brief") {
    if (!sessionId || !current.data?.enabled || working.current) return;
    const epoch = Symbol();
    generation.current = epoch;
    working.current = true;
    setState({ ...current, busy: true, message: "", error: false, operationDetails: null });
    try {
      const result = await apiPost<{
        preview?: Preview;
        applied?: boolean;
        brief_error?: string;
        result?: unknown;
      }>("/api/workflow", {
        action,
        session_id: sessionId,
        preview_id: current.preview?.id,
        annotation_ids: current.selected
          .filter((key) => key.startsWith("annotation:"))
          .map((key) => key.slice(11)),
        note_ids: current.selected
          .filter((key) => key.startsWith("note:"))
          .map((key) => key.slice(5)),
      });
      if (action === "preview") {
        if (generation.current === epoch)
          setState({ ...current, preview: result.preview ?? null, message: "", error: false });
      } else {
        const data = await getStatus(sessionId);
        if (generation.current === epoch)
          setState({
            ...restored(sessionId, data),
            error: !!result.brief_error || result.applied === false,
            operationDetails: result.applied === false ? result.result : null,
            message: result.brief_error
              ? `Evidence imported. Brief needs attention: ${result.brief_error}`
              : result.applied === false
                ? "Import was not applied. Inspect the conflict details and preview again."
                : action === "apply"
                  ? "Evidence imported. Review status is unchanged."
                  : "Project brief updated.",
          });
      }
    } catch (error) {
      if (generation.current === epoch)
        setState({
          ...current,
          error: true,
          message: error instanceof Error ? error.message : "Workflow operation failed.",
        });
    } finally {
      if (generation.current === epoch) working.current = false;
    }
  }

  function toggle(key: string) {
    if (current.busy) return;
    setState({
      ...current,
      selected: current.selected.includes(key)
        ? current.selected.filter((value) => value !== key)
        : [...current.selected, key],
      preview: null,
      message: "",
      error: false,
      operationDetails: null,
    });
  }
  return { ...current, refresh, run, toggle };
}
export type HostedWorkflow = ReturnType<typeof useHostedWorkflow>;
