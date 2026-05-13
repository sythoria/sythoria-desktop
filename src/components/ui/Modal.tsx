import React, { useEffect } from "react";
import { X, AlertTriangle } from "lucide-react";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export function Modal({ isOpen, onClose, title, children }: ModalProps) {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      document.body.style.overflow = "hidden";
    }

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "unset";
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-md"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-lg rounded-2xl bg-surface border border-border shadow-2xl animate-in fade-in zoom-in duration-200 overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="text-lg font-semibold text-text-primary px-2">{title}</h3>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-text-muted hover:text-text-primary hover:bg-hover transition-colors"
          >
            <X size={20} />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: "danger" | "default";
}

export function ConfirmModal({
  isOpen,
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  onConfirm,
  onCancel,
  variant = "default",
}: ConfirmModalProps) {
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };

    document.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "unset";
    };
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-md"
        onClick={onCancel}
      />
      <div className="relative z-10 w-full max-w-sm rounded-2xl bg-surface border border-border shadow-2xl animate-in fade-in zoom-in duration-200 overflow-hidden">
        {variant === "danger" && (
          <div className="h-1.5 w-full bg-red-500" />
        )}
        <div className="p-6">
          <div className="flex items-center gap-3 mb-4">
            {variant === "danger" && (
              <div className="p-2.5 rounded-full bg-red-500/10 text-red-500">
                <AlertTriangle size={22} />
              </div>
            )}
            <h3 className="text-xl font-bold text-text-primary">
              {title}
            </h3>
          </div>
          <p className="text-text-secondary mb-8 leading-relaxed">
            {message}
          </p>
          <div className="flex gap-3">
            <button
              onClick={onCancel}
              className="flex-1 px-4 py-2.5 rounded-xl border border-border text-text-secondary font-medium hover:bg-hover transition-all active:scale-95"
            >
              {cancelText}
            </button>
            <button
              onClick={onConfirm}
              className={`flex-1 px-4 py-2.5 rounded-xl font-medium transition-all active:scale-95 ${
                variant === "danger"
                  ? "bg-red-500 text-white hover:bg-red-600 shadow-lg shadow-red-500/25"
                  : "bg-accent text-white hover:bg-accent-hover shadow-lg shadow-accent/25"
              }`}
            >
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

