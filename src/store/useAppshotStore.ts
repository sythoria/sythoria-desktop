import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { loadAppshotConfig, saveAppshotConfig, AppshotConfig } from "../utils/storage";
import { logInfo, logError } from "../utils/logger";
import { useChatStore } from "./useChatStore";
import { useUIStore } from "./useUIStore";
import { Attachment } from "../types";
import { generateId } from "../utils/generateId";

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
  hasPermission: boolean;

  init: () => Promise<void>;
  updateConfig: (updates: Partial<AppshotConfig>) => Promise<void>;
  checkPermission: () => Promise<boolean>;
  requestPermission: () => Promise<boolean>;
  triggerCapture: (target: "all" | "primary" | "window") => Promise<string>;
  loadRecentAppshots: () => Promise<void>;
  deleteAppshot: (path: string) => Promise<void>;
  clearAll: () => Promise<void>;
  captureAndAttachToChat: () => Promise<void>;
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
    screenCapturePromptShown: false,
  },
  recentAppshots: [],
  isCapturing: false,
  loading: false,
  error: null,
  hasPermission: true,

  init: async () => {
    set({ loading: true, error: null });
    try {
      const config = await loadAppshotConfig();
      set({ config });
      const hasPerm = await get().checkPermission();
      if (hasPerm) {
        await get().loadRecentAppshots();
      }
      set({ loading: false });
    } catch (e: any) {
      logError("appshots", "Failed to initialize Appshots store", { error: e });
      set({ error: e.message || String(e), loading: false });
    }
  },

  checkPermission: async () => {
    try {
      const hasPerm = await invoke<boolean>("has_screen_capture_permission");
      set({ hasPermission: hasPerm });
      return hasPerm;
    } catch (e) {
      logError("appshots", "Failed to check screen capture permission", { error: e });
      set({ hasPermission: false });
      return false;
    }
  },

  requestPermission: async () => {
    try {
      const config = get().config;
      const isFirstTime = !config.screenCapturePromptShown;
      const granted = await invoke<boolean>("request_screen_capture_permission", {
        firstTime: isFirstTime,
      });
      set({ hasPermission: granted });
      if (isFirstTime) {
        await get().updateConfig({ screenCapturePromptShown: true });
      }
      return granted;
    } catch (e) {
      logError("appshots", "Failed to request screen capture permission", { error: e });
      set({ hasPermission: false });
      return false;
    }
  },

  updateConfig: async (updates) => {
    const newConfig = { ...get().config, ...updates };
    set({ config: newConfig });
    await saveAppshotConfig(newConfig);
    logInfo("appshots", "Updated Appshots config settings", { details: JSON.stringify(updates) });
  },

  triggerCapture: async (target) => {
    const hasPerm = await get().checkPermission();
    if (!hasPerm) {
      const err = "Screen recording permission is not granted. Please enable it in macOS System Settings.";
      set({ error: err });
      throw new Error(err);
    }
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

  captureAndAttachToChat: async () => {
    try {
      const { triggerCapture, config } = get();
      if (!config.enabled) {
        useUIStore.getState().addToast("Appshots utility is disabled. Enable it in Settings > Appshots.", "info");
        return;
      }

      const hasPerm = await get().checkPermission();
      if (!hasPerm) {
        useUIStore.getState().addToast("Screen recording permission is required.", "error");
        return;
      }

      useUIStore.getState().addToast("Capturing screen...", "info");

      // 1. Capture screen
      const savedPath = await triggerCapture("primary");

      // 2. Read file to get base64 dataUrl and size
      const payload = await invoke<{
        name: string;
        size: number;
        mimeType: string;
        dataUrl?: string;
      }>("read_file_from_path", { path: savedPath });

      if (!payload.dataUrl) {
        throw new Error("Failed to read captured image data");
      }

      // 3. Create attachment object
      const attachment: Attachment = {
        id: generateId(),
        name: payload.name,
        mimeType: payload.mimeType,
        size: payload.size,
        kind: "image",
        dataUrl: payload.dataUrl,
      };

      // 4. Add to draftAttachments in useChatStore
      const chatStore = useChatStore.getState();
      const currentDrafts = chatStore.draftAttachments || [];

      if (currentDrafts.length >= 6) {
        // MAX_ATTACHMENTS = 6
        useUIStore.getState().addToast("Maximum of 6 attachments reached", "info");
        return;
      }

      chatStore.setDraftAttachments([...currentDrafts, attachment]);
      useUIStore.getState().addToast("Screenshot added to chat!", "success");

      // 5. Ensure we focus the chat input so user can type/send immediately
      setTimeout(() => {
        document.getElementById("chat-input")?.focus();
      }, 50);
    } catch (e: any) {
      logError("appshots", "Failed to capture and attach appshot", { error: e });
      useUIStore.getState().addToast(`Capture failed: ${e.message || String(e)}`, "error");
    }
  },
}));
