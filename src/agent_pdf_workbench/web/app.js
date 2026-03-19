import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.5.136/build/pdf.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.5.136/build/pdf.worker.mjs";

const state = {
  sessionId: null,
  pdfDoc: null,
  page: 1,
};

const els = {
  paperRef: document.getElementById("paperRef"),
  pdfUri: document.getElementById("pdfUri"),
  openPaperBtn: document.getElementById("openPaperBtn"),
  closePaperBtn: document.getElementById("closePaperBtn"),
  prevBtn: document.getElementById("prevBtn"),
  nextBtn: document.getElementById("nextBtn"),
  pageInfo: document.getElementById("pageInfo"),
  sessionInfo: document.getElementById("sessionInfo"),
  statusText: document.getElementById("statusText"),
  pdfCanvas: document.getElementById("pdfCanvas"),
  highlightBtn: document.getElementById("highlightBtn"),
  commentInput: document.getElementById("commentInput"),
  commentBtn: document.getElementById("commentBtn"),
  textContent: document.getElementById("textContent"),
  refreshBtn: document.getElementById("refreshBtn"),
  eventsList: document.getElementById("eventsList"),
};

async function apiPost(path, payload) {
  const resp = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(data.error || `Request failed: ${resp.status}`);
  }
  return data;
}

async function apiGet(path) {
  const resp = await fetch(path);
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(data.error || `Request failed: ${resp.status}`);
  }
  return data;
}

function setStatus(text) {
  els.statusText.textContent = `Status: ${text}`;
}

async function openPaper() {
  setStatus("opening session...");
  const paperRef = els.paperRef.value.trim();
  const pdfUri = els.pdfUri.value.trim();
  if (!paperRef || !pdfUri) {
    setStatus("paper_ref and pdf_uri are required");
    return;
  }
  const session = await apiPost("/api/open-paper", {
    paper_ref: paperRef,
    pdf_uri: pdfUri,
    agent_id: "agent:browser-ui",
    user_id: "user:local",
  });
  state.sessionId = session.id;
  els.sessionInfo.textContent = `Session: ${state.sessionId}`;
  await loadPdf(pdfUri);
  await refreshEvents();
  setStatus("session ready");
}

async function loadPdf(pdfUri) {
  const source = `/api/pdf?uri=${encodeURIComponent(pdfUri)}`;
  state.pdfDoc = await pdfjsLib.getDocument(source).promise;
  state.page = 1;
  await renderPage(state.page, true);
}

async function renderPage(pageNumber, emitPageChange) {
  if (!state.pdfDoc) {
    return;
  }
  const page = await state.pdfDoc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1.35 });
  const canvas = els.pdfCanvas;
  const ctx = canvas.getContext("2d");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: ctx, viewport }).promise;

  const textContent = await page.getTextContent();
  const pageText = textContent.items.map((item) => item.str).join(" ");
  els.textContent.textContent = pageText;
  els.pageInfo.textContent = `Page ${pageNumber} / ${state.pdfDoc.numPages}`;

  if (emitPageChange) {
    await recordAction("page_change", {
      page: pageNumber,
      payload: { total_pages: state.pdfDoc.numPages },
    });
  }
}

async function recordAction(eventType, { page = null, selectionText = null, payload = null } = {}) {
  if (!state.sessionId) {
    return;
  }
  await apiPost("/api/record-action", {
    session_id: state.sessionId,
    event_type: eventType,
    page,
    selection_text: selectionText,
    payload,
    source: "viewer",
  });
}

async function refreshEvents() {
  if (!state.sessionId) {
    return;
  }
  const data = await apiGet(`/api/list-actions?session_id=${encodeURIComponent(state.sessionId)}&limit=200`);
  els.eventsList.innerHTML = "";
  for (const event of data.events) {
    const li = document.createElement("li");
    const line1 = `${event.id} | ${event.event_type} | p.${event.page ?? "-"} | ${event.created_at}`;
    const line2 = event.selection_text ? `text: ${event.selection_text}` : "";
    const line3 = event.payload && Object.keys(event.payload).length > 0 ? `payload: ${JSON.stringify(event.payload)}` : "";
    li.innerHTML = `<div>${line1}</div><div>${line2}</div><div>${line3}</div>`;
    els.eventsList.appendChild(li);
  }
}

async function closeSession() {
  if (!state.sessionId) {
    return;
  }
  await apiPost("/api/close-paper", { session_id: state.sessionId });
  setStatus("session closed");
}

els.openPaperBtn.addEventListener("click", async () => {
  try {
    await openPaper();
  } catch (err) {
    setStatus(err.message);
  }
});

els.closePaperBtn.addEventListener("click", async () => {
  try {
    await closeSession();
    await refreshEvents();
  } catch (err) {
    setStatus(err.message);
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
  } catch (err) {
    setStatus(err.message);
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
  } catch (err) {
    setStatus(err.message);
  }
});

els.highlightBtn.addEventListener("click", async () => {
  const selected = window.getSelection()?.toString().trim() || "";
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
  } catch (err) {
    setStatus(err.message);
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
  } catch (err) {
    setStatus(err.message);
  }
});

els.textContent.addEventListener("copy", async () => {
  const selected = window.getSelection()?.toString().trim() || "";
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
  } catch (err) {
    setStatus(err.message);
  }
});

els.refreshBtn.addEventListener("click", async () => {
  try {
    await refreshEvents();
  } catch (err) {
    setStatus(err.message);
  }
});
