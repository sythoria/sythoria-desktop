import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { WHISPER_PRESETS } from "../config/whisperPresets";
import { logInfo, logError } from "../utils/logger";

interface WhisperConfig {
  isVoiceEnabled: boolean;
  selectedModelId: string;
  customModelPath: string | null;
  language: string;
}

interface WhisperState extends WhisperConfig {
  downloadedFiles: string[];
  isDownloading: boolean;
  downloadProgress: number;
  downloadingModelId: string | null;
  isRecording: boolean;
  isTranscribing: boolean;

  init: () => Promise<void>;
  toggleVoiceEnabled: () => void;
  selectModel: (modelId: string) => void;
  setCustomModelPath: (path: string | null) => void;
  setLanguage: (lang: string) => void;
  downloadModel: (modelId: string) => Promise<void>;
  cancelDownload: () => Promise<void>;
  deleteModel: (fileName: string) => Promise<void>;

  setIsRecording: (recording: boolean) => void;
  setIsTranscribing: (transcribing: boolean) => void;
}

const DEFAULT_CONFIG: WhisperConfig = {
  isVoiceEnabled: false,
  selectedModelId: "tiny.en",
  customModelPath: null,
  language: "en",
};

let downloadCancelled = false;

export const useWhisperStore = create<WhisperState>((set, get) => {
  // Listen to Tauri download progress events
  listen<any>("whisper-download-progress", (event) => {
    const payload = event.payload;
    if (downloadCancelled) return;
    if (payload.modelId === get().downloadingModelId) {
      set({
        downloadProgress: Math.round(payload.percentage),
        isDownloading: !payload.done,
        downloadingModelId: payload.done ? null : payload.modelId,
      });
      if (payload.done) {
        get().init(); // Reload downloaded list
      }
    }
  });

  return {
    ...DEFAULT_CONFIG,
    downloadedFiles: [],
    isDownloading: false,
    downloadProgress: 0,
    downloadingModelId: null,
    isRecording: false,
    isTranscribing: false,

    init: async () => {
      try {
        let savedConfig: Partial<WhisperConfig> = {};
        const localData = localStorage.getItem("sythoria-whisper-config");
        if (localData) {
          try {
            savedConfig = JSON.parse(localData);
          } catch (e) {
            logError("general", `Failed to parse saved Whisper config: ${e}`);
          }
        }

        const downloaded = await invoke<string[]>("check_downloaded_whisper_models");
        set({
          ...DEFAULT_CONFIG,
          ...savedConfig,
          downloadedFiles: downloaded,
        });
      } catch (err) {
        logError("general", `Failed to initialize Whisper store: ${err}`);
      }
    },

    toggleVoiceEnabled: () => {
      const next = !get().isVoiceEnabled;
      set({ isVoiceEnabled: next });
      localStorage.setItem(
        "sythoria-whisper-config",
        JSON.stringify({
          isVoiceEnabled: next,
          selectedModelId: get().selectedModelId,
          customModelPath: get().customModelPath,
          language: get().language,
        }),
      );
    },

    selectModel: (modelId) => {
      set({ selectedModelId: modelId, customModelPath: null });
      localStorage.setItem(
        "sythoria-whisper-config",
        JSON.stringify({
          isVoiceEnabled: get().isVoiceEnabled,
          selectedModelId: modelId,
          customModelPath: null,
          language: get().language,
        }),
      );
    },

    setCustomModelPath: (path) => {
      set({ customModelPath: path, selectedModelId: "custom" });
      localStorage.setItem(
        "sythoria-whisper-config",
        JSON.stringify({
          isVoiceEnabled: get().isVoiceEnabled,
          selectedModelId: "custom",
          customModelPath: path,
          language: get().language,
        }),
      );
    },

    setLanguage: (lang) => {
      set({ language: lang });
      localStorage.setItem(
        "sythoria-whisper-config",
        JSON.stringify({
          isVoiceEnabled: get().isVoiceEnabled,
          selectedModelId: get().selectedModelId,
          customModelPath: get().customModelPath,
          language: lang,
        }),
      );
    },

    downloadModel: async (modelId) => {
      const preset = WHISPER_PRESETS.find((p) => p.id === modelId);
      if (!preset || get().isDownloading) return;

      downloadCancelled = false;
      set({ isDownloading: true, downloadProgress: 0, downloadingModelId: modelId });
      logInfo("general", `Starting download of Whisper model: ${preset.name}`);

      try {
        await invoke("download_whisper_model", {
          modelId,
          url: preset.url,
        });
      } catch (err) {
        if (!downloadCancelled) {
          set({ isDownloading: false, downloadProgress: 0, downloadingModelId: null });
          logError("general", `Failed to download Whisper model: ${err}`);
        }
      }
    },

    cancelDownload: async () => {
      downloadCancelled = true;
      set({ isDownloading: false, downloadProgress: 0, downloadingModelId: null });
      try {
        await invoke("cancel_whisper_download");
      } catch (err) {
        logError("general", `Failed to cancel download: ${err}`);
      }
    },

    deleteModel: async (fileName) => {
      try {
        await invoke("delete_whisper_model", { fileName });
        set((state) => ({
          downloadedFiles: state.downloadedFiles.filter((f) => f !== fileName),
          selectedModelId:
            get().selectedModelId === WHISPER_PRESETS.find((p) => p.fileName === fileName)?.id
              ? "tiny.en"
              : get().selectedModelId,
        }));
        get().init();
      } catch (err) {
        logError("general", `Failed to delete Whisper model: ${err}`);
      }
    },

    setIsRecording: (recording) => set({ isRecording: recording }),
    setIsTranscribing: (transcribing) => set({ isTranscribing: transcribing }),
  };
});
export default useWhisperStore;
