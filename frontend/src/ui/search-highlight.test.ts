// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { applySearchHighlightsToCurrentPage } from "./search-highlight";
import type { SearchResult } from "../types/types";

function appendSpan(
  textLayer: HTMLDivElement,
  { content, start, end }: { content: string; start: number; end: number },
): HTMLSpanElement {
  const span = document.createElement("span");
  span.dataset.content = content;
  span.dataset.start = String(start);
  span.dataset.end = String(end);
  textLayer.appendChild(span);
  return span;
}

describe("applySearchHighlightsToCurrentPage", () => {
  it("marks matching spans and the current hit for the active result", () => {
    const textLayer = document.createElement("div");
    const first = appendSpan(textLayer, { content: "alpha", start: 0, end: 5 });
    const second = appendSpan(textLayer, { content: "attention", start: 6, end: 15 });
    const third = appendSpan(textLayer, { content: "attention again", start: 16, end: 31 });

    const results: SearchResult[] = [{ page: 1, snippet: "attention", matchIndex: 17 }];

    applySearchHighlightsToCurrentPage({
      textLayer,
      query: "attention",
      results,
      cursor: 0,
      page: 1,
    });

    expect(first.classList.contains("search-hit")).toBe(false);
    expect(second.classList.contains("search-hit")).toBe(true);
    expect(third.classList.contains("search-hit")).toBe(true);
    expect(second.classList.contains("current-hit")).toBe(false);
    expect(third.classList.contains("current-hit")).toBe(true);
  });

  it("does not mark a current hit when active result is on another page", () => {
    const textLayer = document.createElement("div");
    const first = appendSpan(textLayer, { content: "attention", start: 0, end: 9 });
    const second = appendSpan(textLayer, { content: "attention", start: 10, end: 19 });

    const results: SearchResult[] = [{ page: 2, snippet: "attention", matchIndex: 0 }];

    applySearchHighlightsToCurrentPage({
      textLayer,
      query: "attention",
      results,
      cursor: 0,
      page: 1,
    });

    expect(first.classList.contains("search-hit")).toBe(true);
    expect(second.classList.contains("search-hit")).toBe(true);
    expect(textLayer.querySelector(".current-hit")).toBeNull();
  });

  it("clears existing highlight classes when query is empty", () => {
    const textLayer = document.createElement("div");
    const span = appendSpan(textLayer, { content: "attention", start: 0, end: 9 });
    span.classList.add("search-hit", "current-hit");

    applySearchHighlightsToCurrentPage({
      textLayer,
      query: "",
      results: [],
      cursor: 0,
      page: 1,
    });

    expect(span.classList.contains("search-hit")).toBe(false);
    expect(span.classList.contains("current-hit")).toBe(false);
  });
});
