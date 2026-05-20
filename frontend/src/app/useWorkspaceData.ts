import { useRef, useState } from "react";
import type { MutableRefObject } from "react";

import { useSyncedRef } from "../hooks/useSyncedRef";
import { asAnnotationRecord, asNoteRecord } from "../pdf/main-parsers";
import { apiGet } from "../services/api";
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
}

export function useWorkspaceData(params: WorkspaceDataParams) {
  const { sessionRef } = params;
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [events, setEvents] = useState<ActionEvent[]>([]);
  const eventsRef = useSyncedRef<ActionEvent[]>(events);
  const domainRefreshScheduledRef = useRef(false);
  const domainRefreshPromiseRef = useRef<Promise<void> | null>(null);
  const domainRefreshSessionRef = useRef<string | null>(null);

  function clearWorkspaceData(): void {
    setAnnotations([]);
    setSelectedAnnotationId(null);
    setNotes([]);
    setSelectedNoteId(null);
    setEvents([]);
  }

  function upsertEvent(event: ActionEvent): void {
    setEvents((prev) => {
      const byId = new Map(prev.map((item) => [item.id, item]));
      byId.set(event.id, event);
      return Array.from(byId.values()).sort((a, b) => a.id - b.id);
    });
  }

  async function refreshEvents(options: { sessionId?: string; incremental?: boolean } = {}): Promise<void> {
    const sid = options.sessionId ?? sessionRef.current?.id;
    if (!sid) {
      return;
    }
    const incremental = options.incremental ?? true;
    let afterId = incremental ? eventsRef.current[eventsRef.current.length - 1]?.id : undefined;
    const fetched: ActionEvent[] = [];
    while (true) {
      const afterQuery = afterId !== undefined ? `&after_id=${encodeURIComponent(String(afterId))}` : "";
      const data = await apiGet<ListActionsResponse>(
        `/api/list-actions?session_id=${encodeURIComponent(sid)}&limit=1000${afterQuery}`,
      );
      fetched.push(...data.events);
      if (!data.has_more || data.next_after_id === null) {
        break;
      }
      afterId = data.next_after_id;
    }
    if (!incremental) {
      setEvents(fetched);
      return;
    }
    if (fetched.length === 0) {
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
