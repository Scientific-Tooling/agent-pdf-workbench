import { useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";

import type { SearchResult } from "../types/types";
import type { PDFDocumentProxy } from "../types/pdfjs-types";

const MAX_SEARCH_RESULTS = 300;
const SNIPPET_CONTEXT_CHARS = 40;

interface PdfSearchParams {
  pdfDocRef: MutableRefObject<PDFDocumentProxy | null>;
  pageRef: MutableRefObject<number>;
  ensurePageText: (page: number, doc?: PDFDocumentProxy) => Promise<string>;
  withStageLoading: <T>(label: string, task: () => Promise<T>) => Promise<T>;
  renderPage: (page: number, emitPageChange: boolean) => Promise<void>;
  onResultSummary: (message: string, kind: "success" | "warning") => void;
}

/** Full-text search over the open document, and navigation between hits. */
export function usePdfSearch(params: PdfSearchParams) {
  const { pdfDocRef, pageRef, ensurePageText, withStageLoading, renderPage, onResultSummary } =
    params;

  const [searchInputValue, setSearchInputValue] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchCursor, setSearchCursor] = useState(0);
  const searchRunRef = useRef(0);

  const searchInfoText = useMemo(() => {
    if (!searchQuery) {
      return "";
    }
    if (searchResults.length === 0) {
      return "0 matches";
    }
    return `${searchCursor + 1}/${searchResults.length} matches`;
  }, [searchCursor, searchQuery, searchResults.length]);

  function clearSearch(): void {
    searchRunRef.current += 1;
    setSearchInputValue("");
    setSearchQuery("");
    setSearchResults([]);
    setSearchCursor(0);
  }

  async function jumpToSearchResult(
    index: number,
    sourceResults?: SearchResult[],
    runId = searchRunRef.current,
  ): Promise<void> {
    const activeResults = sourceResults ?? searchResults;
    const activeDoc = pdfDocRef.current;
    if (activeResults.length === 0 || !activeDoc || runId !== searchRunRef.current) {
      return;
    }
    const normalized =
      ((index % activeResults.length) + activeResults.length) % activeResults.length;
    setSearchCursor(normalized);
    const target = activeResults[normalized];
    if (pageRef.current !== target.page) {
      await renderPage(target.page, true);
      if (runId !== searchRunRef.current || pdfDocRef.current !== activeDoc) {
        return;
      }
    }
  }

  function collectPageMatches(pageNumber: number, text: string, query: string): SearchResult[] {
    const lower = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const found: SearchResult[] = [];
    let startIndex = 0;
    while (found.length < MAX_SEARCH_RESULTS) {
      const hit = lower.indexOf(lowerQuery, startIndex);
      if (hit === -1) {
        break;
      }
      const snippetStart = Math.max(0, hit - SNIPPET_CONTEXT_CHARS);
      const snippetEnd = Math.min(text.length, hit + query.length + SNIPPET_CONTEXT_CHARS);
      found.push({
        page: pageNumber,
        snippet: text.slice(snippetStart, snippetEnd).replace(/\s+/g, " "),
        matchIndex: hit,
      });
      startIndex = hit + query.length;
    }
    return found;
  }

  async function runSearch(queryRaw: string): Promise<void> {
    const runId = searchRunRef.current + 1;
    searchRunRef.current = runId;
    const query = queryRaw.trim();
    setSearchQuery(query);
    setSearchResults([]);
    setSearchCursor(0);

    const activeDoc = pdfDocRef.current;
    if (!query || !activeDoc) {
      return;
    }
    const isCurrentSearch = (): boolean =>
      runId === searchRunRef.current && pdfDocRef.current === activeDoc;

    const results: SearchResult[] = [];
    await withStageLoading("Searching document...", async () => {
      for (let pageNumber = 1; pageNumber <= activeDoc.numPages; pageNumber += 1) {
        if (!isCurrentSearch()) {
          return;
        }
        const text = await ensurePageText(pageNumber, activeDoc);
        if (!isCurrentSearch()) {
          return;
        }
        for (const match of collectPageMatches(pageNumber, text, query)) {
          results.push(match);
          if (results.length >= MAX_SEARCH_RESULTS) {
            return;
          }
        }
      }
    });

    if (!isCurrentSearch()) {
      return;
    }
    setSearchResults(results);
    if (results.length > 0) {
      setSearchCursor(0);
      await jumpToSearchResult(0, results, runId);
      if (!isCurrentSearch()) {
        return;
      }
      onResultSummary(`${results.length} matches found`, "success");
    } else {
      onResultSummary("No matches found", "warning");
    }
  }

  return {
    searchInputValue,
    setSearchInputValue,
    searchQuery,
    searchResults,
    searchCursor,
    searchInfoText,
    runSearch,
    jumpToSearchResult,
    clearSearch,
  };
}
