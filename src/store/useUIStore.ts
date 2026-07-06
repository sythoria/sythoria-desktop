import { create } from "zustand";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  loadHasStarted,
  saveHasStarted,
  saveTheme,
  saveAnimationsDisabled,
  loadDownloadedThemes,
  saveDownloadedThemes,
  DownloadedThemes,
  saveAlwaysOnTop,
  saveCloseToTray,
  saveLaunchOnStartup,
  saveSendMessageShortcut,
  saveClearInputOnEscape,
  saveBaseTextSize,
  saveAutoUpdateChecking,
  saveShowContextWindow,
  saveIsLoggingEnabled,
  saveDisableBgActivity,
  saveStrictSsl,
  saveBlockedHosts,
  saveOfflineMode,
  saveLanguage,
} from "../utils/storage";
import React from "react";
import type { Toast } from "../components/ui/Toast";
import type { LogEntry, LogSource } from "../types/log";
import {
  ThemeConfig,
  DEFAULT_THEME_CONFIG,
  applyTheme,
  CustomThemeConfig,
  LIGHT_PRESETS,
  DARK_PRESETS,
} from "../config/themePresets";
import { useModelStore } from "./useModelStore";
export type { ThemeConfig, CustomThemeConfig };

export type LoadingKey = "init" | "sendMessage" | "checkConnection" | "saveConfig" | "toolExecution" | "mcpConnect";

export interface ToolConfirmation {
  id: string;
  toolName: string;
  arguments: Record<string, any>;
  resolve: (approved: boolean) => void;
  schema?: any;
  destination?: string;
}

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
  downloadedThemes: DownloadedThemes;
  alwaysOnTop: boolean;
  closeToTray: boolean;
  launchOnStartup: boolean;
  sendMessageShortcut: "enter" | "ctrl-enter";
  clearInputOnEscape: boolean;
  baseTextSize: "small" | "medium" | "large" | "xlarge";
  autoUpdateChecking: boolean;
  isLoggingEnabled: boolean;
  isDraggingFile: boolean;
  showContextWindow: boolean;
  showProjectConfigModal: boolean;
  projectConfigModalMode: "create" | "edit";
  projectConfigModalId: string | null;
  disableBgActivity: boolean;
  strictSsl: boolean;
  blockedHosts: string[];
  offlineMode: boolean;
  language: string;

  setView: (view: "chat" | "settings") => void;
  setTheme: (theme: ThemeConfig) => void;
  setActiveSection: (section: string) => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebarCollapsed: () => void;
  setHasStarted: (started: boolean) => void;
  initHasStarted: () => Promise<void>;
  setConfigLoaded: (loaded: boolean) => void;
  setLoading: (key: LoadingKey, value: boolean) => void;
  addToast: (message: React.ReactNode, variant?: Toast["variant"]) => void;
  dismissToast: (id: string) => void;
  openRenameModal: (id: string, currentTitle: string) => void;
  closeRenameModal: () => void;
  setLogBuffer: (logs: LogEntry[]) => void;
  setLogFilterSource: (source: LogSource | "all") => void;
  setLogFilterLevel: (level: "all" | "info" | "warn" | "error") => void;
  setAnimationsDisabled: (disabled: boolean) => void;
  downloadTheme: (type: "light" | "dark", name: string, config: CustomThemeConfig) => void;
  deleteTheme: (type: "light" | "dark", name: string) => void;
  initDownloadedThemes: () => Promise<void>;
  setAlwaysOnTop: (value: boolean) => void;
  setCloseToTray: (value: boolean) => void;
  setLaunchOnStartup: (value: boolean) => void;
  setSendMessageShortcut: (value: "enter" | "ctrl-enter") => void;
  setClearInputOnEscape: (value: boolean) => void;
  setBaseTextSize: (value: "small" | "medium" | "large" | "xlarge") => void;
  setAutoUpdateChecking: (value: boolean) => void;
  setIsLoggingEnabled: (value: boolean) => void;
  setIsDraggingFile: (dragging: boolean) => void;
  setShowContextWindow: (value: boolean) => void;
  setDisableBgActivity: (value: boolean) => void;
  setStrictSsl: (value: boolean) => void;
  setBlockedHosts: (value: string[]) => void;
  setOfflineMode: (value: boolean) => void;
  setLanguage: (value: string) => void;
  sidebarWidth: number;
  setSidebarWidth: (width: number) => void;
  activeArtifact: { title: string; content: string; type: "html" | "svg" | "mermaid" } | null;
  setActiveArtifact: (artifact: { title: string; content: string; type: "html" | "svg" | "mermaid" } | null) => void;
  openProjectConfigModal: (mode: "create" | "edit", id?: string | null) => void;
  closeProjectConfigModal: () => void;
  pendingToolConfirmations: ToolConfirmation[];
  addPendingToolConfirmation: (conf: ToolConfirmation) => void;
  respondToToolConfirmation: (id: string, approved: boolean) => void;
}

const safeLocalStorage =
  typeof window !== "undefined" && window.localStorage
    ? window.localStorage
    : {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
        clear: () => {},
      };

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
  downloadedThemes: { light: {}, dark: {} },
  alwaysOnTop: false,
  closeToTray: false,
  launchOnStartup: false,
  sendMessageShortcut: "enter",
  clearInputOnEscape: false,
  baseTextSize: "medium",
  autoUpdateChecking: true,
  isLoggingEnabled: true,
  isDraggingFile: false,
  showContextWindow: false,
  showProjectConfigModal: false,
  projectConfigModalMode: "create",
  projectConfigModalId: null,
  disableBgActivity: false,
  strictSsl: true,
  blockedHosts: [],
  offlineMode: false,
  language: "en",
  sidebarWidth: Number(safeLocalStorage.getItem("sythoria-sidebar-width") || 260),
  activeArtifact: null,
  pendingToolConfirmations: [],

  setSidebarWidth: (sidebarWidth) => {
    safeLocalStorage.setItem("sythoria-sidebar-width", String(sidebarWidth));
    set({ sidebarWidth });
  },
  setActiveArtifact: (activeArtifact) => set({ activeArtifact }),

  setView: (view) => set({ view }),
  setIsDraggingFile: (isDraggingFile) => set({ isDraggingFile }),
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
  openProjectConfigModal: (mode, id = null) => {
    set({ showProjectConfigModal: true, projectConfigModalMode: mode, projectConfigModalId: id });
  },
  closeProjectConfigModal: () => {
    set({ showProjectConfigModal: false, projectConfigModalId: null });
  },
  addPendingToolConfirmation: (conf) =>
    set((s) => ({
      pendingToolConfirmations: [...s.pendingToolConfirmations, conf],
    })),
  respondToToolConfirmation: (id, approved) =>
    set((s) => {
      const conf = s.pendingToolConfirmations.find((c) => c.id === id);
      if (conf) {
        conf.resolve(approved);
      }
      return {
        pendingToolConfirmations: s.pendingToolConfirmations.filter((c) => c.id !== id),
      };
    }),
  setLogBuffer: (logs) => set({ logBuffer: logs }),
  setLogFilterSource: (source) => set({ logFilterSource: source }),
  setLogFilterLevel: (level) => set({ logFilterLevel: level }),
  setAnimationsDisabled: (disabled) => {
    set({ animationsDisabled: disabled });
    document.documentElement.classList.toggle("animations-disabled", disabled);
    saveAnimationsDisabled(disabled);
  },
  downloadTheme: (type, name, config) => {
    set((s) => {
      const updated = {
        ...s.downloadedThemes,
        [type]: {
          ...s.downloadedThemes[type],
          [name]: config,
        },
      };
      saveDownloadedThemes(updated);
      return { downloadedThemes: updated };
    });
  },
  deleteTheme: (type, name) => {
    set((s) => {
      const updatedThemes = { ...s.downloadedThemes[type] };
      delete updatedThemes[name];

      const updated = {
        ...s.downloadedThemes,
        [type]: updatedThemes,
      };
      saveDownloadedThemes(updated);

      // If currently active, reset to default theme preset
      const currentTheme = s.theme;
      const isCurrentlyApplied =
        (type === "light" && currentTheme.lightTheme.preset === name) ||
        (type === "dark" && currentTheme.darkTheme.preset === name);

      if (isCurrentlyApplied) {
        const defaultPreset = type === "light" ? LIGHT_PRESETS["Default Light"] : DARK_PRESETS["Default Dark"];
        const newTheme = {
          ...currentTheme,
          [type === "light" ? "lightTheme" : "darkTheme"]: {
            ...defaultPreset,
          },
        };
        applyTheme(newTheme);
        saveTheme(newTheme);
        return { downloadedThemes: updated, theme: newTheme };
      }

      return { downloadedThemes: updated };
    });
  },
  initDownloadedThemes: async () => {
    const stored = await loadDownloadedThemes();
    set({ downloadedThemes: stored });
  },
  setAlwaysOnTop: (value) => {
    set({ alwaysOnTop: value });
    try {
      getCurrentWindow()
        .setAlwaysOnTop(value)
        .catch((e) => {
          console.warn("Could not set always-on-top (promise rejected):", e);
        });
    } catch (e) {
      console.warn("Could not set always-on-top:", e);
    }
    saveAlwaysOnTop(value);
  },
  setCloseToTray: (value) => {
    set({ closeToTray: value });
    saveCloseToTray(value);
    import("@tauri-apps/api/core")
      .then(({ invoke }) => {
        invoke("update_tray_icon").catch((e) => {
          console.warn("Could not update tray icon:", e);
        });
      })
      .catch((e) => {
        console.warn("Could not import tauri api for tray update:", e);
      });
  },
  setLaunchOnStartup: async (value) => {
    set({ launchOnStartup: value });
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("set_autostart_enabled", { enabled: value });
    } catch (e) {
      console.warn("Could not set launch on startup:", e);
    }
    saveLaunchOnStartup(value);
  },
  setSendMessageShortcut: (value) => {
    set({ sendMessageShortcut: value });
    saveSendMessageShortcut(value);
  },
  setClearInputOnEscape: (value) => {
    set({ clearInputOnEscape: value });
    saveClearInputOnEscape(value);
  },
  setBaseTextSize: (value) => {
    set({ baseTextSize: value });
    saveBaseTextSize(value);
  },
  setAutoUpdateChecking: (value) => {
    set({ autoUpdateChecking: value });
    saveAutoUpdateChecking(value);
  },
  setLanguage: (value) => {
    set({ language: value });
    saveLanguage(value);
    if (typeof document !== "undefined") {
      document.documentElement.lang = value;
    }
  },
  setIsLoggingEnabled: (value) => {
    set({ isLoggingEnabled: value });
    saveIsLoggingEnabled(value);
  },
  setShowContextWindow: (value) => {
    set({ showContextWindow: value });
    saveShowContextWindow(value);
  },
  setDisableBgActivity: (value) => {
    set({ disableBgActivity: value });
    saveDisableBgActivity(value);
    if (value) {
      useModelStore.getState().stopHealthCheck();
      useModelStore.setState({ modelStatuses: {} });
    } else {
      useModelStore.getState().startHealthCheck();
      useModelStore.getState().checkModelConnections();
    }
  },
  setStrictSsl: (value) => {
    set({ strictSsl: value });
    saveStrictSsl(value);
    import("@tauri-apps/api/core")
      .then(({ invoke }) => {
        const { blockedHosts } = useUIStore.getState();
        invoke("save_network_config", {
          config: JSON.stringify({
            strict_ssl: value,
            blocked_hosts: blockedHosts,
          }),
        }).catch((e) => console.error("Failed to sync strict SSL to Rust:", e));
      })
      .catch(console.error);
  },
  setBlockedHosts: (value) => {
    set({ blockedHosts: value });
    saveBlockedHosts(value);
    import("@tauri-apps/api/core")
      .then(({ invoke }) => {
        const { strictSsl } = useUIStore.getState();
        invoke("save_network_config", {
          config: JSON.stringify({
            strict_ssl: strictSsl,
            blocked_hosts: value,
          }),
        }).catch((e) => console.error("Failed to sync blocked hosts to Rust:", e));
      })
      .catch(console.error);
  },
  setOfflineMode: (value) => {
    set({ offlineMode: value });
    saveOfflineMode(value);
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
