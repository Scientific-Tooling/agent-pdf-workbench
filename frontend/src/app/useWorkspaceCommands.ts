import { useEffect, useState } from "react";
import type { MutableRefObject } from "react";

import { asAnnotation, asNote } from "../pdf/main-parsers";
import { apiPost } from "../services/api";
import type {
  Annotation,
  AnnotationRecord,
  AnnotationType,
  Note,
  NoteRecord,
  PaperSession,
} from "../types/types";
import { nowIso, parseLinkedIds, parseTags, uid } from "../utils/main-utils";
import type { PendingSelection } from "./app-types";
import type { ToastType } from "./app-types";

interface WorkspaceCommandsParams {
  sessionRef: MutableRefObject<PaperSession | null>;
  pageRef: MutableRefObject<number>;
  annotations: Annotation[];
  selectedAnnotation: Annotation | null;
  selectedNote: Note | null;
  setSelectedAnnotationId: (id: string | null) => void;
  setSelectedNoteId: (id: string | null) => void;
  upsertAnnotation: (annotation: Annotation) => void;
  deleteAnnotationLocally: (annotationId: string) => void;
  upsertNote: (note: Note) => void;
  deleteNoteLocally: (noteId: string) => void;
  recordAction: (
    eventType: string,
    payload?: Record<string, unknown>,
    eventPage?: number | null,
    selectionText?: string | null,
    sessionIdOverride?: string,
  ) => Promise<unknown>;
  getSelectionRectsAndQuote: (clearSelection?: boolean) => PendingSelection | null;
  renderPage: (page: number, emitPageChange: boolean) => Promise<void>;
  onHideQuickAnnotator: () => void;
  showToast: (message: string, type?: ToastType, durationMs?: number) => void;
}

/**
 * The annotation and note commands, plus the form fields they read and write.
 *
 * Each command is the whole user-visible action: persist, mirror into local
 * state, and record the action events that let an agent replay the reading
 * session afterwards.
 */
export function useWorkspaceCommands(params: WorkspaceCommandsParams) {
  const {
    sessionRef,
    pageRef,
    annotations,
    selectedAnnotation,
    selectedNote,
    setSelectedAnnotationId,
    setSelectedNoteId,
    upsertAnnotation,
    deleteAnnotationLocally,
    upsertNote,
    deleteNoteLocally,
    recordAction,
    getSelectionRectsAndQuote,
    renderPage,
    onHideQuickAnnotator,
    showToast,
  } = params;

  const [annotationCommentInput, setAnnotationCommentInput] = useState("");
  const [annotationTagsInput, setAnnotationTagsInput] = useState("");
  const [noteTitleInput, setNoteTitleInput] = useState("");
  const [noteLinkedIdsInput, setNoteLinkedIdsInput] = useState("");
  const [noteMarkdownInput, setNoteMarkdownInput] = useState("");

  useEffect(() => {
    if (!selectedAnnotation) {
      setAnnotationCommentInput("");
      setAnnotationTagsInput("");
      return;
    }
    setAnnotationCommentInput(selectedAnnotation.comment);
    setAnnotationTagsInput(selectedAnnotation.tags.join(", "));
  }, [selectedAnnotation]);

  useEffect(() => {
    if (!selectedNote) {
      setNoteTitleInput("");
      setNoteLinkedIdsInput("");
      setNoteMarkdownInput("");
      return;
    }
    setNoteTitleInput(selectedNote.title);
    setNoteLinkedIdsInput(selectedNote.linkedAnnotationIds.join(", "));
    setNoteMarkdownInput(selectedNote.markdown);
  }, [selectedNote]);

  function clearInputs(): void {
    setAnnotationCommentInput("");
    setAnnotationTagsInput("");
    setNoteTitleInput("");
    setNoteLinkedIdsInput("");
    setNoteMarkdownInput("");
  }

  function tagsEqual(left: string[], right: string[]): boolean {
    if (left.length !== right.length) {
      return false;
    }
    for (let i = 0; i < left.length; i += 1) {
      if (left[i] !== right[i]) {
        return false;
      }
    }
    return true;
  }

  async function createAnnotation(
    type: AnnotationType,
    selectedInput?: PendingSelection,
    commentOverride?: string,
  ): Promise<void> {
    const activeSession = sessionRef.current;
    if (!activeSession) {
      showToast("Open a paper first", "warning");
      return;
    }
    const selected = selectedInput ?? getSelectionRectsAndQuote();
    if (!selected) {
      showToast("Select text on the PDF before annotating", "warning");
      return;
    }

    const now = nowIso();
    const annotation: Annotation = {
      id: uid("ann"),
      page: pageRef.current,
      type,
      quote: selected.quote,
      anchor: selected.anchor,
      comment: commentOverride ?? annotationCommentInput.trim(),
      tags: parseTags(annotationTagsInput),
      rects: selected.rects,
      createdAt: now,
      updatedAt: now,
    };

    const savedRecord = await apiPost<AnnotationRecord>("/api/annotations", {
      session_id: activeSession.id,
      annotation,
    });
    const saved = asAnnotation(savedRecord.annotation) ?? annotation;
    upsertAnnotation(saved);
    await recordAction(
      "annotation_upsert",
      { annotation: saved },
      pageRef.current,
      saved.quote,
      activeSession.id,
    );
    if (saved.comment) {
      await recordAction(
        "comment",
        { annotation_id: saved.id, text: saved.comment, tags: saved.tags },
        pageRef.current,
        saved.quote,
        activeSession.id,
      );
    }
    onHideQuickAnnotator();
    window.getSelection()?.removeAllRanges();
    showToast(type === "highlight" ? "Highlight saved" : "Underline saved", "success");
  }

  async function updateSelectedAnnotationMeta(): Promise<void> {
    if (!selectedAnnotation || !sessionRef.current) {
      return;
    }
    const nextComment = annotationCommentInput.trim();
    const nextTags = parseTags(annotationTagsInput);
    if (
      selectedAnnotation.comment === nextComment &&
      tagsEqual(selectedAnnotation.tags, nextTags)
    ) {
      return;
    }
    const updated: Annotation = {
      ...selectedAnnotation,
      comment: nextComment,
      tags: nextTags,
      updatedAt: nowIso(),
    };
    const savedRecord = await apiPost<AnnotationRecord>("/api/annotations", {
      session_id: sessionRef.current.id,
      annotation: updated,
    });
    const saved = asAnnotation(savedRecord.annotation) ?? updated;
    upsertAnnotation(saved);
    await recordAction(
      "annotation_upsert",
      { annotation: saved },
      saved.page,
      saved.quote,
      sessionRef.current.id,
    );
    if (saved.comment) {
      await recordAction(
        "comment",
        { annotation_id: saved.id, text: saved.comment, tags: saved.tags },
        saved.page,
        saved.quote,
        sessionRef.current.id,
      );
    }
    showToast("Annotation metadata updated", "success", 1400);
  }

  async function jumpToAnnotation(annotationId: string): Promise<void> {
    const annotation = annotations.find((item) => item.id === annotationId);
    if (!annotation) {
      return;
    }
    if (pageRef.current !== annotation.page) {
      await renderPage(annotation.page, true);
    }
    setSelectedAnnotationId(annotation.id);
  }

  async function deleteSelectedAnnotation(): Promise<void> {
    if (!selectedAnnotation || !sessionRef.current) {
      return;
    }
    await apiPost<{ deleted: boolean }>("/api/annotations/delete", {
      session_id: sessionRef.current.id,
      annotation_id: selectedAnnotation.id,
    });
    deleteAnnotationLocally(selectedAnnotation.id);
    await recordAction(
      "annotation_delete",
      { annotation_id: selectedAnnotation.id },
      selectedAnnotation.page,
      selectedAnnotation.quote,
      sessionRef.current.id,
    );
    showToast("Annotation deleted", "success");
  }

  async function saveNote(): Promise<void> {
    if (!sessionRef.current) {
      showToast("Open a paper first", "warning");
      return;
    }
    const now = nowIso();
    const note: Note = {
      id: selectedNote?.id ?? uid("note"),
      title: noteTitleInput.trim(),
      markdown: noteMarkdownInput,
      linkedAnnotationIds: parseLinkedIds(noteLinkedIdsInput),
      createdAt: selectedNote?.createdAt ?? now,
      updatedAt: now,
    };
    const savedRecord = await apiPost<NoteRecord>("/api/notes", {
      session_id: sessionRef.current.id,
      note,
    });
    const saved = asNote(savedRecord.note) ?? note;
    upsertNote(saved);
    await recordAction(
      "note_upsert",
      { note: saved },
      pageRef.current,
      null,
      sessionRef.current.id,
    );
    showToast("Note saved", "success");
  }

  async function deleteSelectedNote(): Promise<void> {
    if (!selectedNote || !sessionRef.current) {
      return;
    }
    await apiPost<{ deleted: boolean }>("/api/notes/delete", {
      session_id: sessionRef.current.id,
      note_id: selectedNote.id,
    });
    deleteNoteLocally(selectedNote.id);
    await recordAction(
      "note_delete",
      { note_id: selectedNote.id },
      pageRef.current,
      null,
      sessionRef.current.id,
    );
    showToast("Note deleted", "success");
  }

  function newNoteDraft(): void {
    setSelectedNoteId(null);
  }

  return {
    annotationCommentInput,
    setAnnotationCommentInput,
    annotationTagsInput,
    setAnnotationTagsInput,
    noteTitleInput,
    setNoteTitleInput,
    noteLinkedIdsInput,
    setNoteLinkedIdsInput,
    noteMarkdownInput,
    setNoteMarkdownInput,
    clearInputs,
    createAnnotation,
    updateSelectedAnnotationMeta,
    jumpToAnnotation,
    deleteSelectedAnnotation,
    saveNote,
    deleteSelectedNote,
    newNoteDraft,
  };
}
