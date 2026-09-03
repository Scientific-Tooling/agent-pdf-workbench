// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { buildAnchor, renderAnnotationLayer, resolveAnchorOffsets } from "./annotation-helpers";
import type { Annotation, TextAnchor } from "../types/types";

function anchor(overrides: Partial<TextAnchor> = {}): TextAnchor {
  return { quote: "", start: null, end: null, prefix: "", suffix: "", ...overrides };
}

function annotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: "ann_1",
    page: 1,
    type: "highlight",
    quote: "attention",
    anchor: null,
    comment: "",
    tags: [],
    rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.05 }],
    createdAt: "2026-09-02T10:00:00+00:00",
    updatedAt: "2026-09-02T10:00:00+00:00",
    ...overrides,
  };
}

describe("resolveAnchorOffsets", () => {
  const pageText = "We propose the Transformer, a model architecture eschewing recurrence.";

  it("keeps stored offsets when the text still matches", () => {
    const start = pageText.indexOf("Transformer");
    const resolved = resolveAnchorOffsets(
      anchor({ quote: "Transformer", start, end: start + "Transformer".length }),
      pageText,
    );
    expect(resolved).toEqual({ start, end: start + "Transformer".length });
  });

  it("recovers the quote when stored offsets have drifted", () => {
    const resolved = resolveAnchorOffsets(
      anchor({ quote: "recurrence", start: 3, end: 13 }),
      pageText,
    );
    const expectedStart = pageText.indexOf("recurrence");
    expect(resolved).toEqual({ start: expectedStart, end: expectedStart + "recurrence".length });
  });

  it("uses prefix and suffix context to pick between repeated quotes", () => {
    const repeated = "the model is the model again";
    const secondStart = repeated.lastIndexOf("the model");
    const resolved = resolveAnchorOffsets(
      anchor({ quote: "the model", prefix: "is ", suffix: " again" }),
      repeated,
    );
    expect(resolved).toEqual({ start: secondStart, end: secondStart + "the model".length });
  });

  it("falls back to the first occurrence when context does not match", () => {
    const repeated = "the model is the model again";
    const resolved = resolveAnchorOffsets(
      anchor({ quote: "the model", prefix: "nope " }),
      repeated,
    );
    expect(resolved).toEqual({ start: 0, end: "the model".length });
  });

  it("tolerates whitespace differences between the quote and the page text", () => {
    const start = pageText.indexOf("a model architecture");
    const resolved = resolveAnchorOffsets(
      anchor({
        quote: "a  model\n architecture",
        start,
        end: start + "a model architecture".length,
      }),
      pageText,
    );
    expect(resolved).toEqual({ start, end: start + "a model architecture".length });
  });

  it("keeps the stored range when the quote is gone from the page", () => {
    const resolved = resolveAnchorOffsets(
      anchor({ quote: "not here", start: 2, end: 9 }),
      pageText,
    );
    expect(resolved).toEqual({ start: 2, end: 9 });
  });

  it("returns null when there is neither a usable quote nor a range", () => {
    expect(resolveAnchorOffsets(anchor({ quote: "not here" }), pageText)).toBeNull();
    expect(resolveAnchorOffsets(anchor({ quote: "   " }), pageText)).toBeNull();
  });
});

describe("buildAnchor", () => {
  const pageText = "0123456789abcdefghijABCDEFGHIJ";
  const cache = new Map<number, string>([[1, pageText]]);

  it("captures bounded prefix and suffix context around the quote", () => {
    const built = buildAnchor("abcde", 10, 15, 1, cache, 4);
    expect(built).toEqual({
      quote: "abcde",
      start: 10,
      end: 15,
      prefix: "6789",
      suffix: "fghi",
    });
  });

  it("clamps context at the page boundaries", () => {
    const built = buildAnchor("012", 0, 3, 1, cache, 8);
    expect(built.prefix).toBe("");
    expect(built.suffix).toBe("3456789a");
  });

  it("clamps offsets that run past the end of the page text", () => {
    const built = buildAnchor("tail", 25, 999, 1, cache, 3);
    expect(built.start).toBe(25);
    expect(built.end).toBe(pageText.length);
  });

  it("returns a rect-only anchor when offsets are unusable", () => {
    expect(buildAnchor("q", null, null, 1, cache, 4)).toEqual({
      quote: "q",
      start: null,
      end: null,
      prefix: "",
      suffix: "",
    });
    expect(buildAnchor("q", 9, 4, 1, cache, 4).start).toBeNull();
  });

  it("survives a page whose text has not been cached yet", () => {
    expect(buildAnchor("q", 1, 4, 99, cache, 4)).toEqual({
      quote: "q",
      start: 0,
      end: 0,
      prefix: "",
      suffix: "",
    });
  });
});

describe("renderAnnotationLayer", () => {
  function layers() {
    const annotationLayer = document.createElement("div");
    const textLayer = document.createElement("div");
    Object.defineProperty(textLayer, "clientWidth", { value: 800, configurable: true });
    Object.defineProperty(textLayer, "clientHeight", { value: 1000, configurable: true });
    return { annotationLayer, textLayer };
  }

  it("falls back to stored rectangles when the anchor cannot be resolved", () => {
    const { annotationLayer, textLayer } = layers();
    renderAnnotationLayer({
      annotationLayer,
      textLayer,
      annotations: [annotation()],
      page: 1,
      selectedAnnotationId: null,
      pageTextCache: new Map(),
      onSelectAnnotation: () => {},
    });

    const marks = annotationLayer.querySelectorAll(".annotation-mark");
    expect(marks).toHaveLength(1);
    const mark = marks[0] as HTMLElement;
    expect(mark.className).toContain("highlight");
    expect(mark.style.left).toBe("80px");
    expect(mark.style.top).toBe("200px");
    expect(mark.style.width).toBe("240px");
    expect(mark.style.height).toBe("50px");
  });

  it("renders only the annotations on the current page", () => {
    const { annotationLayer, textLayer } = layers();
    renderAnnotationLayer({
      annotationLayer,
      textLayer,
      annotations: [annotation({ id: "a" }), annotation({ id: "b", page: 2 })],
      page: 1,
      selectedAnnotationId: null,
      pageTextCache: new Map(),
      onSelectAnnotation: () => {},
    });
    expect(annotationLayer.querySelectorAll(".annotation-mark")).toHaveLength(1);
  });

  it("marks the selected annotation and reports clicks", () => {
    const { annotationLayer, textLayer } = layers();
    const onSelectAnnotation = vi.fn();
    renderAnnotationLayer({
      annotationLayer,
      textLayer,
      annotations: [annotation({ id: "ann_selected", type: "underline" })],
      page: 1,
      selectedAnnotationId: "ann_selected",
      pageTextCache: new Map(),
      onSelectAnnotation,
    });

    const mark = annotationLayer.querySelector(".annotation-mark") as HTMLElement;
    expect(mark.className).toContain("underline");
    expect(mark.classList.contains("selected")).toBe(true);

    mark.click();
    expect(onSelectAnnotation).toHaveBeenCalledWith("ann_selected");
  });

  it("clears previous marks on every render", () => {
    const { annotationLayer, textLayer } = layers();
    const params = {
      annotationLayer,
      textLayer,
      annotations: [annotation()],
      page: 1,
      selectedAnnotationId: null,
      pageTextCache: new Map<number, string>(),
      onSelectAnnotation: () => {},
    };
    renderAnnotationLayer(params);
    renderAnnotationLayer({ ...params, annotations: [] });
    expect(annotationLayer.querySelectorAll(".annotation-mark")).toHaveLength(0);
  });
});
