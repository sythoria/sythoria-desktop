import React, { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

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
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-md rounded-xl bg-surface border border-border shadow-xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h3 className="text-sm font-medium text-text-primary">{title}</h3>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-hover transition-colors"
          >
            <X size={16} />
          </button>
        </div>
        <div className="p-5">{children}</div>
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
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onCancel}
      />
      <div className="relative z-10 w-full max-w-sm rounded-xl bg-surface border border-border shadow-xl">
        <div className="px-5 pt-5 pb-1">
          <h3 className="text-sm font-semibold text-text-primary">
            {title}
          </h3>
          <p className="mt-1.5 text-xs text-text-muted leading-relaxed">
            {message}
          </p>
        </div>
        <div className="flex gap-2 p-4 pt-3">
          <button
            onClick={onCancel}
            className="flex-1 px-3 py-1.5 rounded-lg text-xs font-medium text-text-secondary hover:bg-hover transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              variant === "danger"
                ? "bg-red-500/10 text-red-500 hover:bg-red-500/20"
                : "bg-accent/10 text-accent hover:bg-accent/20"
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

interface RenameChatModalProps {
  isOpen: boolean;
  currentTitle: string;
  onConfirm: (newTitle: string) => void;
  onCancel: () => void;
}

export function RenameChatModal({
  isOpen,
  currentTitle,
  onConfirm,
  onCancel,
}: RenameChatModalProps) {
  const [value, setValue] = useState(currentTitle);
  const inputRef = useRef<HTMLInputElement>(null);
  const isEmpty = value.trim().length === 0;

  useEffect(() => {
    if (!isOpen) return;

    setValue(currentTitle);

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };

    document.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";

    requestAnimationFrame(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    });

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "unset";
    };
  }, [isOpen, currentTitle, onCancel]);

  if (!isOpen) return null;

  const handleConfirm = () => {
    if (!isEmpty) {
      onConfirm(value.trim());
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onCancel}
      />
      <div className="relative z-10 w-full max-w-sm rounded-xl bg-surface border border-border shadow-xl">
        <div className="px-5 pt-5 pb-1">
          <h3 className="text-sm font-semibold text-text-primary">
            Rename Chat
          </h3>
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="mt-3 w-full px-3 py-1.5 rounded-lg text-sm bg-input border border-input-border text-text-primary placeholder-text-muted focus:border-accent/50 focus:outline-none transition-colors"
            placeholder="Enter new title"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleConfirm();
              if (e.key === "Escape") onCancel();
            }}
          />
        </div>
        <div className="flex gap-2 p-4 pt-3">
          <button
            onClick={onCancel}
            className="flex-1 px-3 py-1.5 rounded-lg text-xs font-medium text-text-secondary hover:bg-hover transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={isEmpty}
            className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              isEmpty
                ? "bg-accent/10 text-accent/40 cursor-not-allowed"
                : "bg-accent/10 text-accent hover:bg-accent/20"
            }`}
          >
            Rename
          </button>
        </div>
      </div>
    </div>
  );
}
