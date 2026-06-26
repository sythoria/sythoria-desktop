import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { X } from "lucide-react";
import { springs, motionTokens } from "../../lib/motion-tokens";

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
  error: "border-red-500/30 bg-red-50 dark:bg-red-950/80 text-red-700 dark:text-red-300",
  success: "border-emerald-500/30 bg-emerald-50 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300",
  info: "border-border bg-surface text-text-primary",
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
    <motion.div
      className={`flex items-start gap-2.5 px-4 py-3 rounded-xl border shadow-lg ${VARIANT_STYLES[toast.variant]}`}
      role="alert"
      aria-live="assertive"
      layout
      initial={{ opacity: 0, x: motionTokens.distance.xl, scale: motionTokens.scale.subtle }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: motionTokens.distance.xl, scale: motionTokens.scale.subtle }}
      transition={springs.snappy}
    >
      <p className="flex-1 text-sm leading-relaxed">{toast.message}</p>
      <button
        onClick={() => onDismiss(toast.id)}
        className="shrink-0 p-0.5 rounded hover:bg-hover transition-colors text-text-muted hover:text-text-primary"
        aria-label="Dismiss notification"
      >
        <X size={14} />
      </button>
    </motion.div>
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
