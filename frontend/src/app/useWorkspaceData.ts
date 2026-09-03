import { useRef, useState } from "react";
import type { MutableRefObject } from "react";

import { useSyncedRef } from "../hooks/useSyncedRef";
import { asAnnotationRecord, asNoteRecord } from "../pdf/main-parsers";
import { apiGet, apiPost } from "../services/api";
import { errorMessage } from "../utils/main-utils";
import type {
  ActionEvent,
  Annotation,
  ListActionsResponse,
  ListAnnotationsResponse,
  ListNotesResponse,
  Note,
  PaperSession,
} from "../types/types";

interface WorkspaceDataParams {
  sessionRef: MutableRefObject<PaperSession | null>;
  /** Reports a failed write; the caller decides how to surface it. */
  onError: (message: string) => void;
}

export function useWorkspaceData(params: WorkspaceDataParams) {
  const { sessionRef } = params;
  const onErrorRef = useSyncedRef(params.onError);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [events, setEvents] = useState<ActionEvent[]>([]);
  const eventsRef = useSyncedRef<ActionEvent[]>(events);
  const domainRefreshScheduledRef = useRef(false);
  const domainRefreshPromiseRef = useRef<Promise<void> | null>(null);
  const domainRefreshSessionRef = useRef<string | null>(null);

  function isCurrentSession(sessionId: string): boolean {
    return sessionRef.current?.id === sessionId;
  }

  function clearWorkspaceData(): void {
    setAnnotations([]);
    setSelectedAnnotationId(null);
    setNotes([]);
    setSelectedNoteId(null);
    setEvents([]);
  }

  /**
   * Append one action event and fold the server's copy into the timeline.
   *
   * Returns null when there is no session, or when the write failed — action
   * events are telemetry, so a failure reports and never interrupts the user.
   */
  async function recordAction(
    eventType: string,
    payload: Record<string, unknown> = {},
    eventPage: number | null = null,
    selectionText: string | null = null,
    sessionIdOverride?: string,
  ): Promise<ActionEvent | null> {
    const sid = sessionIdOverride ?? sessionRef.current?.id;
    if (!sid) {
      return null;
    }
    try {
      const event = await apiPost<ActionEvent>("/api/record-action", {
        session_id: sid,
        event_type: eventType,
        page: eventPage,
        selection_text: selectionText,
        payload,
        source: "viewer",
      });
      if (isCurrentSession(sid)) {
        upsertEvent(event);
      }
      return event;
    } catch (error) {
      onErrorRef.current(`record_action failed: ${errorMessage(error)}`);
      return null;
    }
  }

  function upsertEvent(event: ActionEvent): void {
    setEvents((prev) => {
      const byId = new Map(prev.map((item) => [item.id, item]));
      byId.set(event.id, event);
      return Array.from(byId.values()).sort((a, b) => a.id - b.id);
    });
  }

  async function refreshEvents(
    options: { sessionId?: string; incremental?: boolean } = {},
  ): Promise<void> {
    const sid = options.sessionId ?? sessionRef.current?.id;
    if (!sid) {
      return;
    }
    const incremental = options.incremental ?? true;
    let afterId = incremental ? eventsRef.current[eventsRef.current.length - 1]?.id : undefined;
    const fetched: ActionEvent[] = [];
    while (true) {
      const afterQuery =
        afterId !== undefined ? `&after_id=${encodeURIComponent(String(afterId))}` : "";
      const data = await apiGet<ListActionsResponse>(
        `/api/list-actions?session_id=${encodeURIComponent(sid)}&limit=1000${afterQuery}`,
      );
      if (!isCurrentSession(sid)) {
        return;
      }
      fetched.push(...data.events);
      if (!data.has_more || data.next_after_id === null) {
        break;
      }
      afterId = data.next_after_id;
    }
    if (!incremental) {
      if (!isCurrentSession(sid)) {
        return;
      }
      setEvents(fetched);
      return;
    }
    if (fetched.length === 0) {
      return;
    }
    if (!isCurrentSession(sid)) {
      return;
    }
    setEvents((prev) => {
      const byId = new Map(prev.map((item) => [item.id, item]));
      for (const item of fetched) {
        byId.set(item.id, item);
      }
      return Array.from(byId.values()).sort((a, b) => a.id - b.id);
    });
  }

  async function refreshAnnotations(sessionIdOverride?: string): Promise<void> {
    const sid = sessionIdOverride ?? sessionRef.current?.id;
    if (!sid) {
      return;
    }
    let offset = 0;
    const next: Annotation[] = [];
    while (true) {
      const data = await apiGet<ListAnnotationsResponse>(
        `/api/annotations?session_id=${encodeURIComponent(sid)}&limit=1000&offset=${offset}`,
      );
      if (!isCurrentSession(sid)) {
        return;
      }
      for (const raw of data.annotations) {
        const parsed = asAnnotationRecord(raw);
        if (parsed) {
          next.push(parsed.annotation);
        }
      }
      if (!data.has_more || data.next_offset === null) {
        break;
      }
      offset = data.next_offset;
    }
    if (!isCurrentSession(sid)) {
      return;
    }
    setAnnotations(next);
    setSelectedAnnotationId((prev) => {
      if (!prev) {
        return null;
      }
      return next.some((annotation) => annotation.id === prev) ? prev : null;
    });
  }

  async function refreshNotes(sessionIdOverride?: string): Promise<void> {
    const sid = sessionIdOverride ?? sessionRef.current?.id;
    if (!sid) {
      return;
    }
    let offset = 0;
    const next: Note[] = [];
    while (true) {
      const data = await apiGet<ListNotesResponse>(
        `/api/notes?session_id=${encodeURIComponent(sid)}&limit=1000&offset=${offset}`,
      );
      if (!isCurrentSession(sid)) {
        return;
      }
      for (const raw of data.notes) {
        const parsed = asNoteRecord(raw);
        if (parsed) {
          next.push(parsed.note);
        }
      }
      if (!data.has_more || data.next_offset === null) {
        break;
      }
      offset = data.next_offset;
    }
    if (!isCurrentSession(sid)) {
      return;
    }
    setNotes(next);
    setSelectedNoteId((prev) => {
      if (!prev) {
        return null;
      }
      return next.some((note) => note.id === prev) ? prev : null;
    });
  }

  function startDomainRefreshLoop(): void {
    if (domainRefreshPromiseRef.current) {
      return;
    }
    domainRefreshPromiseRef.current = (async () => {
      while (domainRefreshScheduledRef.current) {
        domainRefreshScheduledRef.current = false;
        const sid = domainRefreshSessionRef.current ?? sessionRef.current?.id;
        if (!sid) {
          continue;
        }
        await Promise.all([refreshAnnotations(sid), refreshNotes(sid)]);
      }
    })().finally(() => {
      domainRefreshPromiseRef.current = null;
      if (domainRefreshScheduledRef.current) {
        startDomainRefreshLoop();
      }
    });
  }

  async function refreshDomainState(sessionIdOverride?: string): Promise<void> {
    const sid = sessionIdOverride ?? sessionRef.current?.id;
    if (!sid) {
      return;
    }
    domainRefreshSessionRef.current = sid;
    domainRefreshScheduledRef.current = true;
    startDomainRefreshLoop();
    if (domainRefreshPromiseRef.current) {
      await domainRefreshPromiseRef.current;
    }
  }

  /** Load everything this session shows: its event stream and the paper's work. */
  async function loadFor(sessionId: string): Promise<void> {
    await Promise.all([
      refreshEvents({ sessionId, incremental: false }),
      refreshDomainState(sessionId),
    ]);
  }

  function upsertAnnotation(annotation: Annotation): void {
    setAnnotations((prev) => {
      const next = prev.filter((item) => item.id !== annotation.id);
      next.push(annotation);
      return next;
    });
    setSelectedAnnotationId(annotation.id);
  }

  function deleteAnnotation(annotationId: string): void {
    setAnnotations((prev) => prev.filter((annotation) => annotation.id !== annotationId));
    setSelectedAnnotationId((prev) => (prev === annotationId ? null : prev));
  }

  function upsertNote(note: Note): void {
    setNotes((prev) => {
      const next = prev.filter((item) => item.id !== note.id);
      next.push(note);
      return next;
    });
    setSelectedNoteId(note.id);
  }

  function deleteNote(noteId: string): void {
    setNotes((prev) => prev.filter((note) => note.id !== noteId));
    setSelectedNoteId((prev) => (prev === noteId ? null : prev));
  }

  return {
    annotations,
    setAnnotations,
    selectedAnnotationId,
    setSelectedAnnotationId,
    notes,
    setNotes,
    selectedNoteId,
    setSelectedNoteId,
    events,
    setEvents,
    eventsRef,
    clearWorkspaceData,
    upsertEvent,
    recordAction,
    loadFor,
    refreshEvents,
    refreshAnnotations,
    refreshNotes,
    refreshDomainState,
    upsertAnnotation,
    deleteAnnotation,
    upsertNote,
    deleteNote,
  };
}
