import { useMemo } from "react";

import type { Annotation, Note } from "../types/types";

interface WorkspaceSelectionParams {
  annotations: Annotation[];
  selectedAnnotationId: string | null;
  notes: Note[];
  selectedNoteId: string | null;
}

export function useWorkspaceSelection(params: WorkspaceSelectionParams) {
  const { annotations, selectedAnnotationId, notes, selectedNoteId } = params;

  const selectedAnnotation = useMemo(
    () => annotations.find((annotation) => annotation.id === selectedAnnotationId) ?? null,
    [annotations, selectedAnnotationId],
  );

  const selectedNote = useMemo(
    () => notes.find((note) => note.id === selectedNoteId) ?? null,
    [notes, selectedNoteId],
  );

  const sortedAnnotations = useMemo(
    () => annotations.slice().sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
    [annotations],
  );

  const sortedNotes = useMemo(
    () => notes.slice().sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
    [notes],
  );

  return {
    selectedAnnotation,
    selectedNote,
    sortedAnnotations,
    sortedNotes,
  };
}
