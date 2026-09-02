import { useState } from "react";

import type { ToastType } from "../app/app-types";
import { uid } from "../utils/main-utils";

export interface ToastMessage {
  id: string;
  message: string;
  type: ToastType;
}

/** Beyond two cards the stack stops informing and starts covering the workspace. */
const MAX_VISIBLE_TOASTS = 2;

export function useToastStack() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  function showToast(message: string, type: ToastType = "info", timeoutMs = 2200): void {
    const id = uid("toast");
    setToasts((prev) => {
      // A newer message of the same kind supersedes the one still on screen:
      // three writes in a row should read as one running confirmation, not as
      // three cards stacked over the notes list.
      const superseded = prev.filter((toast) => toast.type !== type);
      return [...superseded, { id, message, type }].slice(-MAX_VISIBLE_TOASTS);
    });
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, timeoutMs);
  }

  return {
    toasts,
    showToast,
  };
}
