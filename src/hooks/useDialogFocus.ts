import { RefObject, useEffect } from "react";
import { lockBodyScroll, unlockBodyScroll } from "../utils/scrollLock";

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface DialogFocusOptions {
  isOpen: boolean;
  onClose: () => void;
  containerRef: RefObject<HTMLElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
  lockScroll?: boolean;
}

export function useDialogFocus({
  isOpen,
  onClose,
  containerRef,
  initialFocusRef,
  lockScroll = true,
}: DialogFocusOptions): void {
  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !containerRef.current) return;

      const focusable = Array.from(containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) {
        event.preventDefault();
        containerRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first || !containerRef.current.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    if (lockScroll) lockBodyScroll();
    requestAnimationFrame(() => {
      const initial =
        initialFocusRef?.current ??
        containerRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ??
        containerRef.current;
      initial?.focus();
    });

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (lockScroll) unlockBodyScroll();
      previouslyFocused?.focus();
    };
  }, [containerRef, initialFocusRef, isOpen, lockScroll, onClose]);
}
