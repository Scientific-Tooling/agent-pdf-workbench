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
  refreshRecentBtn: HTMLButtonElement;
  recentList: HTMLUListElement;
  outlineList: HTMLUListElement;

  prevBtn: HTMLButtonElement;
  nextBtn: HTMLButtonElement;
  pageJumpInput: HTMLInputElement;
  pageJumpBtn: HTMLButtonElement;
  pageInfo: HTMLSpanElement;
  zoomOutBtn: HTMLButtonElement;
  zoomInBtn: HTMLButtonElement;
  fitWidthBtn: HTMLButtonElement;
  zoomInfo: HTMLSpanElement;

  searchInput: HTMLInputElement;
  searchBtn: HTMLButtonElement;
  searchPrevBtn: HTMLButtonElement;
  searchNextBtn: HTMLButtonElement;
  searchInfo: HTMLSpanElement;
  searchResultsList: HTMLUListElement;

  sessionInfo: HTMLParagraphElement;
  statusText: HTMLParagraphElement;
  pdfStage: HTMLDivElement;
  pdfCanvas: HTMLCanvasElement;
  textLayer: HTMLDivElement;
  annotationLayer: HTMLDivElement;

  highlightBtn: HTMLButtonElement;
  underlineBtn: HTMLButtonElement;
  deleteAnnotationBtn: HTMLButtonElement;
  annotationCommentInput: HTMLInputElement;
  annotationTagsInput: HTMLInputElement;
  selectedAnnotationInfo: HTMLParagraphElement;
  annotationList: HTMLUListElement;

  noteTitleInput: HTMLInputElement;
  noteLinkedIdsInput: HTMLInputElement;
  noteMarkdownInput: HTMLTextAreaElement;
  saveNoteBtn: HTMLButtonElement;
  newNoteBtn: HTMLButtonElement;
  deleteNoteBtn: HTMLButtonElement;
  selectedNoteInfo: HTMLParagraphElement;
  notesList: HTMLUListElement;

  exportJsonBtn: HTMLButtonElement;
  exportMarkdownBtn: HTMLButtonElement;

  refreshBtn: HTMLButtonElement;
  eventsList: HTMLUListElement;
}

export function getUiElements(): UiElements {
  return {
    paperRef: mustElement<HTMLInputElement>("paperRef"),
    pdfUri: mustElement<HTMLInputElement>("pdfUri"),
    openPaperBtn: mustElement<HTMLButtonElement>("openPaperBtn"),
    closePaperBtn: mustElement<HTMLButtonElement>("closePaperBtn"),
    refreshRecentBtn: mustElement<HTMLButtonElement>("refreshRecentBtn"),
    recentList: mustElement<HTMLUListElement>("recentList"),
    outlineList: mustElement<HTMLUListElement>("outlineList"),

    prevBtn: mustElement<HTMLButtonElement>("prevBtn"),
    nextBtn: mustElement<HTMLButtonElement>("nextBtn"),
    pageJumpInput: mustElement<HTMLInputElement>("pageJumpInput"),
    pageJumpBtn: mustElement<HTMLButtonElement>("pageJumpBtn"),
    pageInfo: mustElement<HTMLSpanElement>("pageInfo"),
    zoomOutBtn: mustElement<HTMLButtonElement>("zoomOutBtn"),
    zoomInBtn: mustElement<HTMLButtonElement>("zoomInBtn"),
    fitWidthBtn: mustElement<HTMLButtonElement>("fitWidthBtn"),
    zoomInfo: mustElement<HTMLSpanElement>("zoomInfo"),

    searchInput: mustElement<HTMLInputElement>("searchInput"),
    searchBtn: mustElement<HTMLButtonElement>("searchBtn"),
    searchPrevBtn: mustElement<HTMLButtonElement>("searchPrevBtn"),
    searchNextBtn: mustElement<HTMLButtonElement>("searchNextBtn"),
    searchInfo: mustElement<HTMLSpanElement>("searchInfo"),
    searchResultsList: mustElement<HTMLUListElement>("searchResultsList"),

    sessionInfo: mustElement<HTMLParagraphElement>("sessionInfo"),
    statusText: mustElement<HTMLParagraphElement>("statusText"),
    pdfStage: mustElement<HTMLDivElement>("pdfStage"),
    pdfCanvas: mustElement<HTMLCanvasElement>("pdfCanvas"),
    textLayer: mustElement<HTMLDivElement>("textLayer"),
    annotationLayer: mustElement<HTMLDivElement>("annotationLayer"),

    highlightBtn: mustElement<HTMLButtonElement>("highlightBtn"),
    underlineBtn: mustElement<HTMLButtonElement>("underlineBtn"),
    deleteAnnotationBtn: mustElement<HTMLButtonElement>("deleteAnnotationBtn"),
    annotationCommentInput: mustElement<HTMLInputElement>("annotationCommentInput"),
    annotationTagsInput: mustElement<HTMLInputElement>("annotationTagsInput"),
    selectedAnnotationInfo: mustElement<HTMLParagraphElement>("selectedAnnotationInfo"),
    annotationList: mustElement<HTMLUListElement>("annotationList"),

    noteTitleInput: mustElement<HTMLInputElement>("noteTitleInput"),
    noteLinkedIdsInput: mustElement<HTMLInputElement>("noteLinkedIdsInput"),
    noteMarkdownInput: mustElement<HTMLTextAreaElement>("noteMarkdownInput"),
    saveNoteBtn: mustElement<HTMLButtonElement>("saveNoteBtn"),
    newNoteBtn: mustElement<HTMLButtonElement>("newNoteBtn"),
    deleteNoteBtn: mustElement<HTMLButtonElement>("deleteNoteBtn"),
    selectedNoteInfo: mustElement<HTMLParagraphElement>("selectedNoteInfo"),
    notesList: mustElement<HTMLUListElement>("notesList"),

    exportJsonBtn: mustElement<HTMLButtonElement>("exportJsonBtn"),
    exportMarkdownBtn: mustElement<HTMLButtonElement>("exportMarkdownBtn"),

    refreshBtn: mustElement<HTMLButtonElement>("refreshBtn"),
    eventsList: mustElement<HTMLUListElement>("eventsList"),
  };
}
