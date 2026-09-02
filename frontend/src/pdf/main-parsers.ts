import { nowIso } from "../utils/main-utils";
import type {
  Annotation,
  AnnotationRecord,
  Note,
  NoteRecord,
  NormalizedRect,
  TextAnchor,
} from "../types/types";

export function asTextAnchor(value: unknown, fallbackQuote: string): TextAnchor | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = value as Partial<TextAnchor>;
  const start =
    typeof candidate.start === "number" && Number.isFinite(candidate.start)
      ? candidate.start
      : null;
  const end =
    typeof candidate.end === "number" && Number.isFinite(candidate.end) ? candidate.end : null;
  const quote = typeof candidate.quote === "string" ? candidate.quote : fallbackQuote;
  return {
    quote,
    start,
    end,
    prefix: typeof candidate.prefix === "string" ? candidate.prefix : "",
    suffix: typeof candidate.suffix === "string" ? candidate.suffix : "",
  };
}

export function asAnnotation(value: unknown): Annotation | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = value as Partial<Annotation>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.page !== "number" ||
    (candidate.type !== "highlight" && candidate.type !== "underline")
  ) {
    return null;
  }
  const quote = typeof candidate.quote === "string" ? candidate.quote : "";
  return {
    id: candidate.id,
    page: candidate.page,
    type: candidate.type,
    quote,
    anchor: asTextAnchor(candidate.anchor, quote),
    comment: typeof candidate.comment === "string" ? candidate.comment : "",
    tags: Array.isArray(candidate.tags)
      ? candidate.tags.filter((tag): tag is string => typeof tag === "string")
      : [],
    rects: (Array.isArray(candidate.rects) ? candidate.rects : []).filter(
      (rect): rect is NormalizedRect => {
        if (typeof rect !== "object" || rect === null) {
          return false;
        }
        const cast = rect as Partial<NormalizedRect>;
        return (
          typeof cast.x === "number" &&
          typeof cast.y === "number" &&
          typeof cast.width === "number" &&
          typeof cast.height === "number"
        );
      },
    ),
    createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : nowIso(),
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : nowIso(),
  };
}

export function asNote(value: unknown): Note | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = value as Partial<Note>;
  if (typeof candidate.id !== "string") {
    return null;
  }
  return {
    id: candidate.id,
    title: typeof candidate.title === "string" ? candidate.title : "",
    markdown: typeof candidate.markdown === "string" ? candidate.markdown : "",
    linkedAnnotationIds: Array.isArray(candidate.linkedAnnotationIds)
      ? candidate.linkedAnnotationIds.filter((value): value is string => typeof value === "string")
      : [],
    createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : nowIso(),
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : nowIso(),
  };
}

export function asAnnotationRecord(value: unknown): AnnotationRecord | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = value as Partial<AnnotationRecord>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.session_id !== "string" ||
    typeof candidate.created_at !== "string" ||
    typeof candidate.updated_at !== "string"
  ) {
    return null;
  }
  const annotation = asAnnotation(candidate.annotation);
  if (!annotation) {
    return null;
  }
  return {
    id: candidate.id,
    paper_ref: typeof candidate.paper_ref === "string" ? candidate.paper_ref : "",
    session_id: candidate.session_id,
    annotation,
    created_at: candidate.created_at,
    updated_at: candidate.updated_at,
  };
}

export function asNoteRecord(value: unknown): NoteRecord | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = value as Partial<NoteRecord>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.session_id !== "string" ||
    typeof candidate.created_at !== "string" ||
    typeof candidate.updated_at !== "string"
  ) {
    return null;
  }
  const note = asNote(candidate.note);
  if (!note) {
    return null;
  }
  return {
    id: candidate.id,
    paper_ref: typeof candidate.paper_ref === "string" ? candidate.paper_ref : "",
    session_id: candidate.session_id,
    note,
    created_at: candidate.created_at,
    updated_at: candidate.updated_at,
  };
}
