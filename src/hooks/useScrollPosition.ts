import { useState, useCallback, useRef } from "react";
import type { VirtuosoHandle } from "react-virtuoso";

/**
 * Manages "is at bottom" state for the scroll-to-bottom button.
 *
 * ChatArea calls `setIsAtBottom()` from its scroll listeners.
 * App.tsx reads `isAtBottom` and calls `scrollToBottom()`.
 *
 * For the Virtuoso path: App passes `virtuosoRef` into ChatArea,
 * which attaches it to <Virtuoso/>. App can then call
 * `virtuosoRef.current.scrollToIndex(...)` directly.
 *
 * For the non-virtualized path: ChatArea marks its scroll container
 * with `[data-chat-scroll]` so `scrollToBottom()` can find it.
 */
export function useScrollButton() {
  const [isAtBottom, setIsAtBottom] = useState(true);
  const virtuosoRef = useRef<VirtuosoHandle | null>(null);

  const scrollToBottom = useCallback(() => {
    if (virtuosoRef.current) {
      virtuosoRef.current.scrollToIndex({
        index: Number.MAX_SAFE_INTEGER,
        behavior: "smooth",
        align: "end",
      });
      return;
    }

    const el = document.querySelector("[data-chat-scroll]") as HTMLElement | null;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, []);

  return { isAtBottom, setIsAtBottom, scrollToBottom, virtuosoRef };
}
