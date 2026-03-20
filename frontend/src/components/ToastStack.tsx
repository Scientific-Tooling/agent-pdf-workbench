import type { ToastMessage } from "../hooks/useToastStack";

interface ToastStackProps {
  toasts: ToastMessage[];
}

export function ToastStack({ toasts }: ToastStackProps) {
  return (
    <div id="toastStack" className="toast-stack" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.type === "info" ? "" : toast.type}`.trim()}>
          {toast.message}
        </div>
      ))}
    </div>
  );
}
