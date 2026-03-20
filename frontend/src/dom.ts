function mustElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element: #${id}`);
  }
  return element as T;
}

export interface UiElements {
  paperRef: HTMLInputElement;
  pdfUri: HTMLInputElement;
  openPaperBtn: HTMLButtonElement;
  closePaperBtn: HTMLButtonElement;
  prevBtn: HTMLButtonElement;
  nextBtn: HTMLButtonElement;
  pageInfo: HTMLSpanElement;
  sessionInfo: HTMLParagraphElement;
  statusText: HTMLParagraphElement;
  pdfCanvas: HTMLCanvasElement;
  highlightBtn: HTMLButtonElement;
  commentInput: HTMLInputElement;
  commentBtn: HTMLButtonElement;
  textContent: HTMLDivElement;
  refreshBtn: HTMLButtonElement;
  eventsList: HTMLUListElement;
}

export function getUiElements(): UiElements {
  return {
    paperRef: mustElement<HTMLInputElement>("paperRef"),
    pdfUri: mustElement<HTMLInputElement>("pdfUri"),
    openPaperBtn: mustElement<HTMLButtonElement>("openPaperBtn"),
    closePaperBtn: mustElement<HTMLButtonElement>("closePaperBtn"),
    prevBtn: mustElement<HTMLButtonElement>("prevBtn"),
    nextBtn: mustElement<HTMLButtonElement>("nextBtn"),
    pageInfo: mustElement<HTMLSpanElement>("pageInfo"),
    sessionInfo: mustElement<HTMLParagraphElement>("sessionInfo"),
    statusText: mustElement<HTMLParagraphElement>("statusText"),
    pdfCanvas: mustElement<HTMLCanvasElement>("pdfCanvas"),
    highlightBtn: mustElement<HTMLButtonElement>("highlightBtn"),
    commentInput: mustElement<HTMLInputElement>("commentInput"),
    commentBtn: mustElement<HTMLButtonElement>("commentBtn"),
    textContent: mustElement<HTMLDivElement>("textContent"),
    refreshBtn: mustElement<HTMLButtonElement>("refreshBtn"),
    eventsList: mustElement<HTMLUListElement>("eventsList"),
  };
}
