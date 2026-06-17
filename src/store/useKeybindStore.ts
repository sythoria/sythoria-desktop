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
  let ctrlMatched = false;
  if (hasCtrl) {
    ctrlMatched = isMac ? e.metaKey : e.ctrlKey;
  } else {
    ctrlMatched = !(e.ctrlKey || (isMac && e.metaKey));
  }

  // Alt match
  const altMatched = hasAlt ? e.altKey : !e.altKey;

  // For Shift match, be lenient if the main key is zoom-in symbols '=' or '+'
  let shiftMatched = false;
  if (mainKey === "=" || mainKey === "+") {
    shiftMatched = true;
  } else {
    shiftMatched = hasShift ? e.shiftKey : !e.shiftKey;
  }

  // Key match
  let keyMatched = false;
  const pressedKey = e.key.toUpperCase();
  if ((mainKey === "=" || mainKey === "+") && (pressedKey === "=" || pressedKey === "+")) {
    keyMatched = true;
  } else {
    keyMatched = pressedKey === mainKey;
  }

  return ctrlMatched && altMatched && shiftMatched && keyMatched;
}
