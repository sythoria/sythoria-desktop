import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Conversation, Message, ModelConfig, ConnectionStatus, ModelStatuses } from "../types";
import { loadModelConfigs, saveModelConfigs } from "../types";
import {
  loadConversations,
  saveConversations,
  loadTheme,
  saveTheme,
  loadApiKeys,
  saveApiKeys,
  clearConversations,
} from "../utils/storage";
import { generateId } from "../utils/generateId";
import { logError, logInfo } from "../utils/logger";
import { TITLE_MAX_LENGTH, DEFAULT_TEMPERATURE } from "../config/constants";
import { parseApiError } from "../components/ui/Toast";
import type { Toast } from "../components/ui/Toast";
import { validateModelConfig } from "../utils/validation";

let activeStreamId: string | null = null;
let streamListenerCleanup: (() => void) | null = null;
let streamListenerRefCount = 0;
let healthCheckInterval: ReturnType<typeof setInterval> | null = null;

async function ensureStreamListeners(set: (fn: (state: AppState) => Partial<AppState>) => void) {
  streamListenerRefCount++;
  if (streamListenerCleanup) return;

  const unlistenChunk = await listen<string>("chat-stream-chunk", (event) => {
    if (!activeStreamId) return;
    const convId = activeStreamId;
    set((state) => ({
      conversations: state.conversations.map((c) => {
        if (c.id !== convId) return c;
        const updated = [...c.messages];
        const last = updated[updated.length - 1];
        if (last && last.role === "assistant") {
          updated[updated.length - 1] = { ...last, content: last.content + event.payload };
        }
        return { ...c, messages: updated };
      }),
    }));
  });

  const unlistenDone = await listen("chat-stream-done", () => {
    if (!activeStreamId) return;
    const convId = activeStreamId;
    set((state) => ({
      conversations: state.conversations.map((c) => {
        if (c.id !== convId) return c;
        const updated = [...c.messages];
        const last = updated[updated.length - 1];
        if (last && last.role === "assistant") {
          updated[updated.length - 1] = { ...last, isStreaming: false };
        }
        return { ...c, messages: updated };
      }),
      isStreaming: false,
    }));
    activeStreamId = null;
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

function truncateTitle(text: string): string {
  return text.length > TITLE_MAX_LENGTH ? text.slice(0, TITLE_MAX_LENGTH) + "\u2026" : text;
}

function updateConversationMessages(
  conversations: Conversation[],
  convId: string,
  updater: (msgs: Message[]) => Message[],
  extra?: Partial<Conversation>,
): Conversation[] {
  return conversations.map((c) => {
    if (c.id !== convId) return c;
    return { ...c, messages: updater(c.messages), timestamp: new Date(), ...extra };
  });
}

function finalizeAssistantMessage(conversations: Conversation[], convId: string): Conversation[] {
  return updateConversationMessages(conversations, convId, (msgs) => {
    const updated = [...msgs];
    const last = updated[updated.length - 1];
    if (last && last.role === "assistant" && last.isStreaming) {
      updated[updated.length - 1] = { ...last, isStreaming: false };
    }
    return updated;
  });
}

function setAssistantError(conversations: Conversation[], convId: string, err: unknown): Conversation[] {
  const friendlyMessage = parseApiError(err);
  return updateConversationMessages(conversations, convId, (msgs) => {
    const updated = [...msgs];
    const last = updated[updated.length - 1];
    if (last && last.role === "assistant") {
      updated[updated.length - 1] = { ...last, content: `**Error:** ${friendlyMessage}`, isStreaming: false };
    }
    return updated;
  });
}

export type LoadingKey = "init" | "sendMessage" | "checkConnection" | "saveConfig";

interface AppState {
  conversations: Conversation[];
  activeId: string | null;
  models: ModelConfig[];
  selectedModel: string;
  temperature: number;
  sidebarOpen: boolean;
  isStreaming: boolean;
  modelStatuses: ModelStatuses;
  hasStarted: boolean;
  isConfigLoaded: boolean;
  view: "chat" | "settings";
  theme: "light" | "dark";
  apiKeys: Record<string, string>;
  showRenameModal: boolean;
  renameId: string | null;
  renameCurrentTitle: string;
  loading: Record<LoadingKey, boolean>;
  toasts: Toast[];

  init: () => Promise<void>;
  cleanupEmptyConversations: () => void;
  setActiveId: (id: string | null) => void;
  setSelectedModel: (model: string) => void;
  setTemperature: (t: number) => void;
  setSidebarOpen: (open: boolean) => void;
  setView: (view: "chat" | "settings") => void;
  setTheme: (theme: "light" | "dark") => void;
  setHasStarted: (started: boolean) => void;
  addToast: (message: string, variant?: Toast["variant"]) => void;
  dismissToast: (id: string) => void;
  updateModels: (models: ModelConfig[]) => void;
  updateModel: (id: string, updates: Partial<ModelConfig>) => void;
  deleteModel: (id: string) => void;
  addModel: () => void;
  newChat: () => string;
  deleteChat: (id: string) => void;
  renameChat: (id: string, newTitle: string) => void;
  openRenameModal: (id: string, currentTitle: string) => void;
  closeRenameModal: () => void;
  confirmRename: (newTitle: string) => void;
  sendMessage: (text: string) => Promise<void>;
  stopStreaming: () => void;
  exportChat: (id: string) => void;
  persistConversations: () => Promise<void>;
  persistApiKeys: () => Promise<void>;
  clearAllChats: () => Promise<void>;
  checkModelConnections: (modelIds?: string[]) => Promise<void>;
  startHealthCheck: () => void;
  stopHealthCheck: () => void;
  cleanup: () => void;
}

let toastCounter = 0;

export const useAppStore = create<AppState>((set, get) => ({
  conversations: [],
  activeId: null,
  models: [],
  selectedModel: "",
  temperature: DEFAULT_TEMPERATURE,
  sidebarOpen: false,
  isStreaming: false,
  modelStatuses: {},
  hasStarted: false,
  isConfigLoaded: false,
  view: "chat",
  theme: "dark",
  apiKeys: {},
  showRenameModal: false,
  renameId: null,
  renameCurrentTitle: "",
  loading: { init: true, sendMessage: false, checkConnection: false, saveConfig: false },
  toasts: [],

  init: async () => {
    set((s) => ({ loading: { ...s.loading, init: true } }));
    try {
      const [loadedModels, loadedConvs, loadedTheme, loadedKeys] = await Promise.all([
        loadModelConfigs(),
        loadConversations(),
        loadTheme(),
        loadApiKeys(),
      ]);

      const models = loadedModels || [];
      const modelsWithKeys = models.map((m) => ({
        ...m,
        apiKey: loadedKeys[m.id] ?? m.apiKey,
      }));

      const nonEmptyConvs = loadedConvs.filter((c) => c.messages.length > 0);

      set({
        models: modelsWithKeys,
        selectedModel: modelsWithKeys.length > 0 ? modelsWithKeys[0].id : "",
        conversations: nonEmptyConvs,
        activeId: nonEmptyConvs.length > 0 ? nonEmptyConvs[0].id : null,
        theme: loadedTheme,
        apiKeys: loadedKeys,
        hasStarted: modelsWithKeys.length > 0,
        isConfigLoaded: true,
      });

      document.documentElement.classList.toggle("dark", loadedTheme === "dark");
      logInfo("App state initialized");

      get().checkModelConnections();
      get().startHealthCheck();
    } catch (err) {
      logError("Failed to initialize app", err);
      get().addToast(parseApiError(err), "error");
      set({ isConfigLoaded: true });
    } finally {
      set((s) => ({ loading: { ...s.loading, init: false } }));
    }
  },

  cleanupEmptyConversations: () => {
    const { conversations, activeId } = get();
    const nonEmpty = conversations.filter((c) => c.messages.length > 0);
    if (nonEmpty.length === conversations.length) return;
    const activeRemoved = activeId && !nonEmpty.find((c) => c.id === activeId);
    set({
      conversations: nonEmpty,
      ...(activeRemoved ? { activeId: nonEmpty.length > 0 ? nonEmpty[0].id : null } : {}),
    });
  },

  setActiveId: (id) => {
    const { activeId } = get();
    if (activeId === id) return;
    get().cleanupEmptyConversations();
    set({ activeId: id });
  },

  setSelectedModel: (model) => {
    set({ selectedModel: model });
    const { modelStatuses } = get();
    if (!modelStatuses[model]) {
      get().checkModelConnections([model]);
    }
  },

  setTemperature: (t) => set({ temperature: t }),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),

  setView: (view) => {
    get().cleanupEmptyConversations();
    set({ view });
  },

  setHasStarted: (started) => set({ hasStarted: started }),

  addToast: (message, variant = "info") => {
    const id = `toast-${++toastCounter}`;
    set((s) => ({ toasts: [...s.toasts, { id, message, variant }] }));
  },

  dismissToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  setTheme: (theme) => {
    set({ theme });
    document.documentElement.classList.toggle("dark", theme === "dark");
    saveTheme(theme);
  },

  updateModels: (models) => {
    const validationResults = models.map((m) => validateModelConfig(m));
    const hasErrors = validationResults.some((r) => !r.success);
    if (hasErrors) {
      const errors = validationResults
        .filter((r) => !r.success)
        .flatMap((r) => (!r.success ? r.error.issues.map((i) => i.message) : []));
      get().addToast(`Validation: ${errors[0]}`, "error");
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
    get().checkModelConnections(models.map((m) => m.id));
    get().addToast("Models updated", "success");
  },

  updateModel: (id, updates) => {
    const { models, apiKeys } = get();
    const updatedModels = models.map((m) => (m.id === id ? { ...m, ...updates } : m));
    set({ models: updatedModels });
    saveModelConfigs(updatedModels.map(({ apiKey: _apiKey, ...rest }) => rest as ModelConfig));

    if (updates.apiKey !== undefined) {
      const newKeys = { ...apiKeys, [id]: updates.apiKey };
      set({ apiKeys: newKeys });
      saveApiKeys(newKeys);
    }

    if (updates.apiBase || updates.apiKey !== undefined) {
      get().checkModelConnections([id]);
    }

    const { selectedModel } = get();
    if (!updatedModels.find((m) => m.id === selectedModel) && updatedModels.length > 0) {
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
    get().addToast("Model deleted", "info");
  },

  addModel: () => {
    const newModel: ModelConfig = {
      id: "custom-" + Date.now(),
      name: "New Model",
      apiBase: "https://api.openai.com/v1/chat/completions",
      apiKey: "",
      modelId: "gpt-4o",
      provider: "OpenAI",
    };
    const { models } = get();
    const updated = [...models, newModel];
    set({ models: updated });
    saveModelConfigs(updated.map(({ apiKey: _apiKey, ...rest }) => rest as ModelConfig));
    get().checkModelConnections([newModel.id]);
    get().addToast("Model added — configure its details", "info");
  },

  newChat: () => {
    const { selectedModel, models } = get();
    const id = generateId();
    const modelConfig = models.find((m) => m.id === selectedModel);
    const conv: Conversation = {
      id,
      title: "New chat",
      timestamp: new Date(),
      messages: [],
      model: modelConfig?.id || selectedModel,
    };
    set((state) => ({
      conversations: [conv, ...state.conversations],
      activeId: id,
      sidebarOpen: false,
      view: "chat",
    }));
    return id;
  },

  deleteChat: (id) => {
    set((state) => ({
      conversations: state.conversations.filter((c) => c.id !== id),
      activeId: state.activeId === id ? null : state.activeId,
    }));
    get().persistConversations();
  },

  renameChat: (id, newTitle) => {
    set((state) => ({
      conversations: state.conversations.map((c) => (c.id === id ? { ...c, title: newTitle } : c)),
    }));
    get().persistConversations();
  },

  openRenameModal: (id, currentTitle) => {
    set({ renameId: id, renameCurrentTitle: currentTitle, showRenameModal: true });
  },

  closeRenameModal: () => {
    set({ showRenameModal: false, renameId: null, renameCurrentTitle: "" });
  },

  confirmRename: (newTitle) => {
    const { renameId } = get();
    if (renameId) {
      get().renameChat(renameId, newTitle);
    }
    set({ showRenameModal: false, renameId: null, renameCurrentTitle: "" });
  },

  sendMessage: async (text) => {
    const { isStreaming, activeId, selectedModel, models, temperature, conversations, apiKeys } = get();
    if (isStreaming) return;

    let convId = activeId;

    if (!convId) {
      const id = generateId();
      const modelConfig = models.find((m) => m.id === selectedModel);
      const conv: Conversation = {
        id,
        title: truncateTitle(text),
        timestamp: new Date(),
        messages: [],
        model: modelConfig?.id || selectedModel,
      };
      set((state) => ({
        conversations: [conv, ...state.conversations],
        activeId: id,
      }));
      convId = id;
    }

    const userMsg: Message = { id: generateId(), role: "user", content: text, timestamp: new Date() };
    const assistantMsg: Message = {
      id: generateId(),
      role: "assistant",
      content: "",
      timestamp: new Date(),
      isStreaming: true,
    };

    const finalId = convId;
    const modelConfig = models.find((m) => m.id === selectedModel) ?? models[0];

    if (!modelConfig) {
      logError("No model configuration selected");
      get().addToast("No model configured — add one in Settings", "error");
      return;
    }

    set((state) => ({
      isStreaming: true,
      loading: { ...state.loading, sendMessage: true },
      conversations: updateConversationMessages(
        state.conversations,
        finalId,
        (msgs) => [...msgs, userMsg, assistantMsg],
        {
          title:
            state.conversations.find((c) => c.id === finalId)?.messages.length === 0 ? truncateTitle(text) : undefined,
        },
      ),
    }));

    activeStreamId = finalId;
    await ensureStreamListeners(set);

    try {
      const apiUrl = modelConfig.apiBase;
      const apiKey = apiKeys[modelConfig.id] || modelConfig.apiKey;

      await invoke("chat_stream", {
        apiUrl,
        apiKey,
        model: modelConfig.modelId,
        messages: [
          ...(conversations
            .find((c) => c.id === finalId)
            ?.messages.map((m) => ({
              role: m.role,
              content: m.content,
            })) ?? []),
          { role: "user", content: text },
        ],
        temperature,
      });

      set((state) => ({
        conversations: finalizeAssistantMessage(state.conversations, finalId),
      }));

      get().persistConversations();
    } catch (err) {
      const friendlyMessage = parseApiError(err);
      activeStreamId = null;
      releaseStreamListeners();
      set((state) => ({
        conversations: setAssistantError(state.conversations, finalId, err),
        isStreaming: false,
        loading: { ...state.loading, sendMessage: false },
      }));
      get().addToast(friendlyMessage, "error");
      logError("Failed to send message", err);
    } finally {
      set((s) => ({ loading: { ...s.loading, sendMessage: false } }));
    }
  },

  stopStreaming: () => {
    activeStreamId = null;
    releaseStreamListeners();
    set((state) => {
      const convs = state.conversations.map((c) => ({
        ...c,
        messages: c.messages.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m)),
      }));
      return { isStreaming: false, loading: { ...state.loading, sendMessage: false }, conversations: convs };
    });
  },

  exportChat: (id) => {
    const conv = get().conversations.find((c) => c.id === id);
    if (!conv) return;
    const lines = [
      `# ${conv.title}`,
      ``,
      ...conv.messages.map((m) => {
        const label = m.role === "user" ? "You" : "Assistant";
        return `**${label}:** ${m.content}`;
      }),
    ];
    const blob = new Blob([lines.join("\n\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${conv.title.replace(/[^a-zA-Z0-9]/g, "_")}.md`;
    a.click();
    URL.revokeObjectURL(url);
    get().addToast("Chat exported", "success");
  },

  persistConversations: async () => {
    const { hasStarted } = get();
    if (!hasStarted) return;
    get().cleanupEmptyConversations();
    const { conversations } = get();
    await saveConversations(conversations);
  },

  persistApiKeys: async () => {
    const { apiKeys } = get();
    await saveApiKeys(apiKeys);
  },

  clearAllChats: async () => {
    set({ conversations: [], activeId: null });
    await clearConversations();
    get().addToast("All chats cleared", "info");
  },

  checkModelConnections: async (modelIds?: string[]) => {
    const { models, apiKeys, modelStatuses } = get();
    const toCheck = modelIds ? models.filter((m) => modelIds.includes(m.id)) : models;

    if (toCheck.length === 0) return;

    set((s) => ({ loading: { ...s.loading, checkConnection: true } }));

    const updating: ModelStatuses = { ...modelStatuses };
    for (const model of toCheck) {
      updating[model.id] = "connecting";
    }
    set({ modelStatuses: updating });

    const results = await Promise.allSettled(
      toCheck.map(async (model) => {
        const apiKey = apiKeys[model.id] || model.apiKey;
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

    set((s) => ({ modelStatuses: newStatuses, loading: { ...s.loading, checkConnection: false } }));
  },

  startHealthCheck: () => {
    if (healthCheckInterval) return;
    healthCheckInterval = setInterval(() => {
      get().checkModelConnections();
    }, 30000);
  },

  stopHealthCheck: () => {
    if (healthCheckInterval) {
      clearInterval(healthCheckInterval);
      healthCheckInterval = null;
    }
  },

  cleanup: () => {
    get().stopHealthCheck();
    get().stopStreaming();
    releaseStreamListeners();
  },
}));
