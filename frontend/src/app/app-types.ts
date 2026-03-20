import type {
  Annotation,
  Note,
  NormalizedRect,
  OutlineItem,
  PaperSession,
  SearchResult,
  TextAnchor,
} from "../types/types";

export interface PdfViewportLike {
  width: number;
  height: number;
  transform: number[];
}

export interface PdfOutlineNode {
  title?: string;
  dest?: unknown;
  items?: PdfOutlineNode[];
}

export interface PdfPageLike {
  getViewport(params: { scale: number }): PdfViewportLike;
  render(params: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewportLike }): {
    promise: Promise<void>;
  };
  getTextContent(): Promise<{ items: Array<Record<string, unknown>> }>;
}

export interface PdfDocumentLike {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageLike>;
  getOutline(): Promise<PdfOutlineNode[] | null>;
  getDestination(dest: string): Promise<unknown>;
  getPageIndex(ref: unknown): Promise<number>;
}

export interface PendingSelection {
  rects: NormalizedRect[];
  quote: string;
  anchor: TextAnchor;
  anchorX: number;
  anchorY: number;
}

export type ToastType = "success" | "warning" | "error" | "info";

export interface AppState {
  session: PaperSession | null;
  pdfDoc: PdfDocumentLike | null;
  paperRef: string;
  pdfUri: string;
  page: number;
  zoom: number;
  annotations: Annotation[];
  selectedAnnotationId: string | null;
  notes: Note[];
  selectedNoteId: string | null;
  searchQuery: string;
  searchResults: SearchResult[];
  searchCursor: number;
  pageTextCache: Map<number, string>;
  outline: OutlineItem[];
  loadingCount: number;
  pendingSelection: PendingSelection | null;
}

export const DEFAULT_AGENT_ID = "agent:browser-ui";
export const DEFAULT_USER_ID = "user:local";
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 3.5;
export const ZOOM_STEP = 0.2;
export const ANCHOR_CONTEXT_CHARS = 24;

export function createInitialState(): AppState {
  return {
    session: null,
    pdfDoc: null,
    paperRef: "",
    pdfUri: "",
    page: 1,
    zoom: 1.35,
    annotations: [],
    selectedAnnotationId: null,
    notes: [],
    selectedNoteId: null,
    searchQuery: "",
    searchResults: [],
    searchCursor: 0,
    pageTextCache: new Map(),
    outline: [],
    loadingCount: 0,
    pendingSelection: null,
  };
}
