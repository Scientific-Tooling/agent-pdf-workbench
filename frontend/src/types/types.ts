export interface PaperSession {
  id: string;
  paper_ref: string;
  pdf_uri: string;
  agent_id: string;
  user_id: string;
  metadata: Record<string, unknown>;
  opened_at: string;
  closed_at: string | null;
}

export interface ActionEvent {
  id: number;
  session_id: string;
  event_type: string;
  page: number | null;
  selection_text: string | null;
  payload: Record<string, unknown>;
  source: string;
  created_at: string;
}

export interface ListActionsResponse {
  session_id: string;
  count: number;
  events: ActionEvent[];
}

export interface RecordActionParams {
  page?: number | null;
  selectionText?: string | null;
  payload?: Record<string, unknown> | null;
}

export type AnnotationType = "highlight" | "underline";

export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextAnchor {
  quote: string;
  start: number | null;
  end: number | null;
  prefix: string;
  suffix: string;
}

export interface Annotation {
  id: string;
  page: number;
  type: AnnotationType;
  quote: string;
  anchor: TextAnchor | null;
  comment: string;
  tags: string[];
  rects: NormalizedRect[];
  createdAt: string;
  updatedAt: string;
}

export interface Note {
  id: string;
  title: string;
  markdown: string;
  linkedAnnotationIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AnnotationRecord {
  id: string;
  session_id: string;
  annotation: Annotation;
  created_at: string;
  updated_at: string;
}

export interface NoteRecord {
  id: string;
  session_id: string;
  note: Note;
  created_at: string;
  updated_at: string;
}

export interface ListAnnotationsResponse {
  session_id: string;
  count: number;
  annotations: AnnotationRecord[];
}

export interface ListNotesResponse {
  session_id: string;
  count: number;
  notes: NoteRecord[];
}

export interface SearchResult {
  page: number;
  snippet: string;
  matchIndex: number;
}

export interface OutlineItem {
  title: string;
  page: number;
  level: number;
}

export interface ReadingProgress {
  paperRef: string;
  pdfUri: string;
  sessionId: string;
  lastPage: number;
  zoom: number;
  updatedAt: string;
}

export interface RecentPaper {
  paperRef: string;
  pdfUri: string;
  sessionId: string;
  lastPage: number;
  updatedAt: string;
}
