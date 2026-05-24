import { useEffect, useRef } from "react";
import { X } from "lucide-react";

export interface Toast {
  id: string;
  message: string;
  variant: "error" | "success" | "info";
}

interface ToastContainerProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

const VARIANT_STYLES: Record<Toast["variant"], string> = {
  error: "border-red-500/30 bg-red-500/10 text-red-400",
  success: "border-green-500/30 bg-green-500/10 text-green-400",
  info: "border-accent/30 bg-accent-soft text-text-secondary",
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    timerRef.current = setTimeout(() => onDismiss(toast.id), 5000);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [toast.id, onDismiss]);

  return (
    <div
      className={`flex items-start gap-2.5 px-4 py-3 rounded-xl border shadow-lg backdrop-blur-md animate-slide-up ${VARIANT_STYLES[toast.variant]}`}
      role="alert"
      aria-live="assertive"
    >
      <p className="flex-1 text-sm leading-relaxed">{toast.message}</p>
      <button
        onClick={() => onDismiss(toast.id)}
        className="shrink-0 p-0.5 rounded hover:bg-white/10 transition-colors"
        aria-label="Dismiss notification"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-20 right-4 z-50 flex flex-col gap-2 w-full max-w-sm pointer-events-none"
      aria-label="Notifications"
    >
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <ToastItem toast={t} onDismiss={onDismiss} />
        </div>
      ))}
    </div>
  );
}
