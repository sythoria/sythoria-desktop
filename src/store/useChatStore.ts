import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { Conversation, Message, ModelConfig } from "../types";
import { loadModelConfigs } from "../types";
import {
  loadConversations,
  saveConversations,
  loadTheme,
  loadApiKeys,
  loadSearchConfigs,
  loadSearchApiKeys,
  clearConversations,
} from "../utils/storage";
import { generateId } from "../utils/generateId";
import { logError, logInfo } from "../utils/logger";
import { TITLE_MAX_LENGTH } from "../config/constants";
import { parseApiError } from "../utils/parseApiError";
import { sendWithToolLoop } from "../services/toolLoop";
import { useUIStore } from "./useUIStore";
import { useModelStore } from "./useModelStore";
import { useSearchStore } from "./useSearchStore";

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

interface ChatState {
  conversations: Conversation[];
  activeId: string | null;
  isStreaming: boolean;

  init: () => Promise<void>;
  cleanupEmptyConversations: () => void;
  setActiveId: (id: string | null) => void;
  newChat: () => string;
  deleteChat: (id: string) => void;
  renameChat: (id: string, newTitle: string) => void;
  confirmRename: (newTitle: string) => void;
  sendMessage: (text: string) => Promise<void>;
  retryLastMessage: (convId: string) => Promise<void>;
  stopStreaming: () => void;
  exportChat: (id: string) => void;
  persistConversations: () => Promise<void>;
  clearAllChats: () => Promise<void>;
  cleanup: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  activeId: null,
  isStreaming: false,

  init: async () => {
    useUIStore.getState().setLoading("init", true);
    try {
      const [loadedModels, loadedConvs, loadedTheme, loadedKeys, loadedSearchConfigs, loadedSearchKeys] =
        await Promise.all([
          loadModelConfigs(),
          loadConversations(),
          loadTheme(),
          loadApiKeys(),
          loadSearchConfigs(),
          loadSearchApiKeys(),
        ]);

      const models = loadedModels || [];
      const modelsWithKeys = models.map((m) => ({
        ...m,
        apiKey: loadedKeys[m.id] ?? m.apiKey,
      }));

      const nonEmptyConvs = loadedConvs.filter((c) => c.messages.length > 0);

      const searchConfigs = loadedSearchConfigs || [];

      useModelStore.setState({
        models: modelsWithKeys,
        selectedModel: modelsWithKeys.length > 0 ? modelsWithKeys[0].id : "",
        apiKeys: loadedKeys,
        modelStatuses: {},
      });

      useSearchStore.setState({
        searchConfigs,
        activeSearchId: searchConfigs.find((c) => c.enabled)?.id ?? null,
        searchApiKeys: loadedSearchKeys,
      });

      set({
        conversations: nonEmptyConvs,
        activeId: nonEmptyConvs.length > 0 ? nonEmptyConvs[0].id : null,
      });

      useUIStore.setState({
        theme: loadedTheme,
        hasStarted: modelsWithKeys.length > 0,
        isConfigLoaded: true,
      });

      document.documentElement.classList.toggle("dark", loadedTheme === "dark");
      logInfo("App state initialized");

      useModelStore.getState().checkModelConnections();
      useModelStore.getState().startHealthCheck();
    } catch (err) {
      logError("Failed to initialize app", err);
      useUIStore.getState().addToast(parseApiError(err), "error");
      useUIStore.getState().setConfigLoaded(true);
    } finally {
      useUIStore.getState().setLoading("init", false);
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

  newChat: () => {
    const { selectedModel, models } = useModelStore.getState();
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
    }));
    useUIStore.getState().setSidebarOpen(false);
    useUIStore.getState().setView("chat");
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

  confirmRename: (newTitle) => {
    const { renameId } = useUIStore.getState();
    if (renameId) {
      get().renameChat(renameId, newTitle);
    }
    useUIStore.getState().closeRenameModal();
  },

  sendMessage: async (text) => {
    const { isStreaming, activeId } = get();
    const { selectedModel, models, temperature, apiKeys } = useModelStore.getState();
    const { isSearchEnabled, activeSearchId, searchConfigs, searchApiKeys } = useSearchStore.getState();

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

    const userMsg: Message = {
      id: generateId(),
      role: "user",
      content: text,
      timestamp: new Date(),
    };

    const finalId = convId;
    const modelConfig = models.find((m) => m.id === selectedModel) ?? models[0];

    if (!modelConfig) {
      logError("No model configuration selected");
      useUIStore.getState().addToast("No model configured — add one in Settings", "error");
      return;
    }

    set((state) => ({
      conversations: updateConversationMessages(state.conversations, finalId, (msgs) => [...msgs, userMsg], {
        title:
          state.conversations.find((c) => c.id === finalId)?.messages.length === 0 ? truncateTitle(text) : undefined,
      }),
    }));

    const useTools = isSearchEnabled && activeSearchId;
    const searchConfig = useTools ? searchConfigs.find((c) => c.id === activeSearchId) : undefined;
    const searchApiKey = useTools && searchConfig ? searchApiKeys[searchConfig.id] || searchConfig.apiKey || "" : "";

    if (useTools && searchConfig) {
      await sendWithToolLoop(
        finalId,
        modelConfig,
        temperature,
        apiKeys,
        searchConfig,
        searchApiKey,
        (fn) => set(fn as (state: ChatState) => Partial<ChatState>),
        get,
        useSearchStore.getState().performSearch,
        useSearchStore.getState().fetchUrlContent,
      );
    } else {
      await sendNormal(finalId, modelConfig, temperature, apiKeys, set, get);
    }
  },

  stopStreaming: () => {
    useModelStore.getState().cancelActiveStream();
    set((state) => {
      const convs = state.conversations.map((c) => ({
        ...c,
        messages: c.messages.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m)),
      }));
      return {
        isStreaming: false,
        conversations: convs,
      };
    });
    useUIStore.getState().setLoading("sendMessage", false);
    useUIStore.getState().setLoading("toolExecution", false);
  },

  retryLastMessage: async (convId) => {
    const { isStreaming, conversations } = get();
    const { selectedModel, models, temperature, apiKeys } = useModelStore.getState();
    const { isSearchEnabled, activeSearchId, searchConfigs, searchApiKeys } = useSearchStore.getState();

    if (isStreaming) return;

    const conv = conversations.find((c) => c.id === convId);
    if (!conv || conv.messages.length === 0) return;

    let lastUserIdx = -1;
    for (let i = conv.messages.length - 1; i >= 0; i--) {
      if (conv.messages[i].role === "user") {
        lastUserIdx = i;
        break;
      }
    }
    if (lastUserIdx === -1) return;

    const trimmed = conv.messages.slice(0, lastUserIdx + 1);

    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === convId ? { ...c, messages: trimmed, timestamp: new Date() } : c,
      ),
    }));

    const modelConfig = models.find((m) => m.id === selectedModel) ?? models[0];
    if (!modelConfig) {
      logError("No model configuration selected");
      useUIStore.getState().addToast("No model configured — add one in Settings", "error");
      return;
    }

    const useTools = isSearchEnabled && activeSearchId;
    const searchConfig = useTools ? searchConfigs.find((c) => c.id === activeSearchId) : undefined;
    const searchApiKey = useTools && searchConfig ? searchApiKeys[searchConfig.id] || searchConfig.apiKey || "" : "";

    if (useTools && searchConfig) {
      await sendWithToolLoop(
        convId,
        modelConfig,
        temperature,
        apiKeys,
        searchConfig,
        searchApiKey,
        (fn) => set(fn as (state: ChatState) => Partial<ChatState>),
        get,
        useSearchStore.getState().performSearch,
        useSearchStore.getState().fetchUrlContent,
      );
    } else {
      await sendNormal(convId, modelConfig, temperature, apiKeys, set, get);
    }
  },

  exportChat: (id) => {
    const conv = get().conversations.find((c) => c.id === id);
    if (!conv) return;
    const lines = [
      `# ${conv.title}`,
      ``,
      ...conv.messages.map((m) => {
        if (m.role === "tool") {
          const result = m.toolResult;
          return `**Tool (${result?.name ?? "unknown"}):** ${m.content.slice(0, 200)}`;
        }
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
    useUIStore.getState().addToast("Chat exported", "success");
  },

  persistConversations: async () => {
    const { hasStarted } = useUIStore.getState();
    if (!hasStarted) return;
    get().cleanupEmptyConversations();
    const { conversations } = get();
    await saveConversations(conversations);
  },

  clearAllChats: async () => {
    set({ conversations: [], activeId: null });
    await clearConversations();
    useUIStore.getState().addToast("All chats cleared", "info");
  },

  cleanup: () => {
    useModelStore.getState().stopHealthCheck();
    get().stopStreaming();
    useModelStore.getState().releaseStreamListeners();
  },
}));

async function sendNormal(
  convId: string,
  modelConfig: ModelConfig,
  temperature: number,
  apiKeys: Record<string, string>,
  set: (fn: (state: ChatState) => Partial<ChatState>) => void,
  get: () => ChatState,
) {
  const assistantMsg: Message = {
    id: generateId(),
    role: "assistant",
    content: "",
    timestamp: new Date(),
    isStreaming: true,
  };

  set((state) => ({
    isStreaming: true,
    conversations: updateConversationMessages(state.conversations, convId, (msgs) => [...msgs, assistantMsg]),
  }));
  useUIStore.getState().setLoading("sendMessage", true);

  const streamId = generateId();
  const modelStore = useModelStore.getState();
  modelStore.setActiveStreamId(streamId, convId);

  await modelStore.ensureStreamListeners(
    (cId, content) => {
      set((state) => ({
        conversations: state.conversations.map((c) => {
          if (c.id !== cId) return c;
          const updated = [...c.messages];
          const last = updated[updated.length - 1];
          if (last && last.role === "assistant") {
            updated[updated.length - 1] = { ...last, content: last.content + content };
          }
          return { ...c, messages: updated };
        }),
      }));
    },
    (cId) => {
      set((state) => ({
        conversations: state.conversations.map((c) => {
          if (c.id !== cId) return c;
          const updated = [...c.messages];
          const last = updated[updated.length - 1];
          if (last && last.role === "assistant") {
            updated[updated.length - 1] = { ...last, isStreaming: false };
          }
          return { ...c, messages: updated };
        }),
        isStreaming: false,
      }));
    },
  );

  try {
    const apiUrl = modelConfig.apiBase;
    const apiKey = apiKeys[modelConfig.id] || modelConfig.apiKey;

    const conv = get().conversations.find((c) => c.id === convId);
    const apiMessages =
      conv?.messages
        .filter((m) => (m.role === "user" || m.role === "assistant") && !m.isStreaming)
        .map((m) => ({ role: m.role, content: m.content })) ?? [];

    await invoke("chat_stream", {
      apiUrl,
      apiKey,
      model: modelConfig.modelId,
      messages: apiMessages,
      temperature,
      streamId,
    });

    const streamStillActive = useModelStore.getState().getActiveStreamId() === streamId;
    if (streamStillActive) {
      useModelStore.getState().setActiveStreamId(null, null);
    }

    set((state) => ({
      conversations: finalizeAssistantMessage(state.conversations, convId),
      ...(streamStillActive ? { isStreaming: false } : {}),
    }));

    get().persistConversations();
  } catch (err) {
    const friendlyMessage = parseApiError(err);
    useModelStore.getState().setActiveStreamId(null, null);
    useModelStore.getState().releaseStreamListeners();
    set((state) => ({
      conversations: setAssistantError(state.conversations, convId, err),
      isStreaming: false,
    }));
    useUIStore.getState().setLoading("sendMessage", false);
    useUIStore.getState().addToast(friendlyMessage, "error");
    logError("Failed to send message", err);
  } finally {
    useUIStore.getState().setLoading("sendMessage", false);
  }
}
