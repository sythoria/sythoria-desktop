import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { loadAppshotConfig, saveAppshotConfig, AppshotConfig } from "../utils/storage";
import { logInfo, logError } from "../utils/logger";

export interface AppshotFile {
  path: string;
  name: string;
  size: number;
  timestamp: string;
}

interface AppshotStore {
  config: AppshotConfig;
  recentAppshots: AppshotFile[];
  isCapturing: boolean;
  loading: boolean;
  error: string | null;

  init: () => Promise<void>;
  updateConfig: (updates: Partial<AppshotConfig>) => Promise<void>;
  triggerCapture: (target: "all" | "primary" | "window") => Promise<string>;
  loadRecentAppshots: () => Promise<void>;
  deleteAppshot: (path: string) => Promise<void>;
  clearAll: () => Promise<void>;
}

export const useAppshotStore = create<AppshotStore>((set, get) => ({
  config: {
    enabled: true,
    captureFolder: "",
    hotkey: "Alt+Shift+S",
    imageFormat: "png",
    imageQuality: 85,
    delaySeconds: 0,
    autoCleanEnabled: false,
    autoCleanType: "count",
    autoCleanValue: 50,
    includeCursor: false,
    hideWindowOnCapture: true,
  },
  recentAppshots: [],
  isCapturing: false,
  loading: false,
  error: null,

  init: async () => {
    set({ loading: true, error: null });
    try {
      const config = await loadAppshotConfig();
      set({ config, loading: false });
      await get().loadRecentAppshots();
    } catch (e: any) {
      logError("appshots", "Failed to initialize Appshots store", { error: e });
      set({ error: e.message || String(e), loading: false });
    }
  },

  updateConfig: async (updates) => {
    const newConfig = { ...get().config, ...updates };
    set({ config: newConfig });
    await saveAppshotConfig(newConfig);
    logInfo("appshots", "Updated Appshots config settings", { details: JSON.stringify(updates) });
  },

  triggerCapture: async (target) => {
    set({ isCapturing: true, error: null });
    const {
      imageFormat,
      imageQuality,
      delaySeconds,
      includeCursor,
      hideWindowOnCapture,
      captureFolder,
      autoCleanEnabled,
      autoCleanType,
      autoCleanValue,
    } = get().config;
    try {
      // 1. Capture screen via Tauri command
      const savedPath = await invoke<string>("capture_screen", {
        target,
        options: {
          format: imageFormat,
          quality: imageQuality,
          delaySeconds,
          includeCursor,
          hideWindow: hideWindowOnCapture,
          customFolder: captureFolder || null,
        },
      });

      logInfo("appshots", `Screen captured successfully and saved to: ${savedPath}`);

      // 2. Run auto cleanup if enabled
      if (autoCleanEnabled) {
        try {
          const cleanedCount = await invoke<number>("run_appshots_clean", {
            cleanType: autoCleanType,
            cleanValue: autoCleanValue,
            customFolder: captureFolder || null,
          });
          if (cleanedCount > 0) {
            logInfo("appshots", `Auto-cleanup completed: deleted ${cleanedCount} old screenshot files.`);
          }
        } catch (e) {
          logError("appshots", "Auto-cleanup failed to execute", { error: e });
        }
      }

      // 3. Reload captures gallery
      await get().loadRecentAppshots();
      set({ isCapturing: false });
      return savedPath;
    } catch (e: any) {
      logError("appshots", "Screen capture failed", { error: e });
      set({ error: e.message || String(e), isCapturing: false });
      throw e;
    }
  },

  loadRecentAppshots: async () => {
    const { captureFolder } = get().config;
    try {
      const list = await invoke<AppshotFile[]>("list_appshots", {
        customFolder: captureFolder || null,
      });
      set({ recentAppshots: list });
    } catch (e) {
      logError("appshots", "Failed to retrieve recent screenshots", { error: e });
    }
  },

  deleteAppshot: async (path) => {
    try {
      await invoke("delete_appshot", { path });
      logInfo("appshots", `Deleted screenshot: ${path}`);
      await get().loadRecentAppshots();
    } catch (e: any) {
      logError("appshots", `Failed to delete screenshot: ${path}`, { error: e });
    }
  },

  clearAll: async () => {
    const confirm = window.confirm("Are you sure you want to delete all screenshots in the capture folder?");
    if (!confirm) return;

    set({ loading: true });
    const { recentAppshots } = get();
    try {
      for (const shot of recentAppshots) {
        await invoke("delete_appshot", { path: shot.path });
      }
      logInfo("appshots", "Cleared all screenshots in gallery");
      await get().loadRecentAppshots();
    } catch (e: any) {
      logError("appshots", "Failed to clear all screenshots", { error: e });
    } finally {
      set({ loading: false });
    }
  },
}));
