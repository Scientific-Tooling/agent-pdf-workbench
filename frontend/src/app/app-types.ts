import type { NormalizedRect, TextAnchor } from "../types/types";

export interface PdfOutlineNode {
  title?: string;
  dest?: unknown;
  items?: PdfOutlineNode[];
}

export interface PendingSelection {
  rects: NormalizedRect[];
  quote: string;
  anchor: TextAnchor;
  anchorX: number;
  anchorY: number;
}

export type ToastType = "success" | "warning" | "error" | "info";

export const DEFAULT_AGENT_ID = "agent:browser-ui";
export const DEFAULT_USER_ID = "user:local";
export const DEFAULT_ZOOM = 1.35;
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 3.5;
export const ANCHOR_CONTEXT_CHARS = 24;
