import { useEffect } from "react";
import type { RefObject } from "react";

interface UseGlobalWorkspaceShortcutsParams {
  quickAnnotatorRef: RefObject<HTMLDivElement | null>;
  textLayerRef: RefObject<HTMLDivElement | null>;
  searchInputRef: RefObject<HTMLInputElement | null>;
  onHideQuickAnnotator: () => void;
  onGoNextPage: () => Promise<void>;
  onGoPrevPage: () => Promise<void>;
}

export function useGlobalWorkspaceShortcuts(params: UseGlobalWorkspaceShortcutsParams) {
  const {
    quickAnnotatorRef,
    textLayerRef,
    searchInputRef,
    onHideQuickAnnotator,
    onGoNextPage,
    onGoPrevPage,
  } = params;

  useEffect(() => {
    function onMouseDown(event: MouseEvent): void {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (
        (quickAnnotatorRef.current && quickAnnotatorRef.current.contains(target)) ||
        (textLayerRef.current && textLayerRef.current.contains(target))
      ) {
        return;
      }
      onHideQuickAnnotator();
    }

    function focusSearch(): void {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }

    async function onKeyDown(event: KeyboardEvent): Promise<void> {
      const target = event.target as HTMLElement | null;
      const editable =
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

      // Ctrl/Cmd+F reaches the document search even from a text field, because
      // in a reader that is what the shortcut is expected to do.
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        focusSearch();
        return;
      }
      if (editable) {
        return;
      }
      if (event.key === "j") {
        event.preventDefault();
        await onGoNextPage();
        return;
      }
      if (event.key === "k") {
        event.preventDefault();
        await onGoPrevPage();
        return;
      }
      if (event.key === "f" || event.key === "/") {
        event.preventDefault();
        focusSearch();
        return;
      }
      if (event.key === "Escape") {
        onHideQuickAnnotator();
      }
    }

    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [
    onGoNextPage,
    onGoPrevPage,
    onHideQuickAnnotator,
    quickAnnotatorRef,
    searchInputRef,
    textLayerRef,
  ]);
}
