import { create } from "zustand";
import { loadHasStarted, saveHasStarted, saveTheme, saveAnimationsDisabled } from "../utils/storage";
import type { Toast } from "../components/ui/Toast";
import type { LogEntry, LogSource } from "../types/log";
import { ThemeConfig, DEFAULT_THEME_CONFIG, applyTheme } from "../config/themePresets";
export type { ThemeConfig };

export type LoadingKey = "init" | "sendMessage" | "checkConnection" | "saveConfig" | "toolExecution" | "mcpConnect";

interface UIState {
  view: "chat" | "settings";
  theme: ThemeConfig;
  sidebarOpen: boolean;
  sidebarCollapsed: boolean;
  hasStarted: boolean;
  isConfigLoaded: boolean;
  loading: Record<LoadingKey, boolean>;
  toasts: Toast[];
  showRenameModal: boolean;
  renameId: string | null;
  renameCurrentTitle: string;
  activeSection: string;
  logBuffer: LogEntry[];
  logFilterSource: LogSource | "all";
  logFilterLevel: "all" | "info" | "warn" | "error";
  animationsDisabled: boolean;

  setView: (view: "chat" | "settings") => void;
  setTheme: (theme: ThemeConfig) => void;
  setActiveSection: (section: string) => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebarCollapsed: () => void;
  setHasStarted: (started: boolean) => void;
  initHasStarted: () => Promise<void>;
  setConfigLoaded: (loaded: boolean) => void;
  setLoading: (key: LoadingKey, value: boolean) => void;
  addToast: (message: string, variant?: Toast["variant"]) => void;
  dismissToast: (id: string) => void;
  openRenameModal: (id: string, currentTitle: string) => void;
  closeRenameModal: () => void;
  setLogBuffer: (logs: LogEntry[]) => void;
  setLogFilterSource: (source: LogSource | "all") => void;
  setLogFilterLevel: (level: "all" | "info" | "warn" | "error") => void;
  setAnimationsDisabled: (disabled: boolean) => void;
}

let toastCounter = 0;

export const useUIStore = create<UIState>((set) => ({
  view: "chat",
  theme: DEFAULT_THEME_CONFIG,
  sidebarOpen: false,
  sidebarCollapsed: false,
  hasStarted: false,
  isConfigLoaded: false,
  loading: {
    init: true,
    sendMessage: false,
    checkConnection: false,
    saveConfig: false,
    toolExecution: false,
    mcpConnect: false,
  },
  toasts: [],
  showRenameModal: false,
  renameId: null,
  renameCurrentTitle: "",
  activeSection: "general",
  logBuffer: [],
  logFilterSource: "all",
  logFilterLevel: "all",
  animationsDisabled: false,

  setView: (view) => set({ view }),
  setTheme: (theme) => {
    set({ theme });
    applyTheme(theme);
    saveTheme(theme);
  },
  setActiveSection: (activeSection) => set({ activeSection }),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleSidebarCollapsed: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setHasStarted: (started) => {
    set({ hasStarted: started });
    saveHasStarted(started);
  },
  initHasStarted: async () => {
    const stored = await loadHasStarted();
    if (stored) set({ hasStarted: true });
  },
  setConfigLoaded: (loaded) => set({ isConfigLoaded: loaded }),
  setLoading: (key, value) => set((s) => ({ loading: { ...s.loading, [key]: value } })),
  addToast: (message, variant = "info") => {
    const id = `toast-${++toastCounter}`;
    set((s) => ({ toasts: [...s.toasts, { id, message, variant }] }));
  },
  dismissToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
  openRenameModal: (id, currentTitle) => {
    set({ renameId: id, renameCurrentTitle: currentTitle, showRenameModal: true });
  },
  closeRenameModal: () => {
    set({ showRenameModal: false, renameId: null, renameCurrentTitle: "" });
  },
  setLogBuffer: (logs) => set({ logBuffer: logs }),
  setLogFilterSource: (source) => set({ logFilterSource: source }),
  setLogFilterLevel: (level) => set({ logFilterLevel: level }),
  setAnimationsDisabled: (disabled) => {
    set({ animationsDisabled: disabled });
    document.documentElement.classList.toggle("animations-disabled", disabled);
    saveAnimationsDisabled(disabled);
  },
}));

if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  mediaQuery.addEventListener("change", () => {
    const currentTheme = useUIStore.getState().theme;
    if (currentTheme && currentTheme.mode === "system") {
      applyTheme(currentTheme);
    }
  });
}
