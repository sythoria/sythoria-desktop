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
  sttProvider: "local" | "cloud";
  cloudApiKey: string;
  cloudApiUrl: string;
  cloudModel: string;
  refinementModelId: string | null;
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
  setSttProvider: (provider: "local" | "cloud") => void;
  setCloudApiKey: (key: string) => void;
  setCloudApiUrl: (url: string) => void;
  setCloudModel: (model: string) => void;
  setRefinementModelId: (id: string | null) => void;
  downloadModel: (modelId: string) => Promise<void>;
  cancelDownload: () => Promise<void>;
  deleteModel: (fileName: string) => Promise<void>;

  setIsRecording: (recording: boolean) => void;
  setIsTranscribing: (transcribing: boolean) => void;
}

const DEFAULT_CONFIG: WhisperConfig = {
  isVoiceEnabled: true,
  selectedModelId: "tiny.en",
  customModelPath: null,
  language: "en",
  sttProvider: "local",
  cloudApiKey: "",
  cloudApiUrl: "https://api.groq.com/openai/v1/audio/transcriptions",
  cloudModel: "whisper-large-v3",
  refinementModelId: null,
};

let downloadCancelled = false;
let isListening = false;

const saveConfig = (state: WhisperConfig) => {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(
      "sythoria-whisper-config",
      JSON.stringify({
        isVoiceEnabled: state.isVoiceEnabled,
        selectedModelId: state.selectedModelId,
        customModelPath: state.customModelPath,
        language: state.language,
        sttProvider: state.sttProvider,
        cloudApiKey: state.cloudApiKey,
        cloudApiUrl: state.cloudApiUrl,
        cloudModel: state.cloudModel,
        refinementModelId: state.refinementModelId,
      }),
    );
  }
};

export const useWhisperStore = create<WhisperState>((set, get) => {
  return {
    ...DEFAULT_CONFIG,
    downloadedFiles: [],
    isDownloading: false,
    downloadProgress: 0,
    downloadingModelId: null,
    isRecording: false,
    isTranscribing: false,

    init: async () => {
      if (!isListening) {
        try {
          await listen<any>("whisper-download-progress", (event) => {
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
          isListening = true;
        } catch (e) {
          logError("general", `Failed to set up whisper download listener: ${e}`);
        }
      }

      try {
        let savedConfig: Partial<WhisperConfig> = {};
        const localData = typeof localStorage !== "undefined" ? localStorage.getItem("sythoria-whisper-config") : null;
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
      saveConfig(get());
    },

    selectModel: (modelId) => {
      set({ selectedModelId: modelId, customModelPath: null });
      saveConfig(get());
    },

    setCustomModelPath: (path) => {
      set({ customModelPath: path, selectedModelId: "custom" });
      saveConfig(get());
    },

    setLanguage: (lang) => {
      set({ language: lang });
      saveConfig(get());
    },

    setSttProvider: (provider) => {
      set({ sttProvider: provider });
      saveConfig(get());
    },

    setCloudApiKey: (key) => {
      set({ cloudApiKey: key });
      saveConfig(get());
    },

    setCloudApiUrl: (url) => {
      set({ cloudApiUrl: url });
      saveConfig(get());
    },

    setCloudModel: (model) => {
      set({ cloudModel: model });
      saveConfig(get());
    },

    setRefinementModelId: (id) => {
      set({ refinementModelId: id });
      saveConfig(get());
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
