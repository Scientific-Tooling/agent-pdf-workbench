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
  container.append(stage, canvas, text, annotations);
  painted = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    return {
      drawImage: (...args: unknown[]) => {
        if (this === canvas) painted(...args);
      },
    } as unknown as CanvasRenderingContext2D;
  });
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ close: vi.fn() })),
  );
  params = {
    pdfStageRef: createRef(),
    pdfCanvasRef: createRef(),
    textLayerRef: createRef(),
    annotationLayerRef: createRef(),
    onProgress: vi.fn(),
    onPageChange: vi.fn().mockResolvedValue(undefined),
    onZoomChange: vi.fn().mockResolvedValue(undefined),
  };
  params.pdfStageRef.current = stage;
  params.pdfCanvasRef.current = canvas;
  params.textLayerRef.current = text;
  params.annotationLayerRef.current = annotations;
  await act(async () => {
    root.render(createElement(Harness));
  });
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
