import { useState, useEffect, useRef, useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { emitTo } from "@tauri-apps/api/event";
import { Search, ArrowRight, Command } from "lucide-react";

import "../index.css";

export function SpotlightArea() {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const focusInput = useCallback(() => {
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 80);
  }, []);

  useEffect(() => {
    focusInput();

    // Re-focus when the window becomes visible again
    const unlistenPromise = listen("sythoria://spotlight-shown", () => {
      setQuery("");
      focusInput();
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [focusInput]);

  // Handle Escape to dismiss
  useEffect(() => {
    const onKeyDown = async (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setQuery("");
        const win = getCurrentWindow();
        await win.hide();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;

    try {
      // Send the query to the main window
      await emitTo("main", "sythoria://spotlight-query", trimmed);

      setQuery("");
      const win = getCurrentWindow();
      await win.hide();
    } catch (err) {
      console.error("Failed to emit spotlight query:", err);
    }
  };

  return (
    <div className="w-full h-full flex items-center" style={{ background: "transparent" }}>
      <form
        onSubmit={handleSubmit}
        className="w-full flex items-center gap-3 px-4 h-full rounded-2xl border border-border/60 bg-chat"
        style={{
          boxShadow: "0 8px 40px rgba(0,0,0,0.35), 0 2px 12px rgba(0,0,0,0.2)",
          backdropFilter: "blur(24px) saturate(140%)",
        }}
      >
        <Search size={18} className="text-text-muted shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask Sythoria anything…"
          className="flex-1 bg-transparent border-none text-text-primary placeholder-text-muted text-sm font-medium outline-none"
          autoFocus
        />
        {query.trim() ? (
          <button
            type="submit"
            className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg bg-accent/15 text-accent text-xs font-medium hover:bg-accent/25 transition-colors"
          >
            <span>Send</span>
            <ArrowRight size={12} />
          </button>
        ) : (
          <span className="shrink-0 flex items-center gap-1 text-[11px] text-text-muted opacity-60">
            <Command size={11} />
            <span>Esc to close</span>
          </span>
        )}
      </form>
    </div>
  );
}
