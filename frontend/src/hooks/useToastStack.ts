import { useState } from "react";

import type { ToastType } from "../app/app-types";
import { uid } from "../utils/main-utils";

export interface ToastMessage {
  id: string;
  message: string;
  type: ToastType;
}

export function useToastStack() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  function showToast(message: string, type: ToastType = "info", timeoutMs = 2200): void {
    const id = uid("toast");
    setToasts((prev) => [...prev, { id, message, type }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, timeoutMs);
  }

  return {
    toasts,
    showToast,
  };
}
