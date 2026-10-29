/** Geometry is kept for every page; expensive canvas/text layers stay near the viewport. */
export const PAGE_GAP = 24;

export interface PageSize {
  width: number;
  height: number;
}

export interface DocumentPage {
  number: number;
  top: number;
  height: number;
  element: HTMLDivElement;
  canvas: HTMLCanvasElement;
  textLayer: HTMLDivElement;
  annotationLayer: HTMLDivElement;
  ready: boolean;
  revision: number;
  rendering?: Promise<void>;
  cancelRender?: () => void;
}

export function createDocumentPages(sizes: PageSize[], zoom: number): DocumentPage[] {
  let top = 0;
  return sizes.map((size, index) => {
    const number = index + 1;
    const element = document.createElement("div");
    element.className = "pdf-document-container";
    element.dataset.page = String(number);
    element.setAttribute("role", "group");
    element.setAttribute("aria-label", `Page ${number}`);
    element.setAttribute("aria-busy", "true");
    element.style.width = `${size.width * zoom}px`;
    element.style.height = `${size.height * zoom}px`;
    const canvas = document.createElement("canvas");
    canvas.width = 0;
    canvas.height = 0;
    canvas.setAttribute("aria-hidden", "true");
    const textLayer = document.createElement("div");
    textLayer.className = "text-layer";
    const annotationLayer = document.createElement("div");
    annotationLayer.className = "annotation-layer";
    element.append(canvas, textLayer, annotationLayer);
    const page: DocumentPage = {
      number,
      top,
      height: size.height * zoom,
      element,
      canvas,
      textLayer,
      annotationLayer,
      ready: false,
      revision: 0,
    };
    top += page.height + PAGE_GAP;
    return page;
  });
}

export function releaseDocumentPage(page: DocumentPage): void {
  page.revision += 1;
  page.cancelRender?.();
  page.cancelRender = undefined;
  page.rendering = undefined;
  page.ready = false;
  page.canvas.width = 0;
  page.canvas.height = 0;
  page.textLayer.replaceChildren();
  page.annotationLayer.replaceChildren();
  page.element.setAttribute("aria-busy", "true");
}

export function pageAtOffset(pages: DocumentPage[], offset: number): DocumentPage | undefined {
  // Binary search makes dragging through a long document independent of its length.
  let lo = 0;
  let hi = pages.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (pages[mid].top + pages[mid].height + PAGE_GAP / 2 < offset) lo = mid + 1;
    else hi = mid;
  }
  return pages[lo];
}
