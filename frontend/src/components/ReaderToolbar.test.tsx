/** @vitest-environment jsdom */
import { act, createRef, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useGlobalWorkspaceShortcuts } from "../hooks/useGlobalWorkspaceShortcuts";
import type { PDFDocumentProxy } from "../types/pdfjs-types";
import type { ReaderPanelProps } from "./ReaderPanel";
import { ReaderToolbar } from "./ReaderToolbar";

let container: HTMLDivElement;
let root: Root;
let props: ReaderPanelProps;
function Harness() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (open) props.searchInputRef.current?.focus();
  }, [open]);
  useGlobalWorkspaceShortcuts({
    quickAnnotatorRef: props.quickAnnotatorRef,
    textLayerRef: props.textLayerRef,
    onHideQuickAnnotator: props.onHideQuickAnnotator,
    onGoNextPage: props.onGoNextPage,
    onGoPrevPage: props.onGoPrevPage,
    onToggleShortcuts: vi.fn(),
    onFocusSearch: () => setOpen(true),
  });
  return (
    <ReaderToolbar
      {...props}
      searchOpen={open}
      onOpenSearch={() => setOpen(true)}
      onCloseSearch={() => {
        props.onCloseSearch();
        setOpen(false);
        document.getElementById("findInDocumentBtn")?.focus();
      }}
    />
  );
}
beforeEach(async () => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  props = {
    paperTitle: "A long paper title that remains available",
    paperByline: "A Researcher · Journal · 2024",
    focusMode: false,
    pdfDoc: { numPages: 3 } as PDFDocumentProxy,
    page: 1,
    pageJumpInput: "1",
    zoom: 1,
    searchOpen: false,
    searchInputValue: "source",
    searchQuery: "",
    searchResultsCount: 0,
    searchCursor: 0,
    searchInfoText: "",
    loadingCount: 0,
    stageLoadingLabel: "",
    quickVisible: false,
    quickLeft: 0,
    quickTop: 0,
    quickCommentInput: "",
    hasPendingSelection: false,
    controlsOpen: true,
    workspaceOpen: true,
    canToggleControls: true,
    searchInputRef: createRef(),
    toolbarRef: createRef(),
    pdfStageRef: createRef(),
    pdfCanvasRef: createRef(),
    textLayerRef: createRef(),
    annotationLayerRef: createRef(),
    quickAnnotatorRef: createRef(),
    onOpenSearch: vi.fn(),
    onCloseSearch: vi.fn(),
    onToggleFocus: vi.fn(),
    onToggleControls: vi.fn(),
    onToggleWorkspace: vi.fn(),
    onPageJumpInputChange: vi.fn(),
    onSearchInputValueChange: vi.fn(),
    onQuickCommentInputChange: vi.fn(),
    onGoPrevPage: vi.fn(async () => {}),
    onGoNextPage: vi.fn(async () => {}),
    onJumpToPageInput: vi.fn(async () => {}),
    onApplyZoom: vi.fn(async () => {}),
    onFitWidth: vi.fn(async () => {}),
    onRunSearch: vi.fn(async () => {}),
    onJumpToSearchResult: vi.fn(async () => {}),
    onTextLayerCopy: vi.fn(async () => {}),
    onTextLayerMouseUp: vi.fn(),
    onQuickHighlight: vi.fn(async () => {}),
    onQuickUnderline: vi.fn(async () => {}),
    onHideQuickAnnotator: vi.fn(),
    onError: vi.fn(),
  };
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function key(target: Element, value: string, options: KeyboardEventInit = {}) {
  await act(async () => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...options }),
    );
  });
}

it("reveals document search from a shortcut and returns focus when dismissed", async () => {
  expect(container.querySelector("#searchInput")).toBeNull();
  await key(container, "f");
  const input = container.querySelector("#searchInput")!;
  expect(document.activeElement).toBe(input);
  await key(input, "Escape");
  expect(props.onCloseSearch).toHaveBeenCalledOnce();
  expect(container.querySelector("#searchInput")).toBeNull();
  expect(document.activeElement?.id).toBe("findInDocumentBtn");
  await key(container.querySelector("#pageJumpInput")!, "f", { ctrlKey: true });
  expect(document.activeElement?.id).toBe("searchInput");
});
it("keeps typing shortcuts out of fields and searches with Enter", async () => {
  await key(container.querySelector("#pageJumpInput")!, "f");
  expect(container.querySelector("#searchInput")).toBeNull();
  await act(async () => {
    (container.querySelector("#findInDocumentBtn") as HTMLButtonElement).click();
  });
  await key(container.querySelector("#searchInput")!, "Enter");
  expect(props.onRunSearch).toHaveBeenCalledWith("source");
});
it("keeps page boundaries and reports failed search without an unhandled rejection", async () => {
  expect((container.querySelector("#prevBtn") as HTMLButtonElement).disabled).toBe(true);
  expect((container.querySelector("#nextBtn") as HTMLButtonElement).disabled).toBe(false);
  const error = new Error("Search unavailable");
  vi.mocked(props.onRunSearch).mockRejectedValue(error);
  await key(container, "/");
  await key(container.querySelector("#searchInput")!, "Enter");
  expect(props.onError).toHaveBeenCalledWith(error, "Could not update the reader");
});
