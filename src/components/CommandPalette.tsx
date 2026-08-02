import React, { useCallback, useState, useEffect, useRef } from "react";
import { Search } from "lucide-react";
import { useUIStore } from "../store/useUIStore";
import { useChatStore } from "../store/useChatStore";
import { useKeybindStore } from "../store/useKeybindStore";
import { useDialogFocus } from "../hooks/useDialogFocus";

interface CommandItem {
  id: string;
  label: string;
  action: () => void;
  shortcut?: string;
}

export function CommandPalette() {
  const { showCommandPalette, setShowCommandPalette, setView, setActiveSection, checkForUpdates } = useUIStore();
  const { zoomIn, zoomOut, zoomReset } = useKeybindStore();

  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    setSearch("");
    setSelectedIndex(0);
    setShowCommandPalette(false);
  }, [setShowCommandPalette]);
  useDialogFocus({
    isOpen: showCommandPalette,
    onClose: close,
    containerRef: dialogRef,
    initialFocusRef: inputRef,
  });

  const commands: CommandItem[] = [
    {
      id: "new-chat",
      label: "New Conversation",
      shortcut: "Ctrl+Shift+O",
      action: () => {
        useChatStore.getState().newChat();
      },
    },
    {
      id: "create-project",
      label: "Create Project",
      action: () => {
        setView("settings");
        setActiveSection("projects");
      },
    },
    {
      id: "settings",
      label: "Open Settings",
      action: () => setView("settings"),
    },
    {
      id: "zoom-in",
      label: "Zoom In",
      action: zoomIn,
    },
    {
      id: "zoom-out",
      label: "Zoom Out",
      action: zoomOut,
    },
    {
      id: "zoom-reset",
      label: "Reset Zoom",
      action: zoomReset,
    },
    {
      id: "check-updates",
      label: "Check for Updates",
      action: () => void checkForUpdates(false),
    },
  ];

  const filteredCommands = commands.filter((cmd) => cmd.label.toLowerCase().includes(search.toLowerCase()));

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedIndex(0);
  }, [search]);

  if (!showCommandPalette) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" && filteredCommands.length > 0) {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % filteredCommands.length);
    } else if (e.key === "ArrowUp" && filteredCommands.length > 0) {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length);
    } else if (e.key === "Enter" && filteredCommands.length > 0) {
      e.preventDefault();
      filteredCommands[selectedIndex].action();
      close();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[9999] bg-overlay flex justify-center items-start pt-[15vh] backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <button type="button" className="absolute inset-0" onClick={close} aria-label="Close command palette" />
      <div
        ref={dialogRef}
        className="popup-surface relative w-full max-w-lg border border-border/50 rounded-xl shadow-2xl overflow-hidden flex flex-col"
      >
        <div className="flex items-center px-4 py-3 border-b border-border/30">
          <Search size={18} className="text-text-muted mr-3" />
          <input
            ref={inputRef}
            type="text"
            className="flex-1 bg-transparent border-none outline-none text-text-primary text-sm placeholder:text-text-muted"
            placeholder="Type a command or search..."
            aria-label="Search commands"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        <div className="max-h-[300px] overflow-y-auto p-2">
          {filteredCommands.length === 0 ? (
            <div className="py-4 text-center text-sm text-text-muted">No commands found.</div>
          ) : (
            filteredCommands.map((cmd, idx) => (
              <button
                key={cmd.id}
                onClick={() => {
                  cmd.action();
                  close();
                }}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  idx === selectedIndex ? "bg-hover text-text-primary" : "text-text-secondary hover:bg-hover/50"
                }`}
              >
                <span>{cmd.label}</span>
                {cmd.shortcut && (
                  <span className="text-xs text-text-muted bg-surface-raised px-1.5 py-0.5 rounded border border-border/30">
                    {cmd.shortcut}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
