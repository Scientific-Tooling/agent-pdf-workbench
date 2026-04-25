import type { OutlineItem, RecentPaper, SearchResult, Annotation, Note } from "../types/types";

interface RecentListParams {
  recentList: HTMLUListElement;
  recent: RecentPaper[];
  onLoadPaper: (paper: RecentPaper) => void;
}

export function renderRecentList(params: RecentListParams): void {
  const { recentList, recent, onLoadPaper } = params;
  recentList.innerHTML = "";
  if (recent.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No recent papers";
    li.classList.add("muted");
    recentList.appendChild(li);
    return;
  }

  for (const paper of recent) {
    const li = document.createElement("li");
    const title = document.createElement("div");
    title.textContent = `${paper.paperRef} (p.${paper.lastPage})`;
    li.appendChild(title);

    const meta = document.createElement("div");
    meta.textContent = paper.pdfUri;
    meta.classList.add("muted");
    li.appendChild(meta);

    const button = document.createElement("button");
    button.textContent = "Load";
    button.addEventListener("click", () => {
      onLoadPaper(paper);
    });
    li.appendChild(button);
    recentList.appendChild(li);
  }
}

interface AnnotationListParams {
  annotationList: HTMLUListElement;
  annotations: Annotation[];
  selectedAnnotationId: string | null;
  onJumpToAnnotation: (annotationId: string) => Promise<void>;
  onSelectAnnotation: (annotationId: string) => void;
}

export function renderAnnotationList(params: AnnotationListParams): void {
  const { annotationList, annotations, selectedAnnotationId, onJumpToAnnotation, onSelectAnnotation } = params;
  annotationList.innerHTML = "";
  const sorted = annotations.slice().sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

  if (sorted.length === 0) {
    const li = document.createElement("li");
    li.classList.add("muted");
    li.textContent = "No annotations yet";
    annotationList.appendChild(li);
    return;
  }

  for (const annotation of sorted) {
    const li = document.createElement("li");
    if (annotation.id === selectedAnnotationId) {
      li.style.borderColor = "#0ea5e9";
    }
    const line1 = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = annotation.type;
    line1.appendChild(strong);
    line1.append(` | p.${annotation.page}`);
    li.appendChild(line1);

    const line2 = document.createElement("div");
    line2.textContent = annotation.quote || "(empty quote)";
    li.appendChild(line2);

    const line3 = document.createElement("div");
    line3.classList.add("muted");
    line3.textContent = annotation.comment || "No comment";
    li.appendChild(line3);

    if (annotation.tags.length > 0) {
      const tags = document.createElement("div");
      tags.className = "pill-list";
      for (const tag of annotation.tags) {
        const pill = document.createElement("span");
        pill.className = "pill";
        pill.textContent = tag;
        tags.appendChild(pill);
      }
      li.appendChild(tags);
    }

    const openButton = document.createElement("button");
    openButton.textContent = "Go";
    openButton.addEventListener("click", async () => {
      await onJumpToAnnotation(annotation.id);
    });
    li.appendChild(openButton);

    li.addEventListener("click", () => {
      onSelectAnnotation(annotation.id);
    });
    annotationList.appendChild(li);
  }
}

interface NotesListParams {
  notesList: HTMLUListElement;
  notes: Note[];
  selectedNoteId: string | null;
  onSelectNote: (noteId: string) => void;
  onJumpToAnnotation: (annotationId: string) => Promise<void>;
}

export function renderNotesList(params: NotesListParams): void {
  const { notesList, notes, selectedNoteId, onSelectNote, onJumpToAnnotation } = params;
  notesList.innerHTML = "";
  const sorted = notes.slice().sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

  if (sorted.length === 0) {
    const li = document.createElement("li");
    li.classList.add("muted");
    li.textContent = "No notes yet";
    notesList.appendChild(li);
    return;
  }

  for (const note of sorted) {
    const li = document.createElement("li");
    if (note.id === selectedNoteId) {
      li.style.borderColor = "#0ea5e9";
    }
    const title = document.createElement("div");
    const titleStrong = document.createElement("strong");
    titleStrong.textContent = note.title || "(untitled note)";
    title.appendChild(titleStrong);
    li.appendChild(title);

    const content = document.createElement("div");
    content.textContent = note.markdown.length > 160 ? `${note.markdown.slice(0, 160)}...` : note.markdown;
    li.appendChild(content);

    if (note.linkedAnnotationIds.length > 0) {
      const links = document.createElement("div");
      links.className = "pill-list";
      for (const annId of note.linkedAnnotationIds) {
        const button = document.createElement("button");
        button.className = "pill";
        button.textContent = annId;
        button.addEventListener("click", async (event) => {
          event.stopPropagation();
          await onJumpToAnnotation(annId);
        });
        links.appendChild(button);
      }
      li.appendChild(links);
    }

    li.addEventListener("click", () => {
      onSelectNote(note.id);
    });
    notesList.appendChild(li);
  }
}

interface SearchResultsParams {
  searchResultsList: HTMLUListElement;
  query: string;
  results: SearchResult[];
  cursor: number;
  onJumpToSearchResult: (index: number) => Promise<void>;
}

export function renderSearchResults(params: SearchResultsParams): void {
  const { searchResultsList, query, results, cursor, onJumpToSearchResult } = params;
  searchResultsList.innerHTML = "";
  if (!query) {
    const li = document.createElement("li");
    li.textContent = "No query";
    li.classList.add("muted");
    searchResultsList.appendChild(li);
    return;
  }
  if (results.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No matches";
    li.classList.add("muted");
    searchResultsList.appendChild(li);
    return;
  }

  results.forEach((result, index) => {
    const li = document.createElement("li");
    if (index === cursor) {
      li.style.borderColor = "#0ea5e9";
    }
    const line1 = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = `p.${result.page}`;
    line1.appendChild(strong);
    li.appendChild(line1);

    const line2 = document.createElement("div");
    line2.textContent = result.snippet;
    li.appendChild(line2);
    li.addEventListener("click", async () => {
      await onJumpToSearchResult(index);
    });
    searchResultsList.appendChild(li);
  });
}

interface SearchInfoParams {
  searchInfo: HTMLSpanElement;
  query: string;
  resultsCount: number;
  cursor: number;
}

export function updateSearchInfo(params: SearchInfoParams): void {
  const { searchInfo, query, resultsCount, cursor } = params;
  if (!query) {
    searchInfo.textContent = "No search";
    return;
  }
  if (resultsCount === 0) {
    searchInfo.textContent = "0 matches";
    return;
  }
  searchInfo.textContent = `${cursor + 1}/${resultsCount} matches`;
}

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

interface OutlineParams {
  outlineList: HTMLUListElement;
  outline: OutlineItem[];
  onRenderPage: (page: number) => Promise<void>;
}

export function renderOutline(params: OutlineParams): void {
  const { outlineList, outline, onRenderPage } = params;
  outlineList.innerHTML = "";
  if (outline.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No outline";
    li.classList.add("muted");
    outlineList.appendChild(li);
    return;
  }
  for (const item of outline) {
    const li = document.createElement("li");
    li.style.marginLeft = `${item.level * 12}px`;
    const btn = document.createElement("button");
    btn.textContent = `p.${item.page} ${item.title}`;
    btn.addEventListener("click", async () => {
      await onRenderPage(item.page);
    });
    li.appendChild(btn);
    outlineList.appendChild(li);
  }
}
