import * as pdfjsLib from "pdfjs-dist/build/pdf.mjs";

import { apiGet, apiPost } from "./api";
import { getUiElements } from "./dom";
import { createEventListItem } from "./timeline";
import type { ListActionsResponse, PaperSession, RecordActionParams } from "./types";

import "./styles.css";

interface PdfViewportLike {
  width: number;
  height: number;
}

interface PdfPageLike {
  getViewport(params: { scale: number }): PdfViewportLike;
  render(params: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewportLike }): {
    promise: Promise<void>;
  };
  getTextContent(): Promise<{ items: unknown[] }>;
}

interface PdfDocumentLike {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageLike>;
}

interface AppState {
  sessionId: string | null;
  pdfDoc: PdfDocumentLike | null;
  page: number;
}

const DEFAULT_AGENT_ID = "agent:browser-ui";
const DEFAULT_USER_ID = "user:local";

const state: AppState = {
  sessionId: null,
  pdfDoc: null,
  page: 1,
};

const els = getUiElements();

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Unknown error";
}

function setStatus(text: string): void {
  els.statusText.textContent = `Status: ${text}`;
}

function readTextFromPdfItems(items: unknown[]): string {
  return items
    .map((item) => {
      if (typeof item !== "object" || item === null || !("str" in item)) {
        return "";
      }
      const maybeText = (item as { str?: unknown }).str;
      return typeof maybeText === "string" ? maybeText : "";
    })
    .join(" ");
}

async function openPaper(): Promise<void> {
  setStatus("opening session...");
  const paperRef = els.paperRef.value.trim();
  const pdfUri = els.pdfUri.value.trim();

  if (!paperRef || !pdfUri) {
    setStatus("paper_ref and pdf_uri are required");
    return;
  }

  const session = await apiPost<PaperSession>("/api/open-paper", {
    paper_ref: paperRef,
    pdf_uri: pdfUri,
    agent_id: DEFAULT_AGENT_ID,
    user_id: DEFAULT_USER_ID,
  });

  state.sessionId = session.id;
  els.sessionInfo.textContent = `Session: ${state.sessionId}`;
  await loadPdf(pdfUri);
  await refreshEvents();
  setStatus("session ready");
}

async function loadPdf(pdfUri: string): Promise<void> {
  const source = `/api/pdf?uri=${encodeURIComponent(pdfUri)}`;
  const loadingTask = pdfjsLib.getDocument(source);
  state.pdfDoc = (await loadingTask.promise) as unknown as PdfDocumentLike;
  state.page = 1;
  await renderPage(state.page, true);
}

async function renderPage(pageNumber: number, emitPageChange: boolean): Promise<void> {
  if (!state.pdfDoc) {
    return;
  }

  const page = await state.pdfDoc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1.35 });
  const canvas = els.pdfCanvas;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to get 2d canvas context");
  }

  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: context, viewport }).promise;

  const textContent = await page.getTextContent();
  const pageText = readTextFromPdfItems(textContent.items);
  els.textContent.textContent = pageText;
  els.pageInfo.textContent = `Page ${pageNumber} / ${state.pdfDoc.numPages}`;

  if (emitPageChange) {
    await recordAction("page_change", {
      page: pageNumber,
      payload: { total_pages: state.pdfDoc.numPages },
    });
  }
}

async function recordAction(eventType: string, params: RecordActionParams = {}): Promise<void> {
  if (!state.sessionId) {
    return;
  }

  await apiPost("/api/record-action", {
    session_id: state.sessionId,
    event_type: eventType,
    page: params.page ?? null,
    selection_text: params.selectionText ?? null,
    payload: params.payload ?? null,
    source: "viewer",
  });
}

async function refreshEvents(): Promise<void> {
  if (!state.sessionId) {
    return;
  }

  const data = await apiGet<ListActionsResponse>(
    `/api/list-actions?session_id=${encodeURIComponent(state.sessionId)}&limit=200`,
  );

  els.eventsList.innerHTML = "";
  for (const event of data.events) {
    els.eventsList.appendChild(createEventListItem(event));
  }
}

async function closeSession(): Promise<void> {
  if (!state.sessionId) {
    return;
  }
  await apiPost("/api/close-paper", { session_id: state.sessionId });
  setStatus("session closed");
}

els.openPaperBtn.addEventListener("click", async () => {
  try {
    await openPaper();
  } catch (error) {
    setStatus(errorMessage(error));
  }
});

els.closePaperBtn.addEventListener("click", async () => {
  try {
    await closeSession();
    await refreshEvents();
  } catch (error) {
    setStatus(errorMessage(error));
  }
});

els.prevBtn.addEventListener("click", async () => {
  if (!state.pdfDoc || state.page <= 1) {
    return;
  }

  state.page -= 1;
  try {
    await renderPage(state.page, true);
    await refreshEvents();
  } catch (error) {
    setStatus(errorMessage(error));
  }
});

els.nextBtn.addEventListener("click", async () => {
  if (!state.pdfDoc || state.page >= state.pdfDoc.numPages) {
    return;
  }

  state.page += 1;
  try {
    await renderPage(state.page, true);
    await refreshEvents();
  } catch (error) {
    setStatus(errorMessage(error));
  }
});

els.highlightBtn.addEventListener("click", async () => {
  const selected = window.getSelection()?.toString().trim() ?? "";
  if (!selected) {
    setStatus("select text before highlighting");
    return;
  }

  try {
    await recordAction("highlight", {
      page: state.page,
      selectionText: selected,
      payload: { mode: "selection" },
    });
    await refreshEvents();
    setStatus("highlight recorded");
  } catch (error) {
    setStatus(errorMessage(error));
  }
});

els.commentBtn.addEventListener("click", async () => {
  const comment = els.commentInput.value.trim();
  if (!comment) {
    setStatus("comment is empty");
    return;
  }

  try {
    await recordAction("comment", {
      page: state.page,
      payload: { text: comment },
    });
    els.commentInput.value = "";
    await refreshEvents();
    setStatus("comment recorded");
  } catch (error) {
    setStatus(errorMessage(error));
  }
});

els.textContent.addEventListener("copy", async () => {
  const selected = window.getSelection()?.toString().trim() ?? "";
  if (!selected) {
    return;
  }

  try {
    await recordAction("copy", {
      page: state.page,
      selectionText: selected,
      payload: { chars: selected.length },
    });
    await refreshEvents();
  } catch (error) {
    setStatus(errorMessage(error));
  }
});

els.refreshBtn.addEventListener("click", async () => {
  try {
    await refreshEvents();
  } catch (error) {
    setStatus(errorMessage(error));
  }
});
