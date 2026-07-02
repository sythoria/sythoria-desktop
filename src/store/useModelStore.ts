import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ModelConfig, ConnectionStatus, ModelStatuses, TitleGenerationConfig } from "../types";
import { DEFAULT_TITLE_SYSTEM_PROMPT } from "../types";
import { saveModelConfigs, saveApiKeys, saveTitleConfig, saveSystemPrompt, saveMaxToolSteps } from "../utils/storage";
import { logError, logWarn, logInfo } from "../utils/logger";
import { parseApiError } from "../utils/parseApiError";
import { DEFAULT_TEMPERATURE, DEFAULT_MAX_TOOL_STEPS } from "../config/constants";
import { validateModelConfig } from "../utils/validation";
import { useUIStore } from "./useUIStore";
import { debounce } from "../utils/debounce";

const debouncedSaveModelConfigs = debounce((configs: ModelConfig[]) => {
  saveModelConfigs(configs);
}, 500);

const debouncedSaveApiKeys = debounce((keys: Record<string, string>) => {
  saveApiKeys(keys);
}, 500);

const debouncedLogModelUpdate = debounce((name: string, fields: string[]) => {
  logInfo("model", `Model config updated: "${name}"`, {
    details: `Updated fields: ${fields.join(", ")}`,
  });
}, 500);

interface StreamChunkPayload {
  streamId: string;
  content: string;
}

interface StreamDonePayload {
  streamId: string;
}

const activeStreams = new Map<string, string>();
let streamListenerCleanup: (() => void) | null = null;
let streamListenerRefCount = 0;
let healthCheckInterval: ReturnType<typeof setInterval> | null = null;
const HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const MIN_CHECK_INTERVAL_MS = 30 * 1000;
let lastCheckTime = 0;

async function ensureStreamListeners(
  onChunk: (convId: string, content: string) => void,
  onDone: (convId: string) => void,
) {
  streamListenerRefCount++;
  if (streamListenerCleanup) return;

  const unlistenChunk = await listen<StreamChunkPayload>("chat-stream-chunk", (event) => {
    const convId = activeStreams.get(event.payload.streamId);
    if (!convId) return;
    onChunk(convId, event.payload.content);
  });

  const unlistenDone = await listen<StreamDonePayload>("chat-stream-done", (event) => {
    const convId = activeStreams.get(event.payload.streamId);
    if (!convId) return;
    onDone(convId);
    activeStreams.delete(event.payload.streamId);
  });

  streamListenerCleanup = () => {
    unlistenChunk();
    unlistenDone();
    streamListenerCleanup = null;
  };
}

function releaseStreamListeners() {
  streamListenerRefCount--;
  if (streamListenerRefCount <= 0 && streamListenerCleanup) {
    streamListenerCleanup();
    streamListenerRefCount = 0;
  }
}

interface ModelState {
  models: ModelConfig[];
  selectedModel: string;
  temperature: number;
  apiKeys: Record<string, string>;
  modelStatuses: ModelStatuses;
  titleConfig: TitleGenerationConfig;
  systemPrompt: string;
  maxToolSteps: number;

  setSelectedModel: (model: string) => void;
  setTemperature: (t: number) => void;
  setMaxToolSteps: (steps: number) => void;
  updateModels: (models: ModelConfig[]) => void;
  updateModel: (id: string, updates: Partial<ModelConfig>) => void;
  deleteModel: (id: string) => void;
  addModel: () => void;
  checkModelConnections: (modelIds?: string[], force?: boolean) => Promise<void>;
  startHealthCheck: () => void;
  stopHealthCheck: () => void;
  persistApiKeys: () => Promise<void>;
  setTitleConfig: (updates: Partial<TitleGenerationConfig>) => void;
  setSystemPrompt: (prompt: string) => void;

  getActiveStreamId: () => string | null;
  setActiveStreamId: (id: string | null, convId?: string | null) => void;
  ensureStreamListeners: (
    onChunk: (convId: string, content: string) => void,
    onDone: (convId: string) => void,
  ) => Promise<void>;
  releaseStreamListeners: () => void;
  cancelActiveStream: () => void;
}

export const useModelStore = create<ModelState>((set, get) => ({
  models: [],
  selectedModel: "",
  temperature: DEFAULT_TEMPERATURE,
  apiKeys: {},
  modelStatuses: {},
  titleConfig: { enabled: true, modelId: "__same__", systemPrompt: DEFAULT_TITLE_SYSTEM_PROMPT },
  systemPrompt: "",
  maxToolSteps: DEFAULT_MAX_TOOL_STEPS,

  setSelectedModel: (model) => {
    const { models, modelStatuses } = get();
    const target = models.find((m) => m.id === model);
    if (target && target.enabled === false) return;
    set({ selectedModel: model });
    if (!modelStatuses[model]) {
      get().checkModelConnections([model]);
    }
  },
  setTemperature: (t) => set({ temperature: t }),
  setMaxToolSteps: (t) => {
    set({ maxToolSteps: t });
    saveMaxToolSteps(t);
  },

  updateModels: (models) => {
    const validationResults = models.map((m) => validateModelConfig(m));
    const hasErrors = validationResults.some((r) => !r.success);
    if (hasErrors) {
      const errors = validationResults
        .filter((r) => !r.success)
        .flatMap((r) => (!r.success ? r.error.issues.map((i) => i.message) : []));
      logWarn("model", `Model validation failed: ${errors[0]}`, {
        details: errors.join("; "),
        action: "Fix the model configuration fields highlighted in Settings > Models.",
      });
      useUIStore.getState().addToast(`Validation: ${errors[0]}`, "error");
      return;
    }
    set({ models });
    debouncedSaveModelConfigs.cancel();
    saveModelConfigs(models.map(({ apiKey: _apiKey, ...rest }) => rest as ModelConfig));
    const keys: Record<string, string> = {};
    models.forEach((m) => {
      if (m.apiKey) keys[m.id] = m.apiKey;
    });
    set({ apiKeys: keys });
    debouncedSaveApiKeys.cancel();
    saveApiKeys(keys);
    logInfo("model", "Models updated successfully", { details: `${models.length} model(s) saved` });
    useUIStore.getState().addToast("Models updated", "success");
  },

  updateModel: (id, updates) => {
    const { models, apiKeys, modelStatuses } = get();
    const updatedModels = models.map((m) => (m.id === id ? { ...m, ...updates } : m));
    set({ models: updatedModels });
    debouncedSaveModelConfigs(updatedModels.map(({ apiKey: _apiKey, ...rest }) => rest as ModelConfig));

    if (updates.apiKey !== undefined) {
      const newKeys = { ...apiKeys, [id]: updates.apiKey };
      set({ apiKeys: newKeys });
      debouncedSaveApiKeys(newKeys);
    }

    if (updates.enabled === false) {
      const newStatuses = { ...modelStatuses, [id]: "disconnected" as const };
      set({ modelStatuses: newStatuses });
    } else if (updates.enabled === true) {
      get().checkModelConnections([id]);
    } else if (
      updates.apiBase !== undefined ||
      updates.apiKey !== undefined ||
      updates.modelId !== undefined ||
      updates.provider !== undefined
    ) {
      const newStatuses = { ...modelStatuses, [id]: "disconnected" as const };
      set({ modelStatuses: newStatuses });
    }

    const { selectedModel } = get();
    const enabledModels = updatedModels.filter((m) => m.enabled !== false);
    if (enabledModels.length > 0 && !enabledModels.find((m) => m.id === selectedModel)) {
      set({ selectedModel: enabledModels[0].id });
    } else if (enabledModels.length === 0 && updatedModels.length > 0) {
      set({ selectedModel: updatedModels[0].id });
    }

    const updatedModel = updatedModels.find((m) => m.id === id);
    if (updatedModel && Object.keys(updates).length > 0) {
      debouncedLogModelUpdate(updatedModel.name, Object.keys(updates));
    }
  },

  deleteModel: (id) => {
    const { models, selectedModel, apiKeys, modelStatuses } = get();
    const updated = models.filter((m) => m.id !== id);
    const newKeys = { ...apiKeys };
    delete newKeys[id];
    const newStatuses = { ...modelStatuses };
    delete newStatuses[id];
    set({ models: updated, apiKeys: newKeys, modelStatuses: newStatuses });
    debouncedSaveModelConfigs.cancel();
    debouncedSaveApiKeys.cancel();
    saveModelConfigs(updated.map(({ apiKey: _apiKey, ...rest }) => rest as ModelConfig));
    saveApiKeys(newKeys);
    if (selectedModel === id && updated.length > 0) {
      set({ selectedModel: updated[0].id });
    }
    useUIStore.getState().addToast("Model deleted", "info");
    logInfo("model", `Model deleted`, { details: `Model ID: ${id}` });
  },

  addModel: () => {
    const newModel: ModelConfig = {
      id: "custom-" + Date.now(),
      name: "New Model",
      apiBase: "https://api.openai.com/v1/chat/completions",
      apiKey: "",
      modelId: "gpt-4o",
      provider: "OpenAI",
      enabled: true,
    };
    const { models } = get();
    const updated = [...models, newModel];
    set({ models: updated });
    debouncedSaveModelConfigs.cancel();
    saveModelConfigs(updated.map(({ apiKey: _apiKey, ...rest }) => rest as ModelConfig));
    logInfo("model", `Model added: "${newModel.name}"`, {
      details: `ID: ${newModel.id}, Provider: ${newModel.provider}, Model: ${newModel.modelId}`,
    });
    useUIStore.getState().addToast("Model added — configure its details", "info");
  },

  checkModelConnections: async (modelIds?: string[], force?: boolean) => {
    if (useUIStore.getState().disableBgActivity && !force) return;
    const { models, modelStatuses } = get();
    if (!force) {
      if (useUIStore.getState().loading.checkConnection) return;
      const now = Date.now();
      if (now - lastCheckTime < MIN_CHECK_INTERVAL_MS) return;
    }
    lastCheckTime = Date.now();
    const toCheck = modelIds
      ? models.filter((m) => modelIds.includes(m.id) && m.enabled !== false)
      : models.filter((m) => m.enabled !== false);

    if (toCheck.length === 0) return;

    logInfo("model", `Checking connections for ${toCheck.length} model(s)`, {
      details: toCheck.map((m) => `${m.name} (${m.apiBase})`).join(", "),
    });
    useUIStore.getState().setLoading("checkConnection", true);

    const updating: ModelStatuses = { ...modelStatuses };
    for (const model of toCheck) {
      updating[model.id] = "connecting";
    }
    set({ modelStatuses: updating });

    const results = await Promise.allSettled(
      toCheck.map(async (model) => {
        try {
          const ok = await invoke<boolean>("check_api", {
            configId: model.id,
          });
          return { id: model.id, status: (ok ? "connected" : "error") as ConnectionStatus };
        } catch (err) {
          const parsed = parseApiError(err);
          return { id: model.id, status: "error" as ConnectionStatus, errorDetail: parsed.raw || parsed.message };
        }
      }),
    );

    const newStatuses: ModelStatuses = { ...get().modelStatuses };
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const model = toCheck[i];
      if (result.status === "fulfilled") {
        newStatuses[model.id] = result.value.status;
        if (result.value.status === "connected") {
          logInfo("model", `Health check passed for "${model.name}"`, {
            details: `API base: ${model.apiBase}`,
          });
        } else {
          const detail = (result.value as { errorDetail?: string }).errorDetail;
          logWarn("model", `Health check failed for "${model.name}"`, {
            details: `API base: ${model.apiBase}, Model ID: ${model.modelId}${detail ? `. Raw: ${detail}` : ""}`,
            action:
              "Check your API key, base URL, and that the model is accessible. Click 'Check Connection' in Settings > Models.",
          });
        }
      } else {
        newStatuses[model.id] = "error";
        logError("model", `Health check error for "${model.name}"`, {
          error: result.reason,
          action: "Check your internet connection and the API base URL in Settings > Models.",
        });
      }
    }

    set({ modelStatuses: newStatuses });
    useUIStore.getState().setLoading("checkConnection", false);
  },

  startHealthCheck: () => {
    if (healthCheckInterval) return;
    if (useUIStore.getState().disableBgActivity) return;
    healthCheckInterval = setInterval(() => {
      get().checkModelConnections();
    }, HEALTH_CHECK_INTERVAL_MS);
  },

  stopHealthCheck: () => {
    if (healthCheckInterval) {
      clearInterval(healthCheckInterval);
      healthCheckInterval = null;
    }
  },

  persistApiKeys: async () => {
    const { apiKeys } = get();
    await saveApiKeys(apiKeys);
  },

  setTitleConfig: (updates) => {
    const { titleConfig } = get();
    const newConfig = { ...titleConfig, ...updates };
    set({ titleConfig: newConfig });
    saveTitleConfig(newConfig);
  },

  setSystemPrompt: (prompt) => {
    set({ systemPrompt: prompt });
    saveSystemPrompt(prompt);
  },

  getActiveStreamId: () => {
    return activeStreams.keys().next().value ?? null;
  },
  setActiveStreamId: (id, convId = null) => {
    if (id) {
      if (convId) {
        logInfo("stream", `Stream started`, {
          details: `Stream ID: ${id}, Conversation: ${convId}`,
        });
        activeStreams.set(id, convId);
      }
    } else {
      activeStreams.clear();
    }
  },
  ensureStreamListeners,
  releaseStreamListeners,
  cancelActiveStream: () => {
    for (const streamId of activeStreams.keys()) {
      void invoke("cancel_chat_stream", { streamId }).catch((err: unknown) => {
        logError("stream", "Failed to cancel stream", {
          error: err,
          action: "The stream may have already ended. If the UI is stuck, try reloading the app.",
        });
      });
    }
    activeStreams.clear();
    releaseStreamListeners();
  },
}));
