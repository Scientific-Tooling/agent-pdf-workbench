/**
 * The pdf.js types we use, re-exported from the declarations pdfjs-dist ships.
 *
 * The package exposes no type declarations next to `build/pdf.mjs`, so the app
 * used to hand-write its own module declaration — which meant `tsc` checked our
 * claims about pdf.js rather than pdf.js itself, and an API change across a
 * major version compiled clean and failed at runtime. Importing the real
 * declarations here means an upgrade breaks the build instead.
 */
export type {
  PDFDocumentProxy,
  PDFPageProxy,
  TextContent,
  TextItem,
  TextMarkedContent,
} from "pdfjs-dist/types/src/display/api";
export type { PageViewport } from "pdfjs-dist/types/src/display/page_viewport";
