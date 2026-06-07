import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { Conversation, Message, ModelConfig, GenerationState, TitleGenerationConfig } from "../types";
import {
  loadModelConfigs,
  loadConversations,
  saveConversations,
  loadTheme,
  loadApiKeys,
  loadSearchConfigs,
  loadSearchApiKeys,
  clearConversations,
  loadTitleConfig,
  loadMcpConfigs,
  loadMcpEnvSecrets,
  loadHasStarted,
} from "../utils/storage";
import { generateId } from "../utils/generateId";
import { logError, logInfo } from "../utils/logger";
import { TITLE_MAX_LENGTH } from "../config/constants";
import { parseApiError } from "../utils/parseApiError";
import { sendWithToolLoop } from "../services/toolLoop";
import {
  uiToast,
  uiLoading,
  uiConfigLoaded,
  uiHasStarted,
  uiTheme,
  uiSidebarOpen,
  uiView,
  uiCloseRenameModal,
  modelCancelStream,
  modelStopHealthCheck,
  modelReleaseListeners,
  modelCheckConnections,
  modelStartHealthCheck,
  modelSetState,
  modelSetActiveStream,
  modelGetActiveStreamId,
  searchSetState,
  searchPerformSearch,
  searchFetchUrlContent,
  mcpSetState,
} from "./helpers";
import { useModelStore } from "./useModelStore";
import { useSearchStore } from "./useSearchStore";
import { useMcpStore } from "./useMcpStore";
import { useUIStore } from "./useUIStore";

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
  const parsed = parseApiError(err);
  return updateConversationMessages(conversations, convId, (msgs) => {
    const updated = [...msgs];
    const last = updated[updated.length - 1];
    if (last && last.role === "assistant") {
      updated[updated.length - 1] = { ...last, content: `**Error:** ${parsed.message}`, isStreaming: false };
    }
    return updated;
  });
}

interface ChatState {
  conversations: Conversation[];
  activeId: string | null;
  isStreaming: boolean;
  generationState: GenerationState;
  generationLabel: string;

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
  setGenerationState: (state: GenerationState, label?: string, error?: string) => void;
}

let initInProgress = false;

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  activeId: null,
  isStreaming: false,
  generationState: "idle" as GenerationState,
  generationLabel: "",

  init: async () => {
    if (initInProgress) return;
    initInProgress = true;
    uiLoading("init", true);
    try {
      const [
        loadedModels,
        loadedConvs,
        loadedTheme,
        loadedKeys,
        loadedSearchConfigs,
        loadedSearchKeys,
        loadedTitleCfg,
        loadedMcpConfigs,
        loadedMcpEnvSecrets,
      ] = await Promise.all([
        loadModelConfigs(),
        loadConversations(),
        loadTheme(),
        loadApiKeys(),
        loadSearchConfigs(),
        loadSearchApiKeys(),
        loadTitleConfig(),
        loadMcpConfigs(),
        loadMcpEnvSecrets(),
      ]);

      const models = loadedModels || [];
      const modelsWithKeys = models.map((m) => ({
        ...m,
        apiKey: loadedKeys[m.id] ?? m.apiKey,
      }));

      const nonEmptyConvs = loadedConvs.filter((c) => c.messages.length > 0);

      const searchConfigs = loadedSearchConfigs || [];

      modelSetState({
        models: modelsWithKeys,
        selectedModel: modelsWithKeys.length > 0 ? modelsWithKeys[0].id : "",
        apiKeys: loadedKeys,
        modelStatuses: {},
        titleConfig: loadedTitleCfg,
      });

      searchSetState({
        searchConfigs,
        activeSearchId: searchConfigs.find((c) => c.enabled)?.id ?? null,
        searchApiKeys: loadedSearchKeys,
      });

      const mcpConfigs = loadedMcpConfigs || [];
      mcpSetState({
        mcpConfigs,
        envSecrets: loadedMcpEnvSecrets,
        serverStatuses: Object.fromEntries(mcpConfigs.map((c) => [c.id, "disconnected" as const])),
      });

      set({
        conversations: nonEmptyConvs,
        activeId: nonEmptyConvs.length > 0 ? nonEmptyConvs[0].id : null,
      });

      const storedHasStarted = await loadHasStarted();
      uiHasStarted(storedHasStarted || modelsWithKeys.length > 0);
      uiConfigLoaded(true);
      uiTheme(loadedTheme);

      document.documentElement.classList.toggle("dark", loadedTheme === "dark");
      logInfo("chat", "App state initialized", {
        details: `Loaded ${modelsWithKeys.length} models, ${nonEmptyConvs.length} conversations, ${searchConfigs.length} search configs, ${mcpConfigs.length} MCP servers`,
      });

      modelCheckConnections();
      modelStartHealthCheck();

      useMcpStore.getState().connectAllEnabled();
    } catch (err) {
      const parsed = parseApiError(err);
      logError("chat", "Failed to initialize app", { error: err, action: "Check your settings and restart the app." });
      uiToast(parsed.message, "error");
      uiConfigLoaded(true);
    } finally {
      uiLoading("init", false);
      initInProgress = false;
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
    uiSidebarOpen(false);
    uiView("chat");
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
    uiCloseRenameModal();
  },

  sendMessage: async (text) => {
    const { isStreaming, activeId, conversations } = get();
    const { selectedModel, models, temperature, apiKeys, titleConfig } = useModelStore.getState();
    const { isSearchEnabled, activeSearchId, searchConfigs, searchApiKeys } = useSearchStore.getState();

    if (isStreaming) return;

    let convId = activeId;
    let isFirstMessage = false;

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
      isFirstMessage = true;
    } else {
      const existing = conversations.find((c) => c.id === convId);
      if (existing && existing.messages.length === 0) {
        isFirstMessage = true;
      }
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
      logError("model", "No model configuration selected — user tried to send message without any model configured", {
        action: "Go to Settings > Models and add at least one model configuration.",
      });
      uiToast("No model configured — add one in Settings", "error");
      return;
    }

    const fallbackTitle = truncateTitle(text);

    set((state) => ({
      generationState: "idle" as GenerationState,
      generationLabel: "",
      conversations: updateConversationMessages(state.conversations, finalId, (msgs) => [...msgs, userMsg], {
        title: isFirstMessage ? fallbackTitle : undefined,
      }),
    }));

    if (isFirstMessage && titleConfig.enabled) {
      generateConversationTitle(finalId, text, modelConfig, apiKeys, titleConfig, set, get);
    }

    const useTools = isSearchEnabled && activeSearchId;
    const searchConfig = useTools ? searchConfigs.find((c) => c.id === activeSearchId) : undefined;
    const searchApiKey = useTools && searchConfig ? (searchApiKeys[searchConfig.id] ?? searchConfig.apiKey ?? "") : "";

    const { enabledServerIds, availableTools } = useMcpStore.getState();
    const enabledMcpTools = availableTools.filter((t) => enabledServerIds.has(t.serverId));
    const hasMcp = enabledMcpTools.length > 0;

    if ((useTools && searchConfig) || hasMcp) {
      const mcpCallTool = hasMcp
        ? (serverId: string, toolName: string, args: Record<string, string>) =>
            useMcpStore.getState().callTool(serverId, toolName, args)
        : undefined;

      await sendWithToolLoop(
        finalId,
        modelConfig,
        temperature,
        apiKeys,
        searchConfig,
        searchApiKey,
        enabledMcpTools,
        mcpCallTool,
        (fn) => set(fn as (state: ChatState) => Partial<ChatState>),
        get,
        searchPerformSearch,
        searchFetchUrlContent,
      );
    } else {
      await sendNormal(finalId, modelConfig, temperature, apiKeys, set, get);
    }
  },

  stopStreaming: () => {
    modelCancelStream();
    set((state) => {
      const convs = state.conversations.map((c) => ({
        ...c,
        messages: c.messages.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m)),
      }));
      return {
        isStreaming: false,
        generationState: "idle" as GenerationState,
        generationLabel: "",
        conversations: convs,
      };
    });
    uiLoading("sendMessage", false);
    uiLoading("toolExecution", false);
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
      logError("model", "No model configuration selected — user tried to retry message without any model configured", {
        action: "Go to Settings > Models and add at least one model configuration.",
      });
      uiToast("No model configured — add one in Settings", "error");
      return;
    }

    const useTools = isSearchEnabled && activeSearchId;
    const searchConfig = useTools ? searchConfigs.find((c) => c.id === activeSearchId) : undefined;
    const searchApiKey = useTools && searchConfig ? (searchApiKeys[searchConfig.id] ?? searchConfig.apiKey ?? "") : "";

    const { enabledServerIds: retryEnabledIds, availableTools: retryAvailableTools } = useMcpStore.getState();
    const retryMcpTools = retryAvailableTools.filter((t) => retryEnabledIds.has(t.serverId));
    const retryHasMcp = retryMcpTools.length > 0;

    if ((useTools && searchConfig) || retryHasMcp) {
      const mcpCallTool = retryHasMcp
        ? (serverId: string, toolName: string, args: Record<string, string>) =>
            useMcpStore.getState().callTool(serverId, toolName, args)
        : undefined;

      await sendWithToolLoop(
        convId,
        modelConfig,
        temperature,
        apiKeys,
        searchConfig,
        searchApiKey,
        retryMcpTools,
        mcpCallTool,
        (fn) => set(fn as (state: ChatState) => Partial<ChatState>),
        get,
        searchPerformSearch,
        searchFetchUrlContent,
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
    uiToast("Chat exported", "success");
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
    uiToast("All chats cleared", "info");
  },

  cleanup: () => {
    modelStopHealthCheck();
    get().stopStreaming();
    modelReleaseListeners();
  },

  setGenerationState: (state, label, error) => {
    set({
      generationState: state,
      generationLabel: error ? `${label ?? state}: ${error}` : (label ?? state),
    });
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
    generationState: "thinking" as GenerationState,
    generationLabel: "Thinking",
    conversations: updateConversationMessages(state.conversations, convId, (msgs) => [...msgs, assistantMsg]),
  }));
  uiLoading("sendMessage", true);

  const streamId = generateId();
  const modelStore = useModelStore.getState();
  modelStore.setActiveStreamId(streamId, convId);

  logInfo("chat", `Sending message to ${modelConfig.name}`, {
    details: `Model: ${modelConfig.modelId}, API: ${modelConfig.apiBase}, Stream ID: ${streamId}`,
  });

  await modelStore.ensureStreamListeners(
    (cId, content) => {
      set((state) => {
        const newState: Partial<ChatState> = {};
        if (state.generationState === "thinking" && !content.startsWith("<reasoning>")) {
          newState.generationState = "responding";
          newState.generationLabel = "Responding";
        }
        return {
          ...newState,
          conversations: state.conversations.map((c) => {
            if (c.id !== cId) return c;
            const updated = [...c.messages];
            const last = updated[updated.length - 1];
            if (last && last.role === "assistant") {
              updated[updated.length - 1] = { ...last, content: last.content + content };
            }
            return { ...c, messages: updated };
          }),
        };
      });
    },
    (cId) => {
      logInfo("stream", `Stream completed`, {
        details: `Conversation: ${cId}`,
      });
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
        generationState: "idle" as GenerationState,
        generationLabel: "",
      }));
    },
  );

  try {
    const apiUrl = modelConfig.apiBase;
    const apiKey = apiKeys[modelConfig.id] ?? modelConfig.apiKey ?? "";

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

    const streamStillActive = modelGetActiveStreamId() === streamId;
    if (streamStillActive) {
      modelSetActiveStream(null, null);
    }

    set((state) => ({
      conversations: finalizeAssistantMessage(state.conversations, convId),
      ...(streamStillActive ? { isStreaming: false } : {}),
    }));

    get().persistConversations();
  } catch (err) {
    const parsed = parseApiError(err);
    modelSetActiveStream(null, null);
    modelReleaseListeners();
    set((state) => ({
      conversations: setAssistantError(state.conversations, convId, err),
      isStreaming: false,
      generationState: "error" as GenerationState,
      generationLabel: `Generation failed: ${parsed.message}`,
    }));
    uiLoading("sendMessage", false);
    uiToast(parsed.message, "error");
    logError("chat", "Failed to send message or stream response", {
      error: err,
      action: parsed.action,
      details: `Model: ${modelConfig?.name}, Category: ${parsed.category}, Retryable: ${parsed.retryable}${parsed.rawDetail ? `\nRaw: ${parsed.rawDetail}` : ""}`,
    });
  } finally {
    uiLoading("sendMessage", false);
  }
}

function generateConversationTitle(
  convId: string,
  userText: string,
  chatModelConfig: ModelConfig,
  apiKeys: Record<string, string>,
  titleConfig: TitleGenerationConfig,
  set: (fn: (state: ChatState) => Partial<ChatState>) => void,
  get: () => ChatState,
): void {
  const { models } = useModelStore.getState();

  let titleModelConfig: ModelConfig;
  if (titleConfig.modelId === "__same__") {
    titleModelConfig = chatModelConfig;
  } else {
    const found = models.find((m) => m.id === titleConfig.modelId);
    if (!found) {
      logError("model", "Title generation model not found, falling back to chat model", {
        action: `Go to Settings > Models and make sure the model "${titleConfig.modelId}" is configured and enabled.`,
      });
      titleModelConfig = chatModelConfig;
    } else {
      titleModelConfig = found;
    }
  }

  const apiUrl = titleModelConfig.apiBase;
  const apiKey = apiKeys[titleModelConfig.id] ?? titleModelConfig.apiKey ?? "";
  const model = titleModelConfig.modelId;
  const systemPrompt = titleConfig.systemPrompt.replace(/\{\{userMessage\}\}/g, userText);

  invoke<string>("generate_title", {
    apiUrl,
    apiKey,
    model,
    userMessage: userText,
    systemPrompt,
  })
    .then((title) => {
      const trimmed = title.trim();
      if (trimmed) {
        set((state) => ({
          conversations: state.conversations.map((c) => (c.id === convId ? { ...c, title: trimmed } : c)),
        }));
        get().persistConversations();
      }
    })
    .catch((err) => {
      logError("chat", "Title generation failed, keeping fallback title", {
        error: err,
        action: "Check that the title generation model in Settings is reachable and your API key is valid.",
      });
    });
}
