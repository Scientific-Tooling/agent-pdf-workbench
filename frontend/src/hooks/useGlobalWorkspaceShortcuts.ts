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

    async function onKeyDown(event: KeyboardEvent): Promise<void> {
      const target = event.target as HTMLElement | null;
      const editable =
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
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
      if (event.key === "f") {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
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
  }, [onGoNextPage, onGoPrevPage, onHideQuickAnnotator, quickAnnotatorRef, searchInputRef, textLayerRef]);
}
