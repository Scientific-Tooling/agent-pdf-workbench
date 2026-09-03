import type { SearchResult } from "../types/types";

interface SearchHighlightParams {
  textLayer: HTMLDivElement;
  query: string;
  results: SearchResult[];
  cursor: number;
  page: number;
}

export function applySearchHighlightsToCurrentPage(params: SearchHighlightParams): void {
  const { textLayer, query, results, cursor, page } = params;
  const normalizedQuery = query.trim().toLowerCase();
  const spans = Array.from(textLayer.querySelectorAll("span"));
  const activeResult = results[cursor] ?? null;
  let markedCurrent = false;
  for (const span of spans) {
    span.classList.remove("search-hit");
    span.classList.remove("current-hit");
    const text = (span as HTMLElement).dataset.content ?? "";
    if (normalizedQuery && text.toLowerCase().includes(normalizedQuery)) {
      span.classList.add("search-hit");
      if (activeResult && activeResult.page === page) {
        const start = Number((span as HTMLElement).dataset.start ?? "-1");
        const end = Number((span as HTMLElement).dataset.end ?? "-1");
        if (
          !markedCurrent &&
          Number.isFinite(start) &&
          Number.isFinite(end) &&
          activeResult.matchIndex >= start &&
          activeResult.matchIndex < end
        ) {
          span.classList.add("current-hit");
          markedCurrent = true;
        }
      }
    }
  }
  if (!markedCurrent && activeResult && activeResult.page === page) {
    const firstHit = textLayer.querySelector("span.search-hit");
    if (firstHit) {
      firstHit.classList.add("current-hit");
    }
  }
}
