/** @vitest-environment jsdom */
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as pdfjs from "pdfjs-dist/build/pdf.mjs";
import { usePdfReader } from "./usePdfReader";

vi.mock("pdfjs-dist/build/pdf.mjs", () => ({
  GlobalWorkerOptions: {},
  getDocument: vi.fn(),
  TextLayer: class {
    textDivs: HTMLElement[] = [];
    textContentItemsStr: string[] = [];
    constructor(
      private options: { container: HTMLElement; textContentSource: { items: { str: string }[] } },
    ) {}
    async render() {
      const span = document.createElement("span");
      span.textContent = this.options.textContentSource.items[0].str;
      this.options.container.append(span);
      this.textDivs = [span];
      this.textContentItemsStr = [span.textContent];
    }
    cancel() {}
  },
}));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "worker" }));
let root: Root;
let container: HTMLDivElement;
let model: ReturnType<typeof usePdfReader>;
let params: Parameters<typeof usePdfReader>[0];
let painted: ReturnType<typeof vi.fn<(...args: unknown[]) => void>>;
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function queuePdf(text: string, width: number, rendering = Promise.resolve()) {
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({
      scale,
      userUnit: 1,
      width: width * scale,
      height: 800 * scale,
    }),
    getTextContent: async () => ({ items: [{ str: text }] }),
    render: vi.fn(() => ({ promise: rendering, cancel: vi.fn() })),
  };
  const doc = { numPages: 1, getPage: async () => page, getOutline: async () => null };
  vi.mocked(pdfjs.getDocument).mockReturnValueOnce({
    promise: Promise.resolve(doc),
    destroy: async () => {},
  } as unknown as ReturnType<typeof pdfjs.getDocument>);
  return page;
}
function queueMultiPagePdf(
  heights: number[],
  slowPage?: { number: number; promise: Promise<void> },
) {
  const pages = heights.map((height, index) => ({
    getViewport: ({ scale }: { scale: number }) => ({
      scale,
      userUnit: 1,
      width: (index % 2 ? 900 : 600) * scale,
      height: height * scale,
    }),
    getTextContent: async () => ({ items: [{ str: `Source page ${index + 1}` }] }),
    render: vi.fn(() => ({
      promise: slowPage?.number === index + 1 ? slowPage.promise : Promise.resolve(),
      cancel: vi.fn(),
    })),
  }));
  vi.mocked(pdfjs.getDocument).mockReturnValueOnce({
    promise: Promise.resolve({
      numPages: pages.length,
      getPage: async (number: number) => pages[number - 1],
      getOutline: async () => null,
    }),
    destroy: async () => {},
  } as unknown as ReturnType<typeof pdfjs.getDocument>);
  Object.defineProperty(params.pdfStageRef.current, "clientHeight", { value: 500 });
  return pages;
}
function Harness() {
  model = usePdfReader(params);
  return null;
}
const open = (id: string, preserveView = false, zoom?: number) =>
  model.openDocument({
    sessionId: id,
    paperRef: id,
    pdfUri: `/${id}.pdf`,
    page: 1,
    preserveView,
    zoom,
  });
beforeEach(async () => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const stage = document.createElement("div");
  Object.defineProperty(stage, "clientWidth", { value: 600 });
  const canvas = document.createElement("canvas");
  const text = document.createElement("div");
  const annotations = document.createElement("div");
  const pages = document.createElement("div");
  stage.append(pages);
  container.append(stage);
  painted = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    return {
      drawImage: (...args: unknown[]) => {
        if (this.parentElement?.className === "pdf-document-container") painted(...args);
      },
    } as unknown as CanvasRenderingContext2D;
  });
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ close: vi.fn() })),
  );
  params = {
    pdfStageRef: createRef(),
    pdfPagesRef: createRef(),
    pdfCanvasRef: createRef(),
    textLayerRef: createRef(),
    annotationLayerRef: createRef(),
    onProgress: vi.fn(),
    onPageChange: vi.fn().mockResolvedValue(undefined),
    onZoomChange: vi.fn().mockResolvedValue(undefined),
  };
  params.pdfStageRef.current = stage;
  params.pdfPagesRef.current = pages;
  params.pdfCanvasRef.current = canvas;
  params.textLayerRef.current = text;
  params.annotationLayerRef.current = annotations;
  await act(async () => {
    root.render(createElement(Harness));
  });
  // The hook's imperative stage is separate from React's test harness tree.
  container.append(stage);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("keeps the old canvas until the new page and text can be committed together", async () => {
  queuePdf("First source", 600);
  await act(async () => open("first"));
  const oldWidth = params.pdfCanvasRef.current!.width;
  const oldPaints = painted.mock.calls.length;
  const slow = deferred();
  queuePdf("Second source", 900, slow.promise);
  let pending!: Promise<void>;
  await act(async () => {
    pending = open("second", true);
  });
  expect(params.pdfCanvasRef.current!.width).toBe(oldWidth);
  expect(painted).toHaveBeenCalledTimes(oldPaints);
  expect(params.textLayerRef.current!.textContent).toBe("");
  await act(async () => {
    slow.resolve();
    await pending;
  });
  expect(params.pdfCanvasRef.current!.width).toBe(oldWidth);
  expect(params.textLayerRef.current!.textContent).toBe("Second source");
  expect(params.textLayerRef.current!.style.getPropertyValue("--total-scale-factor")).toBe("0.64");
  expect(painted).toHaveBeenCalledTimes(oldPaints + 1);
});

it("never paints a superseded PDF after a newer paper is ready", async () => {
  queuePdf("First source", 600);
  await act(async () => open("first"));
  const slow = deferred();
  queuePdf("Stale source", 900, slow.promise);
  let pending!: Promise<void>;
  await act(async () => {
    pending = open("second", true);
  });
  queuePdf("Latest source", 700);
  await act(async () => open("third", true));
  const paints = painted.mock.calls.length;
  await act(async () => {
    slow.resolve();
    await pending;
  });
  expect(params.textLayerRef.current!.textContent).toBe("Latest source");
  expect(painted).toHaveBeenCalledTimes(paints);
  expect(params.onProgress).not.toHaveBeenCalledWith(
    expect.anything(),
    expect.anything(),
    expect.objectContaining({ sessionId: "second" }),
    expect.anything(),
  );
});

it("preserves the user's fit or manual view across PDFs of different sizes", async () => {
  queuePdf("First", 600);
  await act(async () => open("first"));
  expect(params.onProgress).toHaveBeenLastCalledWith(1, 0.96, expect.anything(), "fit");
  queuePdf("Second", 900);
  await act(async () => open("second", true, 2));
  expect(params.onProgress).toHaveBeenLastCalledWith(1, 0.64, expect.anything(), "fit");
  await act(async () => model.applyZoom(1.5));
  queuePdf("Third", 700);
  await act(async () => open("third", true));
  expect(model.zoom).toBe(1.5);
  expect(params.onProgress).toHaveBeenLastCalledWith(1, 1.5, expect.anything(), "manual");
  await act(async () => model.fitWidth());
  expect(params.onProgress).toHaveBeenLastCalledWith(1, 576 / 700, expect.anything(), "fit");
});

it("keeps the whole document extent while scrolling and releases distant rasters", async () => {
  const pages = queueMultiPagePdf(Array(20).fill(800));
  await act(async () => open("long", false, 1));
  const root = params.pdfPagesRef.current!;
  const stage = params.pdfStageRef.current!;
  const firstFrame = root.children[0];
  expect(root.children).toHaveLength(20);
  expect((root.children[1] as HTMLElement).style.width).toBe("900px");
  expect(pages.filter((page) => page.render.mock.calls.length)).toHaveLength(2);
  stage.scrollTop = 4 * 824 + 200;
  await act(async () => model.handleStageScroll());
  expect(model.page).toBe(5);
  expect(stage.scrollTop).toBe(4 * 824 + 200);
  expect(root.children).toHaveLength(20);
  expect(root.children[0]).toBe(firstFrame);
  expect(firstFrame.querySelector("canvas")!.width).toBe(0);
  expect(params.textLayerRef.current!.textContent).toBe("Source page 5");
  expect(model.getRenderedPages().length).toBeLessThanOrEqual(4);
  expect(params.onProgress).toHaveBeenLastCalledWith(
    5,
    1,
    expect.objectContaining({ sessionId: "long" }),
    "manual",
  );
});

it("navigates by actual mixed page heights and keeps the within-page position when zooming", async () => {
  queueMultiPagePdf([800, 500, 1000, 800, 800]);
  await act(async () => open("mixed", false, 1));
  await act(async () => model.renderPage(3, true));
  const stage = params.pdfStageRef.current!;
  expect(stage.scrollTop).toBe(800 + 24 + 500 + 24);
  stage.scrollTop += 400;
  await act(async () => model.handleStageScroll());
  await act(async () => model.applyZoom(2));
  expect(model.page).toBe(3);
  expect(stage.scrollTop).toBe(1600 + 24 + 1000 + 24 + 800);
  expect(params.pdfPagesRef.current!.children).toHaveLength(5);
});

it("fits the widest page so mixed portrait and landscape pages stay within the stage", async () => {
  queueMultiPagePdf([800, 500, 1000]);
  await act(async () => open("mixed-fit"));
  expect(model.zoom).toBeCloseTo(576 / 900);
  expect(params.pdfPagesRef.current!.style.width).toBe("576px");
});

it("resolves a selection from its own page even while the toolbar points to its neighbor", async () => {
  queueMultiPagePdf([800, 800, 800]);
  await act(async () => open("selection", false, 1));
  expect(model.page).toBe(1);
  const span = params.pdfPagesRef.current!.children[1].querySelector("span")!;
  const range = document.createRange();
  range.selectNodeContents(span);
  window.getSelection()!.addRange(range);
  expect(model.getSelectionPage()?.number).toBe(2);
  window.getSelection()!.removeAllRanges();
});

it("does not paint an old overscan render after scrolling away and changing papers", async () => {
  const slow = deferred();
  queueMultiPagePdf(Array(10).fill(800), { number: 2, promise: slow.promise });
  await act(async () => open("long", false, 1));
  const oldFrame = params.pdfPagesRef.current!.children[1];
  params.pdfStageRef.current!.scrollTop = 5 * 824;
  await act(async () => model.handleStageScroll());
  queuePdf("Replacement source", 600);
  await act(async () => open("replacement", true));
  await act(async () => slow.resolve());
  expect(params.textLayerRef.current!.textContent).toBe("Replacement source");
  expect(oldFrame.querySelector("span")).toBeNull();
  expect(params.pdfPagesRef.current!.children).toHaveLength(1);
});

it("bounds rasters and cached bitmaps through 30 pages without emitting events for every scroll", async () => {
  queueMultiPagePdf(Array(30).fill(800));
  await act(async () => open("thirty", false, 1));
  const stage = params.pdfStageRef.current!;
  for (let page = 1; page <= 30; page++) {
    stage.scrollTop = (page - 1) * 824;
    await act(async () => model.handleStageScroll());
    const events = vi.mocked(params.onPageChange).mock.calls.length;
    stage.scrollTop += 50;
    await act(async () => model.handleStageScroll());
    expect(vi.mocked(params.onPageChange).mock.calls.length).toBe(events);
    expect(model.getRenderedPages().length).toBeLessThanOrEqual(3);
  }
  const bitmaps = await Promise.all(
    vi.mocked(createImageBitmap).mock.results.map((result) => result.value),
  );
  expect(
    bitmaps.filter((bitmap) => vi.mocked(bitmap.close).mock.calls.length === 0).length,
  ).toBeLessThanOrEqual(8);
  expect(params.pdfPagesRef.current!.children).toHaveLength(30);
  expect(model.page).toBe(30);
  expect(params.onPageChange).toHaveBeenCalledTimes(30);
});
