import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ModelConfig, ConnectionStatus, ModelStatuses } from "../types";
import { saveModelConfigs } from "../types";
import { saveApiKeys } from "../utils/storage";
import { logError } from "../utils/logger";
import { DEFAULT_TEMPERATURE } from "../config/constants";
import { validateModelConfig } from "../utils/validation";
import { useUIStore } from "./useUIStore";

interface StreamChunkPayload {
  streamId: string;
  content: string;
}

interface StreamDonePayload {
  streamId: string;
}

let activeStreamId: string | null = null;
let activeStreamConversationId: string | null = null;
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
    if (!activeStreamId || event.payload.streamId !== activeStreamId || !activeStreamConversationId) return;
    onChunk(activeStreamConversationId, event.payload.content);
  });

  const unlistenDone = await listen<StreamDonePayload>("chat-stream-done", (event) => {
    if (!activeStreamId || event.payload.streamId !== activeStreamId || !activeStreamConversationId) return;
    onDone(activeStreamConversationId);
    activeStreamId = null;
    activeStreamConversationId = null;
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

  setSelectedModel: (model: string) => void;
  setTemperature: (t: number) => void;
  updateModels: (models: ModelConfig[]) => void;
  updateModel: (id: string, updates: Partial<ModelConfig>) => void;
  deleteModel: (id: string) => void;
  addModel: () => void;
  checkModelConnections: (modelIds?: string[]) => Promise<void>;
  startHealthCheck: () => void;
  stopHealthCheck: () => void;
  persistApiKeys: () => Promise<void>;

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

  updateModels: (models) => {
    const validationResults = models.map((m) => validateModelConfig(m));
    const hasErrors = validationResults.some((r) => !r.success);
    if (hasErrors) {
      const errors = validationResults
        .filter((r) => !r.success)
        .flatMap((r) => (!r.success ? r.error.issues.map((i) => i.message) : []));
      useUIStore.getState().addToast(`Validation: ${errors[0]}`, "error");
      return;
    }
    set({ models });
    saveModelConfigs(models.map(({ apiKey: _apiKey, ...rest }) => rest as ModelConfig));
    const keys: Record<string, string> = {};
    models.forEach((m) => {
      if (m.apiKey) keys[m.id] = m.apiKey;
    });
    set({ apiKeys: keys });
    saveApiKeys(keys);
    useUIStore.getState().addToast("Models updated", "success");
  },

  updateModel: (id, updates) => {
    const { models, apiKeys, modelStatuses } = get();
    const updatedModels = models.map((m) => (m.id === id ? { ...m, ...updates } : m));
    set({ models: updatedModels });
    saveModelConfigs(updatedModels.map(({ apiKey: _apiKey, ...rest }) => rest as ModelConfig));

    if (updates.apiKey !== undefined) {
      const newKeys = { ...apiKeys, [id]: updates.apiKey };
      set({ apiKeys: newKeys });
      saveApiKeys(newKeys);
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
  },

  deleteModel: (id) => {
    const { models, selectedModel, apiKeys, modelStatuses } = get();
    const updated = models.filter((m) => m.id !== id);
    const newKeys = { ...apiKeys };
    delete newKeys[id];
    const newStatuses = { ...modelStatuses };
    delete newStatuses[id];
    set({ models: updated, apiKeys: newKeys, modelStatuses: newStatuses });
    saveModelConfigs(updated.map(({ apiKey: _apiKey, ...rest }) => rest as ModelConfig));
    saveApiKeys(newKeys);
    if (selectedModel === id && updated.length > 0) {
      set({ selectedModel: updated[0].id });
    }
    useUIStore.getState().addToast("Model deleted", "info");
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
    saveModelConfigs(updated.map(({ apiKey: _apiKey, ...rest }) => rest as ModelConfig));
    useUIStore.getState().addToast("Model added — configure its details", "info");
  },

  checkModelConnections: async (modelIds?: string[]) => {
    const { models, apiKeys, modelStatuses } = get();
    if (useUIStore.getState().loading.checkConnection) return;
    const now = Date.now();
    if (now - lastCheckTime < MIN_CHECK_INTERVAL_MS) return;
    lastCheckTime = now;
    const toCheck = modelIds
      ? models.filter((m) => modelIds.includes(m.id) && m.enabled !== false)
      : models.filter((m) => m.enabled !== false);

    if (toCheck.length === 0) return;

    useUIStore.getState().setLoading("checkConnection", true);

    const updating: ModelStatuses = { ...modelStatuses };
    for (const model of toCheck) {
      updating[model.id] = "connecting";
    }
    set({ modelStatuses: updating });

    const results = await Promise.allSettled(
      toCheck.map(async (model) => {
        const apiKey = apiKeys[model.id] ?? model.apiKey ?? "";
        try {
          const ok = await invoke<boolean>("check_api", {
            apiUrl: model.apiBase,
            apiKey,
          });
          return { id: model.id, status: (ok ? "connected" : "error") as ConnectionStatus };
        } catch {
          return { id: model.id, status: "error" as ConnectionStatus };
        }
      }),
    );

    const newStatuses: ModelStatuses = { ...get().modelStatuses };
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const model = toCheck[i];
      if (result.status === "fulfilled") {
        newStatuses[model.id] = result.value.status;
      } else {
        newStatuses[model.id] = "error";
      }
    }

    set({ modelStatuses: newStatuses });
    useUIStore.getState().setLoading("checkConnection", false);
  },

  startHealthCheck: () => {
    if (healthCheckInterval) return;
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

  getActiveStreamId: () => activeStreamId,
  setActiveStreamId: (id, convId = null) => {
    activeStreamId = id;
    activeStreamConversationId = convId;
  },
  ensureStreamListeners,
  releaseStreamListeners,
  cancelActiveStream: () => {
    const streamId = activeStreamId;
    activeStreamId = null;
    activeStreamConversationId = null;
    if (streamId) {
      void invoke("cancel_chat_stream", { streamId }).catch((err: unknown) => {
        logError("Failed to cancel stream", err);
      });
    }
    releaseStreamListeners();
  },
}));
