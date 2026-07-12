import { create } from "zustand";
import { loadKeybinds, saveKeybinds, loadZoomLevel, saveZoomLevel, applyZoom, KeybindsData } from "../utils/storage";

export interface KeybindAction {
  id: string;
  label: string;
  category: "Recommended" | "Navigation" | "Conversation" | "Layout";
  description: string;
  defaultCombo: string;
  currentCombo: string;
}

export const DEFAULT_KEYBINDS: Record<string, KeybindAction> = {
  openSearch: {
    id: "openSearch",
    label: "Open Conversation Picker",
    category: "Recommended",
    description: "Focuses the search box in the sidebar to find conversations",
    defaultCombo: "Ctrl+K",
    currentCombo: "Ctrl+K",
  },
  focusInput: {
    id: "focusInput",
    label: "Focus Chat Input",
    category: "Recommended",
    description: "Brings focus directly back to the message compose box",
    defaultCombo: "Ctrl+L",
    currentCombo: "Ctrl+L",
  },
  newChat: {
    id: "newChat",
    label: "New Conversation",
    category: "Recommended",
    description: "Clears the active session and creates a new conversation thread",
    defaultCombo: "Ctrl+N",
    currentCombo: "Ctrl+N",
  },
  captureAppshot: {
    id: "captureAppshot",
    label: "Capture Appshot",
    category: "Recommended",
    description: "Takes a screenshot of the app and attaches it to the current conversation",
    defaultCombo: "Alt+Shift+S",
    currentCombo: "Alt+Shift+S",
  },
  goBack: {
    id: "goBack",
    label: "Go Back",
    category: "Navigation",
    description: "Navigate backward in conversation history",
    defaultCombo: "Ctrl+[",
    currentCombo: "Ctrl+[",
  },
  goForward: {
    id: "goForward",
    label: "Go Forward",
    category: "Navigation",
    description: "Navigate forward in conversation history",
    defaultCombo: "Ctrl+]",
    currentCombo: "Ctrl+]",
  },
  openFilePicker: {
    id: "openFilePicker",
    label: "File Picker",
    category: "Navigation",
    description: "Open the file attachment dialog to upload files",
    defaultCombo: "Ctrl+P",
    currentCombo: "Ctrl+P",
  },
  prevChat: {
    id: "prevChat",
    label: "Select Previous Conversation",
    category: "Navigation",
    description: "Select the conversation directly above in the sidebar list",
    defaultCombo: "Alt+ArrowUp",
    currentCombo: "Alt+ArrowUp",
  },
  nextChat: {
    id: "nextChat",
    label: "Select Next Conversation",
    category: "Navigation",
    description: "Select the conversation directly below in the sidebar list",
    defaultCombo: "Alt+ArrowDown",
    currentCombo: "Alt+ArrowDown",
  },
  openSettings: {
    id: "openSettings",
    label: "Open Settings",
    category: "Navigation",
    description: "Switch active view to the Settings dashboard",
    defaultCombo: "Ctrl+,",
    currentCombo: "Ctrl+,",
  },
  toggleModel: {
    id: "toggleModel",
    label: "Toggle Model Selector",
    category: "Conversation",
    description: "Open or close the active Model selector dropdown",
    defaultCombo: "Ctrl+/",
    currentCombo: "Ctrl+/",
  },
  toggleSidebar: {
    id: "toggleSidebar",
    label: "Toggle Sidebar",
    category: "Layout",
    description: "Collapse or expand the history sidebar panel",
    defaultCombo: "Ctrl+B",
    currentCombo: "Ctrl+B",
  },
  zoomIn: {
    id: "zoomIn",
    label: "Zoom In",
    category: "Layout",
    description: "Increase the scaling and font size of interface text and elements",
    defaultCombo: "Ctrl+=",
    currentCombo: "Ctrl+=",
  },
  zoomOut: {
    id: "zoomOut",
    label: "Zoom Out",
    category: "Layout",
    description: "Decrease the scaling and font size of interface text and elements",
    defaultCombo: "Ctrl+-",
    currentCombo: "Ctrl+-",
  },
  zoomReset: {
    id: "zoomReset",
    label: "Reset Zoom",
    category: "Layout",
    description: "Restore interface elements back to default size (100%)",
    defaultCombo: "Ctrl+0",
    currentCombo: "Ctrl+0",
  },
  prevImage: {
    id: "prevImage",
    label: "Previous Image",
    category: "Navigation",
    description: "Navigate to the previous image in the preview viewer",
    defaultCombo: "ArrowLeft",
    currentCombo: "ArrowLeft",
  },
  nextImage: {
    id: "nextImage",
    label: "Next Image",
    category: "Navigation",
    description: "Navigate to the next image in the preview viewer",
    defaultCombo: "ArrowRight",
    currentCombo: "ArrowRight",
  },
  stopStreaming: {
    id: "stopStreaming",
    label: "Stop Generation",
    category: "Conversation",
    description: "Stop the active AI generation stream",
    defaultCombo: "Escape",
    currentCombo: "Escape",
  },
  toggleSearch: {
    id: "toggleSearch",
    label: "Toggle Web Search",
    category: "Conversation",
    description: "Enable or disable web search for the next message",
    defaultCombo: "Ctrl+Shift+S",
    currentCombo: "Ctrl+Shift+S",
  },
  toggleCompareMode: {
    id: "toggleCompareMode",
    label: "Toggle Compare Mode",
    category: "Conversation",
    description: "Toggle side-by-side model comparison view",
    defaultCombo: "Ctrl+Shift+C",
    currentCombo: "Ctrl+Shift+C",
  },
  retryMessage: {
    id: "retryMessage",
    label: "Retry Last Message",
    category: "Conversation",
    description: "Regenerate the last assistant response",
    defaultCombo: "Ctrl+Shift+R",
    currentCombo: "Ctrl+Shift+R",
  },
  deleteActiveChat: {
    id: "deleteActiveChat",
    label: "Delete Active Chat",
    category: "Conversation",
    description: "Delete the currently active conversation",
    defaultCombo: "Ctrl+Shift+Backspace",
    currentCombo: "Ctrl+Shift+Backspace",
  },
  scrollToBottom: {
    id: "scrollToBottom",
    label: "Scroll to Bottom",
    category: "Navigation",
    description: "Scroll the chat area to the latest message",
    defaultCombo: "Ctrl+ArrowDown",
    currentCombo: "Ctrl+ArrowDown",
  },
  toggleVoice: {
    id: "toggleVoice",
    label: "Toggle Voice Input",
    category: "Conversation",
    description: "Start or stop voice recording for speech-to-text",
    defaultCombo: "Ctrl+Shift+V",
    currentCombo: "Ctrl+Shift+V",
  },
  toggleTheme: {
    id: "toggleTheme",
    label: "Toggle Theme",
    category: "Layout",
    description: "Switch between dark and light mode",
    defaultCombo: "Ctrl+Shift+T",
    currentCombo: "Ctrl+Shift+T",
  },
  commandPalette: {
    id: "commandPalette",
    label: "Command Palette",
    category: "Recommended",
    description: "Open the global command palette",
    defaultCombo: "Ctrl+Shift+P",
    currentCombo: "Ctrl+Shift+P",
  },
  renameChat: {
    id: "renameChat",
    label: "Rename Active Chat",
    category: "Conversation",
    description: "Rename the currently active conversation",
    defaultCombo: "F2",
    currentCombo: "F2",
  },
  exportChat: {
    id: "exportChat",
    label: "Export Active Chat",
    category: "Conversation",
    description: "Export the currently active conversation as markdown",
    defaultCombo: "Ctrl+E",
    currentCombo: "Ctrl+E",
  },
  togglePinChat: {
    id: "togglePinChat",
    label: "Toggle Pin Chat",
    category: "Conversation",
    description: "Pin or unpin the active conversation",
    defaultCombo: "Alt+P",
    currentCombo: "Alt+P",
  },
  openWorkspaces: {
    id: "openWorkspaces",
    label: "Open Workspaces",
    category: "Navigation",
    description: "Open the project workspaces settings",
    defaultCombo: "Ctrl+Shift+W",
    currentCombo: "Ctrl+Shift+W",
  },
};

interface KeybindsState {
  keybinds: Record<string, KeybindAction>;
  zoomLevel: number;
  isRecording: string | null;

  setKeycombo: (actionId: string, combo: string) => void;
  resetKeycombo: (actionId: string) => void;
  resetAllKeybinds: () => void;

  setZoomLevel: (level: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;

  startRecording: (actionId: string) => void;
  stopRecording: () => void;
  initKeybinds: () => Promise<void>;
}

export const useKeybindStore = create<KeybindsState>((set, get) => ({
  keybinds: { ...DEFAULT_KEYBINDS },
  zoomLevel: 1.0,
  isRecording: null,

  setKeycombo: (actionId, combo) => {
    set((state) => {
      const updatedKeybinds = {
        ...state.keybinds,
        [actionId]: {
          ...state.keybinds[actionId],
          currentCombo: combo,
        },
      };

      saveKeybinds(updatedKeybinds as KeybindsData);
      return { keybinds: updatedKeybinds };
    });
  },

  resetKeycombo: (actionId) => {
    set((state) => {
      const updatedKeybinds = {
        ...state.keybinds,
        [actionId]: {
          ...state.keybinds[actionId],
          currentCombo: state.keybinds[actionId].defaultCombo,
        },
      };
      saveKeybinds(updatedKeybinds as KeybindsData);
      return { keybinds: updatedKeybinds };
    });
  },

  resetAllKeybinds: () => {
    const reset = { ...DEFAULT_KEYBINDS };
    saveKeybinds(reset as KeybindsData);
    set({ keybinds: reset });
  },

  setZoomLevel: (level) => {
    const clamped = Math.max(0.5, Math.min(2.0, level));
    applyZoom(clamped);
    saveZoomLevel(clamped);
    set({ zoomLevel: clamped });
  },

  zoomIn: () => {
    const next = Math.min(2.0, parseFloat((get().zoomLevel + 0.1).toFixed(2)));
    applyZoom(next);
    saveZoomLevel(next);
    set({ zoomLevel: next });
  },

  zoomOut: () => {
    const next = Math.max(0.5, parseFloat((get().zoomLevel - 0.1).toFixed(2)));
    applyZoom(next);
    saveZoomLevel(next);
    set({ zoomLevel: next });
  },

  zoomReset: () => {
    applyZoom(1.0);
    saveZoomLevel(1.0);
    set({ zoomLevel: 1.0 });
  },

  startRecording: (actionId) => set({ isRecording: actionId }),
  stopRecording: () => set({ isRecording: null }),

  initKeybinds: async () => {
    const zoom = await loadZoomLevel();
    applyZoom(zoom);

    const loaded = await loadKeybinds();
    if (loaded) {
      set((state) => {
        const merged = { ...state.keybinds };
        for (const [id, item] of Object.entries(loaded)) {
          if (merged[id]) {
            merged[id] = {
              ...merged[id],
              currentCombo: item.currentCombo,
            };
          }
        }
        return { keybinds: merged, zoomLevel: zoom };
      });
    } else {
      set({ zoomLevel: zoom });
    }
  },
}));

export function matchKeybind(e: KeyboardEvent, combo: string): boolean {
  const parts = combo.split("+");
  const mainKey = parts[parts.length - 1].toUpperCase();

  const hasCtrl = parts.includes("Ctrl");
  const hasShift = parts.includes("Shift");
  const hasAlt = parts.includes("Alt");

  const isMac = typeof window !== "undefined" && window.navigator.userAgent.includes("Mac");

  // Ctrl match (maps Ctrl to Cmd on Mac)
  const ctrlMatched = hasCtrl ? (isMac ? e.metaKey : e.ctrlKey) : !(e.ctrlKey || (isMac && e.metaKey));

  // Alt match
  const altMatched = hasAlt ? e.altKey : !e.altKey;

  // For Shift match, be lenient if the main key is zoom-in symbols '=' or '+'
  const shiftMatched = mainKey === "=" || mainKey === "+" ? true : hasShift ? e.shiftKey : !e.shiftKey;

  // Key match
  const pressedKey = e.key.toUpperCase();
  const keyMatched =
    (mainKey === "=" || mainKey === "+") && (pressedKey === "=" || pressedKey === "+") ? true : pressedKey === mainKey;

  return ctrlMatched && altMatched && shiftMatched && keyMatched;
}
