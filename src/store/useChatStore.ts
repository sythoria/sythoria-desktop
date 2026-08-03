import React from "react";
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type {
  Conversation,
  Message,
  ModelConfig,
  GenerationState,
  TitleGenerationConfig,
  SearchApiConfig,
  McpTool,
  McpToolResult,
  Attachment,
} from "../types";
import { isGenerationActive } from "../types";
import {
  loadModelConfigs,
  loadConversations,
  saveConversations,
  loadTheme,
  loadApiKeys,
  loadSearchConfigs,
  loadFetchConfigs,
  loadSearchApiKeys,
  clearConversations,
  loadTitleConfig,
  loadMcpConfigs,
  loadMcpEnvSecrets,
  loadMcpApiKeys,
  loadEnabledMcpServers,
  loadHasStarted,
  loadAnimationsDisabled,
  loadAlwaysOnTop,
  loadCloseToTray,
  loadLaunchOnStartup,
  loadSendMessageShortcut,
  loadClearInputOnEscape,
  loadBaseTextSize,
  loadAutoUpdateChecking,
  loadSystemPrompt,
  loadShowContextWindow,
  loadMaxToolSteps,
  loadIsLoggingEnabled,
  loadDisableBgActivity,
  loadNetworkSettings,
  loadLanguage,
  loadSelectedModel,
  saveSelectedModel,
  loadUiLayoutSettings,
} from "../utils/storage";
import { generateId } from "../utils/generateId";
import { logError, logInfo, logWarn } from "../utils/logger";
import { TITLE_MAX_LENGTH } from "../config/constants";
import { parseApiError } from "../utils/parseApiError";
import { sendWithToolLoop } from "../services/toolLoop";
import { buildConversationRunContext, type ConversationRunContext } from "../services/conversationRunContext";
import { buildUserApiContent, validateFile } from "../utils/attachments";
import {
  uiToast,
  uiLoading,
  uiConfigLoaded,
  uiHasStarted,
  uiLaunchReady,
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
  searchSetState,
  searchPerformSearch,
  searchFetchUrlContent,
  mcpSetState,
} from "./helpers";
import { useModelStore } from "./useModelStore";
import { useSearchStore } from "./useSearchStore";
import { useMcpStore } from "./useMcpStore";
import { useUIStore } from "./useUIStore";
import { useProjectStore } from "./useProjectStore";
import { useGitStore } from "./useGitStore";
import { DEFAULT_THEME_CONFIG } from "../config/themePresets";

const processingTokens = new Set<string>();

function truncateTitle(text: string): string {
  return text.length > TITLE_MAX_LENGTH ? text.slice(0, TITLE_MAX_LENGTH) + "\u2026" : text;
}

function resolveModelConfig(models: ModelConfig[], preferredId?: string): ModelConfig | undefined {
  return (
    models.find((model) => model.id === preferredId && model.enabled !== false) ??
    models.find((model) => model.enabled !== false)
  );
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

function finalizeAssistantMessage(
  conversations: Conversation[],
  convId: string,
  thinkingDuration?: number,
): Conversation[] {
  return updateConversationMessages(conversations, convId, (msgs) => {
    const updated = [...msgs];
    const lastAssistantIdx = [...updated].reverse().findIndex((m) => m.role === "assistant");
    if (lastAssistantIdx >= 0) {
      const idx = updated.length - 1 - lastAssistantIdx;
      const last = updated[idx];
      if (last.isStreaming) {
        updated[idx] = {
          ...last,
          isStreaming: false,
          thinkingDuration: last.thinkingDuration ?? thinkingDuration,
        };
      }
    }
    return updated;
  });
}

function setAssistantError(conversations: Conversation[], convId: string, err: unknown): Conversation[] {
  const parsed = parseApiError(err);
  return updateConversationMessages(conversations, convId, (msgs) => {
    const updated = [...msgs];
    const lastAssistantIdx = [...updated].reverse().findIndex((m) => m.role === "assistant");
    if (lastAssistantIdx >= 0) {
      const idx = updated.length - 1 - lastAssistantIdx;
      const last = updated[idx];
      updated[idx] = { ...last, content: `**Error:** ${parsed.message}`, isStreaming: false };
    }
    return updated;
  });
}

interface EnabledToolLoopConfig {
  searchConfig: SearchApiConfig | undefined;
  searchApiKey: string;
  mcpTools: McpTool[];
  mcpCallTool:
    ((serverId: string, toolName: string, args: Record<string, string>) => Promise<McpToolResult>) | undefined;
}

function getEnabledToolLoopConfig(): EnabledToolLoopConfig {
  const { isSearchEnabled, activeSearchId, searchConfigs, searchApiKeys } = useSearchStore.getState();
  const searchConfig =
    isSearchEnabled && activeSearchId
      ? searchConfigs.find((config) => config.id === activeSearchId && config.enabled)
      : undefined;
  const searchApiKey = searchConfig ? (searchApiKeys[searchConfig.id] ?? searchConfig.apiKey ?? "") : "";

  const mcpTools = useMcpStore.getState().getEnabledTools();
  const mcpCallTool =
    mcpTools.length > 0
      ? (serverId: string, toolName: string, args: Record<string, string>) =>
          useMcpStore.getState().callTool(serverId, toolName, args)
      : undefined;

  return {
    searchConfig,
    searchApiKey,
    mcpTools,
    mcpCallTool,
  };
}

function showMissingModelConfig(message: string) {
  logError("model", message, {
    action: "Go to Settings > Model Providers and add at least one model configuration.",
  });
  uiToast(
    React.createElement(
      "span",
      null,
      "No model configured — add one in ",
      React.createElement(
        "button",
        {
          onClick: () => {
            useUIStore.getState().setView("settings");
            useUIStore.getState().setActiveSection("models");
          },
          className: "text-red-200 underline font-medium hover:text-white transition-colors cursor-pointer",
        },
        "settings/model-providers",
      ),
    ),
    "error",
  );
}

interface ChatState {
  conversations: Conversation[];
  activeId: string | null;
  isStreaming: boolean;
  generationState: GenerationState;
  generationLabel: string;
  generationByConversation: Record<string, { state: GenerationState; label: string }>;
  navigationHistory: string[];
  navigationIndex: number;
  draftAttachments: Attachment[];
  compareIds: string[];
  isCompareMode: boolean;
  activeStreamContent: Record<string, string>;
  activeStreamReasoning: Record<string, string>;
  activeStreamThinkingStart: Record<string, number>;
  activeStreamThinkingEnd: Record<string, number>;
  activeStreamStartTime: Record<string, number>;

  setCompareIds: (ids: string[]) => void;
  setIsCompareMode: (val: boolean) => boolean;

  init: () => Promise<void>;
  cleanupEmptyConversations: (exceptId?: string | null) => void;
  setActiveId: (id: string | null, isHistoryMove?: boolean) => void;
  navigateBack: () => void;
  navigateForward: () => void;
  newChat: () => string;
  newTemporaryChat: () => string;
  deleteChat: (id: string) => void;
  renameChat: (id: string, newTitle: string) => void;
  togglePinChat: (id: string) => void;
  confirmRename: (newTitle: string) => void;
  sendMessage: (text: string, attachments?: Attachment[]) => Promise<void>;
  retryLastMessage: (convId: string) => Promise<void>;
  stopStreaming: (convId?: string) => Promise<void>;
  exportChat: (id: string) => void | Promise<void>;
  persistConversations: () => Promise<void>;
  resumeConversation: (convId: string) => Promise<void>;
  clearAllChats: () => Promise<void>;
  applyPendingWorktree: (convId: string) => Promise<void>;
  discardPendingWorktree: (convId: string) => Promise<void>;
  cleanup: () => void;
  setGenerationState: (state: GenerationState, label?: string, error?: string) => void;
  setDraftAttachments: (attachments: Attachment[]) => void;
  addDraftFileFromToken: (token: string, name?: string, size?: number) => Promise<void>;
  setConversationProject: (id: string, projectId: string | undefined) => void;
  deleteProjectChats: (projectId: string) => Promise<void>;
}

let initInProgress = false;

function setConversationGeneration(
  state: ChatState,
  convId: string,
  generationState: GenerationState,
  generationLabel: string,
): Record<string, { state: GenerationState; label: string }> {
  if (generationState === "idle") {
    const rest = { ...state.generationByConversation };
    delete rest[convId];
    return rest;
  }
  return {
    ...state.generationByConversation,
    [convId]: { state: generationState, label: generationLabel },
  };
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  activeId: null,
  isStreaming: false,
  generationState: "idle" as GenerationState,
  generationLabel: "",
  generationByConversation: {},
  navigationHistory: [],
  navigationIndex: -1,
  compareIds: [],
  isCompareMode: false,
  activeStreamContent: {},
  activeStreamReasoning: {},
  activeStreamThinkingStart: {},
  activeStreamThinkingEnd: {},
  activeStreamStartTime: {},

  setCompareIds: (compareIds) => set({ compareIds }),
  setIsCompareMode: (isCompareMode) => {
    if (!isCompareMode) {
      const state = get();
      const pendingComparison = state.compareIds
        .map((compareId) => state.conversations.find((conversation) => conversation.id === compareId))
        .find((conversation) => conversation?.pendingWorktree);
      if (pendingComparison) {
        uiToast(
          `Apply or discard pending workspace changes in “${pendingComparison.title}” before leaving compare mode.`,
          "error",
        );
        return false;
      }
    }
    set({ isCompareMode });
    return true;
  },

  init: async () => {
    if (initInProgress) return;
    initInProgress = true;
    uiLoading("init", true);
    try {
      const startupVisualsPromise = Promise.all([loadTheme(), loadHasStarted()]).then(([theme, storedHasStarted]) => {
        uiTheme(theme);
        uiLaunchReady(true);
        return { theme, storedHasStarted };
      });
      const [
        loadedModels,
        loadedConvs,
        loadedStartupVisuals,
        loadedKeys,
        loadedSearchConfigs,
        loadedFetchConfigs,
        loadedSearchKeys,
        loadedTitleCfg,
        loadedMcpConfigs,
        loadedMcpEnvSecrets,
        loadedMcpKeys,
        loadedMcpEnabledServers,
        loadedAnimationsDisabled,
        loadedAlwaysOnTop,
        loadedCloseToTray,
        loadedLaunchOnStartup,
        loadedSendMessageShortcut,
        loadedClearInputOnEscape,
        loadedBaseTextSize,
        loadedAutoUpdateChecking,
        loadedSystemPrompt,
        loadedShowContextWindow,
        loadedMaxToolSteps,
        loadedIsLoggingEnabled,
        loadedDisableBgActivity,
        loadedNetworkSettings,
        loadedLanguage,
        loadedSelectedModel,
        loadedUiLayout,
      ] = await Promise.all([
        loadModelConfigs(),
        loadConversations(),
        startupVisualsPromise,
        loadApiKeys(),
        loadSearchConfigs(),
        loadFetchConfigs(),
        loadSearchApiKeys(),
        loadTitleConfig(),
        loadMcpConfigs(),
        loadMcpEnvSecrets(),
        loadMcpApiKeys(),
        loadEnabledMcpServers(),
        loadAnimationsDisabled(),
        loadAlwaysOnTop(),
        loadCloseToTray(),
        loadLaunchOnStartup(),
        loadSendMessageShortcut(),
        loadClearInputOnEscape(),
        loadBaseTextSize(),
        loadAutoUpdateChecking(),
        loadSystemPrompt(),
        loadShowContextWindow(),
        loadMaxToolSteps(),
        loadIsLoggingEnabled(),
        loadDisableBgActivity(),
        loadNetworkSettings(),
        loadLanguage(),
        loadSelectedModel(),
        loadUiLayoutSettings(),
        useProjectStore.getState().init(),
      ]);

      const { theme: loadedTheme, storedHasStarted } = loadedStartupVisuals;
      const models = loadedModels || [];
      const modelsWithKeys = models.map((m) => ({
        ...m,
        apiKey: loadedKeys[m.id] ?? m.apiKey,
      }));

      const hasOnboarded = storedHasStarted || modelsWithKeys.length > 0;

      if (!hasOnboarded) {
        localStorage.clear();
      }

      const nonEmptyConvs = hasOnboarded ? (loadedConvs || []).filter((c) => c.messages.length > 0) : [];
      const cleanedConvs = nonEmptyConvs.map((c) => {
        const hasRunningStatus = c.status === "running";
        const hasStreamingMsg = c.messages.some((m) => m.isStreaming);
        if (hasRunningStatus || hasStreamingMsg) {
          const nextMessages = c.messages.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m));
          return {
            ...c,
            status: c.isSubagent ? ("stopped" as const) : c.status === "running" ? ("completed" as const) : c.status,
            messages: nextMessages,
          };
        }
        return c;
      });
      const conversationsNeedRepair = cleanedConvs.some((conversation, index) => conversation !== nonEmptyConvs[index]);
      const searchConfigs = loadedSearchConfigs || [];
      const fetchConfigs = loadedFetchConfigs || [];
      const selectedModel =
        modelsWithKeys.find((model) => model.id === loadedSelectedModel && model.enabled !== false)?.id ??
        modelsWithKeys.find((model) => model.id === cleanedConvs[0]?.model && model.enabled !== false)?.id ??
        modelsWithKeys.find((model) => model.enabled !== false)?.id ??
        "";

      modelSetState({
        models: modelsWithKeys,
        selectedModel,
        apiKeys: loadedKeys,
        modelStatuses: {},
        titleConfig: loadedTitleCfg,
        systemPrompt: loadedSystemPrompt,
        maxToolSteps: loadedMaxToolSteps,
      });
      if (selectedModel !== loadedSelectedModel) {
        void saveSelectedModel(selectedModel);
      }

      searchSetState({
        searchConfigs,
        activeSearchId: searchConfigs.find((c) => c.enabled)?.id ?? null,
        fetchConfigs,
        activeFetchId: fetchConfigs.find((c) => c.enabled)?.id ?? null,
        searchApiKeys: loadedSearchKeys,
      });

      const mcpConfigs = (loadedMcpConfigs || []).map((c) => ({
        ...c,
        apiKey: loadedMcpKeys?.[c.id] ?? c.apiKey,
      }));
      const mcpEnabledServers = loadedMcpEnabledServers || [];
      mcpSetState({
        mcpConfigs,
        envSecrets: loadedMcpEnvSecrets,
        mcpApiKeys: loadedMcpKeys || {},
        serverStatuses: Object.fromEntries(mcpConfigs.map((c) => [c.id, "disconnected" as const])),
        enabledServerIds: new Set(
          mcpEnabledServers.filter((id) => mcpConfigs.some((config) => config.id === id && config.enabled)),
        ),
      });

      const initialActiveId = cleanedConvs.length > 0 ? cleanedConvs[0].id : null;
      set({
        conversations: cleanedConvs,
        activeId: initialActiveId,
        navigationHistory: initialActiveId ? [initialActiveId] : [],
        navigationIndex: initialActiveId ? 0 : -1,
      });

      uiHasStarted(hasOnboarded);
      uiConfigLoaded(true);
      uiTheme(hasOnboarded ? loadedTheme : DEFAULT_THEME_CONFIG);

      useUIStore.setState({
        animationsDisabled: hasOnboarded ? loadedAnimationsDisabled : false,
        alwaysOnTop: hasOnboarded ? loadedAlwaysOnTop : false,
        closeToTray: hasOnboarded ? loadedCloseToTray : false,
        launchOnStartup: hasOnboarded ? loadedLaunchOnStartup : false,
        sendMessageShortcut: hasOnboarded ? loadedSendMessageShortcut : "enter",
        clearInputOnEscape: hasOnboarded ? loadedClearInputOnEscape : false,
        baseTextSize: hasOnboarded ? loadedBaseTextSize : "medium",
        autoUpdateChecking: hasOnboarded ? loadedAutoUpdateChecking : true,
        isLoggingEnabled: hasOnboarded ? loadedIsLoggingEnabled : true,
        showContextWindow: hasOnboarded ? loadedShowContextWindow : false,
        disableBgActivity: hasOnboarded ? loadedDisableBgActivity : false,
        strictSsl: loadedNetworkSettings.strictSsl,
        blockedHosts: loadedNetworkSettings.blockedHosts,
        offlineMode: loadedNetworkSettings.offlineMode,
        language: hasOnboarded ? loadedLanguage : "en",
        sidebarWidth: Math.max(180, Math.min(480, loadedUiLayout.sidebarWidth ?? 260)),
        auxPanelWidth: Math.max(360, Math.min(680, loadedUiLayout.auxPanelWidth ?? 520)),
        isAuxSummaryPinned: loadedUiLayout.isAuxSummaryPinned ?? false,
      });
      if (typeof document !== "undefined") {
        document.documentElement.lang = hasOnboarded ? loadedLanguage : "en";
      }
      document.documentElement.classList.toggle("animations-disabled", hasOnboarded ? loadedAnimationsDisabled : false);

      if (hasOnboarded && conversationsNeedRepair) {
        // Repair interrupted streaming markers after the app is interactive.
        void get().persistConversations();
      }

      window.setTimeout(() => {
        void (async () => {
          try {
            const { getCurrentWindow } = await import("@tauri-apps/api/window");
            await getCurrentWindow().setAlwaysOnTop(hasOnboarded ? loadedAlwaysOnTop : false);
          } catch (e) {
            logWarn("general", "Could not apply always-on-top on startup", { details: String(e) });
          }

          try {
            const { invoke } = await import("@tauri-apps/api/core");
            const currentlyEnabled = await invoke<boolean>("is_autostart_enabled");
            if (loadedLaunchOnStartup !== currentlyEnabled) {
              await invoke("set_autostart_enabled", { enabled: loadedLaunchOnStartup });
            }
          } catch (e) {
            logWarn("general", "Could not synchronize launch on startup with OS", { details: String(e) });
          }
        })();
      }, 250);

      window.setTimeout(() => {
        if (!loadedDisableBgActivity) {
          modelCheckConnections();
          modelStartHealthCheck();
        }
        useMcpStore.getState().connectAllEnabled();
      }, 500);

      logInfo("chat", "App state initialized", {
        details: `Loaded ${modelsWithKeys.length} models, ${nonEmptyConvs.length} conversations, ${searchConfigs.length} search configs, ${mcpConfigs.length} MCP servers`,
      });
    } catch (err) {
      const parsed = parseApiError(err);
      logError("chat", "Failed to initialize app", { error: err, action: "Check your settings and restart the app." });
      uiToast(parsed.message, "error");
      uiConfigLoaded(true);
      uiLaunchReady(true);
    } finally {
      uiLoading("init", false);
      initInProgress = false;
    }
  },

  cleanupEmptyConversations: (exceptId?: string | null) => {
    const { conversations, activeId } = get();
    const keepId = exceptId !== undefined ? exceptId : activeId;
    const nonEmpty = conversations.filter((c) => {
      if (c.id.startsWith("compare-")) {
        return Boolean(c.pendingWorktree) || (get().isCompareMode && get().compareIds.includes(c.id));
      }
      return Boolean(c.pendingWorktree) || c.messages.length > 0 || c.id === keepId;
    });
    if (nonEmpty.length === conversations.length) return;

    const removedConvs = conversations.filter((c) => !nonEmpty.includes(c));
    removedConvs.forEach((conv) => {
      if (conv.pendingWorktree && conv.projectId) {
        const projectId = conv.projectId;
        const worktreePath = conv.pendingWorktree.path;
        const branchName = conv.pendingWorktree.branch;
        import("@tauri-apps/api/core").then(({ invoke }) => {
          invoke("git_worktree_discard", {
            projectId,
            worktreePath,
            branchName,
          }).catch((err) => {
            logError("chat", "Failed to discard worktree on cleanup", { error: err });
          });
        });
      }
    });

    const activeRemoved = activeId && !nonEmpty.find((c) => c.id === activeId);
    set({
      conversations: nonEmpty,
      ...(activeRemoved ? { activeId: nonEmpty.length > 0 ? nonEmpty[0].id : null } : {}),
    });
  },

  setActiveId: (id, isHistoryMove = false) => {
    const { activeId, navigationHistory, navigationIndex, conversations, compareIds } = get();
    if (activeId === id) return;

    const pendingComparison = compareIds
      .map((compareId) => conversations.find((conversation) => conversation.id === compareId))
      .find((conversation) => conversation?.pendingWorktree);
    if (pendingComparison) {
      uiToast(
        `Resolve pending workspace changes in “${pendingComparison.title}” before switching conversations.`,
        "error",
      );
      return;
    }

    // Exit compare mode when switching chats to prevent state pollution
    set({
      isCompareMode: false,
      compareIds: [],
    });

    get().cleanupEmptyConversations(id);

    if (!isHistoryMove) {
      const newHistory = navigationHistory.slice(0, navigationIndex + 1);
      if (id !== null) {
        newHistory.push(id);
      }
      set({
        activeId: id,
        navigationHistory: newHistory,
        navigationIndex: newHistory.length - 1,
      });
    } else {
      set({ activeId: id });
    }
  },

  navigateBack: () => {
    const { navigationHistory, navigationIndex } = get();
    if (navigationIndex > 0) {
      const newIndex = navigationIndex - 1;
      const id = navigationHistory[newIndex];
      set({ navigationIndex: newIndex });
      get().setActiveId(id, true);
      uiView("chat");
      uiSidebarOpen(false);
    }
  },

  navigateForward: () => {
    const { navigationHistory, navigationIndex } = get();
    if (navigationIndex < navigationHistory.length - 1) {
      const newIndex = navigationIndex + 1;
      const id = navigationHistory[newIndex];
      set({ navigationIndex: newIndex });
      get().setActiveId(id, true);
      uiView("chat");
      uiSidebarOpen(false);
    }
  },

  newChat: () => {
    const { selectedModel, models } = useModelStore.getState();
    const { activeProjectId, isProjectsEnabled } = useProjectStore.getState();
    const id = generateId();
    const modelConfig = models.find((m) => m.id === selectedModel);
    const conv: Conversation = {
      id,
      title: "New chat",
      timestamp: new Date(),
      messages: [],
      model: modelConfig?.id || selectedModel,
      projectId: (isProjectsEnabled && activeProjectId) || undefined,
    };
    set((state) => ({ conversations: [conv, ...state.conversations] }));
    get().setActiveId(id);
    uiSidebarOpen(false);
    uiView("chat");
    return id;
  },

  newTemporaryChat: () => {
    const { selectedModel, models } = useModelStore.getState();
    const { activeProjectId, isProjectsEnabled } = useProjectStore.getState();
    const id = "temp-" + generateId();
    const modelConfig = models.find((m) => m.id === selectedModel);
    const conv: Conversation = {
      id,
      title: "Temporary chat",
      timestamp: new Date(),
      messages: [],
      model: modelConfig?.id || selectedModel,
      projectId: (isProjectsEnabled && activeProjectId) || undefined,
      isTemporary: true,
    };
    set((state) => ({ conversations: [conv, ...state.conversations] }));
    get().setActiveId(id);
    uiSidebarOpen(false);
    uiView("chat");
    return id;
  },

  deleteChat: (id) => {
    const conv = get().conversations.find((c) => c.id === id);
    if (conv?.pendingWorktree && conv.projectId) {
      const projectId = conv.projectId;
      const worktreePath = conv.pendingWorktree.path;
      const branchName = conv.pendingWorktree.branch;
      import("@tauri-apps/api/core")
        .then(({ invoke }) => {
          invoke("git_worktree_discard", {
            projectId,
            worktreePath,
            branchName,
          }).catch((err) => {
            logError("chat", "Failed to discard worktree on chat deletion", { error: err });
          });
        })
        .catch((err) => {
          logError("chat", "Failed to import core Tauri API on chat deletion", { error: err });
        });

      const projectStore = useProjectStore.getState();
      if (projectStore.activeWorktreePath === worktreePath) {
        projectStore.setWorktree(null, null).catch((err) => {
          logError("chat", "Failed to clear active worktree path on chat deletion", { error: err });
        });
      }
    }

    set((state) => {
      const getDescendants = (parentId: string, convs: typeof state.conversations): string[] => {
        const children = convs.filter((c) => c.parentId === parentId).map((c) => c.id);
        const descendants = [...children];
        for (const childId of children) {
          descendants.push(...getDescendants(childId, convs));
        }
        return descendants;
      };

      const idsToDelete = new Set([id, ...getDescendants(id, state.conversations)]);

      const newHistory = state.navigationHistory.filter((x) => !idsToDelete.has(x));
      let newIndex = state.navigationIndex;
      const oldActiveIndex =
        state.navigationHistory.findIndex((x) => idsToDelete.has(x) && state.activeId === x) !== -1
          ? state.navigationHistory.indexOf(state.activeId!)
          : -1;

      if (oldActiveIndex !== -1) {
        if (newIndex >= oldActiveIndex) {
          newIndex = Math.max(0, newIndex - 1);
        }
      }
      if (newIndex >= newHistory.length) {
        newIndex = newHistory.length - 1;
      }
      const nextActiveId = idsToDelete.has(state.activeId || "")
        ? newIndex >= 0
          ? newHistory[newIndex]
          : null
        : state.activeId;

      const nextCompareIds = state.compareIds.filter((x) => !idsToDelete.has(x));
      const isCompareDeleted = nextCompareIds.length < state.compareIds.length;
      const isActiveDeleted = idsToDelete.has(state.activeId || "");

      return {
        conversations: state.conversations.filter((c) => !idsToDelete.has(c.id)),
        activeId: nextActiveId,
        navigationHistory: newHistory,
        navigationIndex: newIndex,
        compareIds: nextCompareIds,
        ...(isCompareDeleted && nextCompareIds.length === 0 ? { isCompareMode: false } : {}),
        ...(isActiveDeleted && state.isCompareMode ? { isCompareMode: false, compareIds: [] } : {}),
      };
    });
    get().persistConversations();
  },

  deleteProjectChats: async (projectId) => {
    const projectConvs = get().conversations.filter((c) => c.projectId === projectId);
    if (projectConvs.length === 0) return;

    for (const conv of projectConvs) {
      if (conv.pendingWorktree) {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("git_worktree_discard", {
            projectId,
            worktreePath: conv.pendingWorktree.path,
            branchName: conv.pendingWorktree.branch,
          });
        } catch (err) {
          logError("chat", `Failed to discard worktree for chat ${conv.id} on project deletion`, { error: err });
        }
      }
    }

    const projectStore = useProjectStore.getState();
    const hasActiveWorktreeDeleted = projectConvs.some(
      (c) => c.pendingWorktree && projectStore.activeWorktreePath === c.pendingWorktree.path,
    );
    if (hasActiveWorktreeDeleted) {
      try {
        await projectStore.setWorktree(null, null);
      } catch (err) {
        logError("chat", "Failed to clear active worktree path on project deletion", { error: err });
      }
    }

    const convIdsToRemove = new Set(projectConvs.map((c) => c.id));

    set((state) => {
      const remainingConversations = state.conversations.filter((c) => !convIdsToRemove.has(c.id));
      const newHistory = state.navigationHistory.filter((id) => !convIdsToRemove.has(id));

      let newIndex = state.navigationIndex;
      const isActiveDeleted = convIdsToRemove.has(state.activeId || "");
      if (isActiveDeleted) {
        newIndex = newHistory.length - 1;
      } else if (state.activeId) {
        newIndex = newHistory.indexOf(state.activeId);
      }

      const nextActiveId = isActiveDeleted ? (newIndex >= 0 ? newHistory[newIndex] : null) : state.activeId;
      const nextCompareIds = state.compareIds.filter((id) => !convIdsToRemove.has(id));
      const isCompareDeleted = state.compareIds.some((id) => convIdsToRemove.has(id));

      return {
        conversations: remainingConversations,
        activeId: nextActiveId,
        navigationHistory: newHistory,
        navigationIndex: newIndex,
        compareIds: nextCompareIds,
        ...(isCompareDeleted && nextCompareIds.length === 0 ? { isCompareMode: false } : {}),
        ...(isActiveDeleted && state.isCompareMode ? { isCompareMode: false, compareIds: [] } : {}),
      };
    });

    await get().persistConversations();
  },

  renameChat: (id, newTitle) => {
    set((state) => ({
      conversations: state.conversations.map((c) => (c.id === id ? { ...c, title: newTitle } : c)),
    }));
    get().persistConversations();
  },

  togglePinChat: (id) => {
    set((state) => ({
      conversations: state.conversations.map((c) => (c.id === id ? { ...c, isPinned: !c.isPinned } : c)),
    }));
    get().persistConversations();
  },

  setConversationProject: (id, projectId) => {
    const conversation = get().conversations.find((candidate) => candidate.id === id);
    if (conversation?.pendingWorktree && conversation.projectId !== projectId) {
      uiToast("Apply or discard pending workspace changes before changing this conversation's project.", "error");
      return;
    }
    set((state) => ({
      conversations: state.conversations.map((c) => (c.id === id ? { ...c, projectId } : c)),
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

  sendMessage: async (text, attachments) => {
    const { activeId, isCompareMode, compareIds } = get();
    const { selectedModel, models, temperature, apiKeys, titleConfig } = useModelStore.getState();
    const {
      activeProjectId: sendActiveProjectId,
      isProjectsEnabled: sendProjectsEnabled,
      projects: sendProjects,
    } = useProjectStore.getState();
    const toolLoop = getEnabledToolLoopConfig();

    if (activeId) {
      const activeGen = get().generationByConversation[activeId];
      const isTargetGenerating = isGenerationActive(activeGen?.state);
      if (isTargetGenerating) return;

      if (isCompareMode && compareIds.length > 0) {
        const isAnyCompareGenerating = compareIds.some((id) => {
          const gen = get().generationByConversation[id];
          return isGenerationActive(gen?.state);
        });
        if (isAnyCompareGenerating) return;
      }
    }

    let convId = activeId;
    let activeCompareIds = [...compareIds];

    if (!resolveModelConfig(models, selectedModel)) {
      showMissingModelConfig(
        "No model configuration selected — user tried to send message without any model configured",
      );
      return;
    }

    const firstAttachmentName = attachments && attachments.length > 0 ? attachments[0].name : "New chat";
    const initialTitle = text ? truncateTitle(text) : firstAttachmentName;
    if (!convId) {
      const id = generateId();
      const modelConfig = models.find((m) => m.id === selectedModel);
      const conv: Conversation = {
        id,
        title: initialTitle,
        timestamp: new Date(),
        messages: [],
        model: modelConfig?.id || selectedModel,
        projectId: (sendProjectsEnabled && sendActiveProjectId) || undefined,
      };
      set((state) => ({
        conversations: [conv, ...state.conversations],
        activeId: id,
      }));
      convId = id;
    }

    if (isCompareMode && activeCompareIds.length === 0) {
      const id = generateId();
      const secondaryModel = models.find((m) => m.id !== selectedModel && m.enabled !== false)?.id || selectedModel;
      const conv: Conversation = {
        id,
        title: initialTitle + " (Compare)",
        timestamp: new Date(),
        messages: [],
        model: secondaryModel,
        projectId: (sendProjectsEnabled && sendActiveProjectId) || undefined,
      };
      set((state) => ({
        conversations: [conv, ...state.conversations],
        compareIds: [id],
      }));
      activeCompareIds = [id];
    }

    const conversationIds = [convId, ...(isCompareMode ? activeCompareIds : [])];
    const runContexts = conversationIds.flatMap((conversationId) => {
      const conversation = get().conversations.find((candidate) => candidate.id === conversationId);
      if (!conversation) return [];
      const context = buildConversationRunContext({
        conversation,
        models,
        selectedModel,
        temperature,
        projects: sendProjects,
        projectsEnabled: sendProjectsEnabled,
        ...toolLoop,
      });
      return context ? [context] : [];
    });

    if (runContexts.length !== conversationIds.length) {
      showMissingModelConfig("No enabled model configuration was available for every conversation in this send");
      return;
    }

    if (attachments?.some((attachment) => attachment.kind === "image")) {
      const unsupportedContext = runContexts.find((context) => !context.attachmentCapabilities.images);
      if (unsupportedContext) {
        uiToast(`${unsupportedContext.modelConfig.name} does not support image attachments.`, "error");
        return;
      }
    }

    const userMsg: Message = {
      id: generateId(),
      role: "user",
      content: text,
      timestamp: new Date(),
      attachments,
    };

    const fallbackTitle = text ? truncateTitle(text) : firstAttachmentName;

    const runForConversation = async (context: ConversationRunContext) => {
      const cId = context.conversationId;
      const currentConvs = get().conversations;
      const conversation = currentConvs.find((c) => c.id === cId);
      const isFirstForThis = (conversation?.messages?.length ?? 0) === 0;
      const isTemporary = conversation?.isTemporary === true;

      set((state) => ({
        conversations: updateConversationMessages(state.conversations, cId, (msgs) => [...msgs, userMsg], {
          title:
            isFirstForThis && !isTemporary
              ? activeCompareIds.includes(cId)
                ? fallbackTitle + " (Compare)"
                : fallbackTitle
              : undefined,
          recursionDepth: 0,
        }),
      }));

      if (isFirstForThis && !isTemporary && titleConfig.enabled) {
        generateConversationTitle(cId, text || fallbackTitle, context.modelConfig, apiKeys, titleConfig, set, get);
      }

      if (context.shouldUseTools) {
        await sendWithToolLoop(
          context,
          (fn) => set(fn as (state: ChatState) => Partial<ChatState>),
          get,
          searchPerformSearch,
          searchFetchUrlContent,
        );
      } else {
        await sendNormal(cId, context.modelConfig, context.temperature, set, get);
      }
    };

    set({
      isStreaming: true,
      generationState: "loading" as GenerationState,
      generationLabel: "Loading",
    });

    await Promise.all(runContexts.map(runForConversation));
  },

  stopStreaming: async (targetConvId) => {
    const requestedConvId = typeof targetConvId === "string" ? targetConvId : undefined;
    const targetConvIds = requestedConvId
      ? (() => {
          const ids = new Set([requestedConvId]);
          let foundDescendant = true;
          while (foundDescendant) {
            foundDescendant = false;
            for (const conversation of get().conversations) {
              if (conversation.parentId && ids.has(conversation.parentId) && !ids.has(conversation.id)) {
                ids.add(conversation.id);
                foundDescendant = true;
              }
            }
          }
          return ids;
        })()
      : null;

    const uiStore = useUIStore.getState();
    const pendingConfirmationIds = uiStore.pendingToolConfirmations
      .filter((confirmation) => !targetConvIds || targetConvIds.has(confirmation.conversationId ?? ""))
      .map((confirmation) => confirmation.id);
    for (const confirmationId of pendingConfirmationIds) {
      uiStore.respondToToolConfirmation(confirmationId, false);
    }

    if (targetConvIds) {
      for (const convId of targetConvIds) {
        useModelStore.getState().cancelConversationStream(convId);
      }
    } else {
      modelCancelStream();
    }
    set((state) => {
      const convs = state.conversations.map((c) => {
        if (targetConvIds && !targetConvIds.has(c.id)) return c;
        const nextMessages = c.messages.map((m) => {
          if (m.isStreaming) {
            let thinkingDuration: number | undefined = undefined;
            const start = state.activeStreamThinkingStart?.[c.id];
            if (start) {
              const end = state.activeStreamThinkingEnd?.[c.id] || Date.now();
              thinkingDuration = Math.round((end - start) / 1000);
            }
            return {
              ...m,
              content: m.content + (state.activeStreamContent[c.id] || ""),
              reasoningContent: (m.reasoningContent || "") + (state.activeStreamReasoning[c.id] || "") || undefined,
              isStreaming: false,
              thinkingDuration: m.thinkingDuration ?? thinkingDuration,
            };
          }
          return m;
        });
        const nextStatus = c.isSubagent && c.status === "running" ? "stopped" : c.status;
        return { ...c, messages: nextMessages, status: nextStatus };
      });

      const nextGenByConv = { ...state.generationByConversation };
      if (targetConvIds) {
        for (const convId of targetConvIds) {
          delete nextGenByConv[convId];
        }
      } else {
        Object.keys(nextGenByConv).forEach((id) => {
          nextGenByConv[id] = { state: "cancelled" as GenerationState, label: "Cancelled" };
        });
      }

      const stillStreaming = Object.values(nextGenByConv).some((generation) => isGenerationActive(generation.state));

      const nextActiveStreamThinkingStart = { ...state.activeStreamThinkingStart };
      const nextActiveStreamThinkingEnd = { ...state.activeStreamThinkingEnd };
      const nextActiveStreamStartTime = { ...state.activeStreamStartTime };
      const nextActiveStreamContent = { ...state.activeStreamContent };
      const nextActiveStreamReasoning = { ...state.activeStreamReasoning };
      if (targetConvIds) {
        for (const convId of targetConvIds) {
          delete nextActiveStreamContent[convId];
          delete nextActiveStreamReasoning[convId];
          delete nextActiveStreamThinkingStart[convId];
          delete nextActiveStreamThinkingEnd[convId];
          delete nextActiveStreamStartTime[convId];
        }
      } else {
        Object.keys(nextActiveStreamContent).forEach((k) => delete nextActiveStreamContent[k]);
        Object.keys(nextActiveStreamReasoning).forEach((k) => delete nextActiveStreamReasoning[k]);
        Object.keys(nextActiveStreamThinkingStart).forEach((k) => delete nextActiveStreamThinkingStart[k]);
        Object.keys(nextActiveStreamThinkingEnd).forEach((k) => delete nextActiveStreamThinkingEnd[k]);
        Object.keys(nextActiveStreamStartTime).forEach((k) => delete nextActiveStreamStartTime[k]);
      }

      return {
        isStreaming: stillStreaming,
        generationState: stillStreaming ? state.generationState : ("idle" as GenerationState),
        generationLabel: stillStreaming ? state.generationLabel : "",
        generationByConversation: nextGenByConv,
        conversations: convs,
        activeStreamContent: nextActiveStreamContent,
        activeStreamReasoning: nextActiveStreamReasoning,
        activeStreamThinkingStart: nextActiveStreamThinkingStart,
        activeStreamThinkingEnd: nextActiveStreamThinkingEnd,
        activeStreamStartTime: nextActiveStreamStartTime,
      };
    });

    const stillStreaming = Object.values(get().generationByConversation).some((generation) =>
      isGenerationActive(generation.state),
    );
    if (!stillStreaming) {
      uiLoading("sendMessage", false);
      uiLoading("toolExecution", false);
    }
    await get().persistConversations();
  },

  retryLastMessage: async (convId) => {
    const { isStreaming, conversations } = get();
    const { selectedModel, models, temperature } = useModelStore.getState();

    if (isStreaming) return;

    const conv = conversations.find((c) => c.id === convId);
    if (!conv || conv.messages.length === 0) return;

    const { isProjectsEnabled, projects } = useProjectStore.getState();
    const toolLoop = getEnabledToolLoopConfig();
    const runContext = buildConversationRunContext({
      conversation: conv,
      models,
      selectedModel,
      temperature,
      projects,
      projectsEnabled: isProjectsEnabled,
      ...toolLoop,
    });
    if (!runContext) {
      showMissingModelConfig(
        "No model configuration selected — user tried to retry message without any model configured",
      );
      return;
    }

    let lastUserIdx = -1;
    for (let i = conv.messages.length - 1; i >= 0; i--) {
      if (conv.messages[i].role === "user") {
        lastUserIdx = i;
        break;
      }
    }
    if (lastUserIdx === -1) return;

    if (
      conv.messages[lastUserIdx].attachments?.some((attachment) => attachment.kind === "image") &&
      !runContext.attachmentCapabilities.images
    ) {
      uiToast(`${runContext.modelConfig.name} does not support image attachments.`, "error");
      return;
    }

    const trimmed = conv.messages.slice(0, lastUserIdx + 1);

    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === convId ? { ...c, messages: trimmed, timestamp: new Date() } : c,
      ),
    }));

    if (runContext.shouldUseTools) {
      await sendWithToolLoop(
        runContext,
        (fn) => set(fn as (state: ChatState) => Partial<ChatState>),
        get,
        searchPerformSearch,
        searchFetchUrlContent,
      );
    } else {
      await sendNormal(convId, runContext.modelConfig, runContext.temperature, set, get);
    }
  },

  applyPendingWorktree: async (convId) => {
    const conv = get().conversations.find((c) => c.id === convId);
    if (!conv || !conv.pendingWorktree) return;
    const projectId = conv.projectId ?? conv.pendingWorktree.commitScope?.projectId;
    if (!projectId) {
      uiToast("The original project could not be identified. This worktree was left intact for recovery.", "error");
      return;
    }

    uiLoading("toolExecution", true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const changedPaths = await invoke<string[]>("git_worktree_apply", {
        projectId,
        worktreePath: conv.pendingWorktree.path,
        branchName: conv.pendingWorktree.branch,
      });

      try {
        await invoke("set_project_path_override", { projectId, pathOverride: null });
      } catch (error) {
        logWarn("git", "Applied worktree but could not clear its project path override", { details: String(error) });
      }
      const projectStore = useProjectStore.getState();
      if (projectStore.activeWorktreePath === conv.pendingWorktree.path) {
        useProjectStore.setState({ activeWorktreePath: null, activeWorktreeBranch: null });
      }

      set((state) => ({
        conversations: state.conversations.map((c) => (c.id === convId ? { ...c, pendingWorktree: undefined } : c)),
      }));
      get().persistConversations();
      uiToast("Changes applied successfully to workspace!", "success");

      const commitScope = conv.pendingWorktree.commitScope;
      if (commitScope && commitScope.projectId === projectId) {
        await useGitStore.getState().autoCommitIfNeeded({
          ...commitScope,
          files: changedPaths,
        });
      } else if (changedPaths.length > 0) {
        logWarn("git", "Skipped auto-commit because the applied worktree had no captured run scope");
      }
    } catch (err) {
      logError("chat", "Failed to apply worktree changes", { error: err });
      uiToast("Failed to apply changes: " + parseApiError(err).message, "error");
    } finally {
      uiLoading("toolExecution", false);
    }
  },

  discardPendingWorktree: async (convId) => {
    const conv = get().conversations.find((c) => c.id === convId);
    if (!conv || !conv.pendingWorktree) return;
    const projectId = conv.projectId ?? conv.pendingWorktree.commitScope?.projectId;
    if (!projectId) {
      uiToast("The original project could not be identified. This worktree was left intact for recovery.", "error");
      return;
    }

    uiLoading("toolExecution", true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("git_worktree_discard", {
        projectId,
        worktreePath: conv.pendingWorktree.path,
        branchName: conv.pendingWorktree.branch,
      });

      try {
        await invoke("set_project_path_override", { projectId, pathOverride: null });
      } catch (error) {
        logWarn("git", "Discarded worktree but could not clear its project path override", {
          details: String(error),
        });
      }
      const projectStore = useProjectStore.getState();
      if (projectStore.activeWorktreePath === conv.pendingWorktree.path) {
        useProjectStore.setState({ activeWorktreePath: null, activeWorktreeBranch: null });
      }

      set((state) => ({
        conversations: state.conversations.map((c) => (c.id === convId ? { ...c, pendingWorktree: undefined } : c)),
      }));
      get().persistConversations();
      uiToast("Changes discarded successfully.", "info");
    } catch (err) {
      logError("chat", "Failed to discard worktree changes", { error: err });
      uiToast("Failed to discard changes: " + parseApiError(err).message, "error");
    } finally {
      uiLoading("toolExecution", false);
    }
  },

  exportChat: async (id) => {
    const conv = get().conversations.find((c) => c.id === id);
    if (!conv) return;

    try {
      const defaultName = `${conv.title.replace(/[^a-zA-Z0-9]/g, "_")}.md`;
      const saveResult = await invoke<[string, string] | null>("select_save_file_and_get_token", {
        title: "Export Chat",
        defaultName,
      });

      if (!saveResult) return;
      const [token, filePath] = saveResult;

      let content = "";
      if (filePath.endsWith(".json")) {
        content = JSON.stringify(conv, null, 2);
      } else {
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
        content = lines.join("\n\n");
      }

      await invoke("write_exported_file_by_token", { token, content });
      uiToast("Chat exported", "success");
    } catch (err) {
      logError("chat", "Failed to export chat", { error: err });
      uiToast("Failed to export chat", "error");
    }
  },

  persistConversations: async () => {
    const { hasStarted } = useUIStore.getState();
    if (!hasStarted) return;
    get().cleanupEmptyConversations();
    const { conversations } = get();
    const persistentConversations = conversations.filter((c) => !c.isTemporary);
    try {
      await saveConversations(persistentConversations);
    } catch {
      uiToast("Chat history could not be saved. The previous encrypted snapshot is still intact.", "error");
    }
  },

  resumeConversation: async (convId) => {
    const { conversations } = get();
    const conv = conversations.find((c) => c.id === convId);
    if (!conv) return;

    const { selectedModel, models, temperature } = useModelStore.getState();
    const { isProjectsEnabled, projects } = useProjectStore.getState();
    const toolLoop = getEnabledToolLoopConfig();
    const runContext = buildConversationRunContext({
      conversation: conv,
      models,
      selectedModel,
      temperature,
      projects,
      projectsEnabled: isProjectsEnabled,
      ...toolLoop,
    });
    if (!runContext) {
      logError("model", "No enabled model configuration available to resume conversation", {
        action: "Go to Settings > Model Providers and enable a model configuration.",
      });
      uiToast("No enabled model configured — enable one in settings/model-providers", "error");
      return;
    }

    if (runContext.shouldUseTools) {
      await sendWithToolLoop(
        runContext,
        (fn) => set(fn as (state: ChatState) => Partial<ChatState>),
        get,
        searchPerformSearch,
        searchFetchUrlContent,
      );
    } else {
      await sendNormal(convId, runContext.modelConfig, runContext.temperature, set, get);
    }
  },

  clearAllChats: async () => {
    const { conversations, activeId } = get();
    get().stopStreaming();
    set({ conversations: [], activeId: null });
    try {
      await clearConversations();
      uiToast("All chats cleared", "info");
    } catch {
      set({ conversations, activeId });
      uiToast("Chat clearing was incomplete. Retry to ensure encrypted files and their key are both removed.", "error");
    }
  },

  cleanup: () => {
    modelStopHealthCheck();
    get().stopStreaming();
    modelReleaseListeners();
  },

  draftAttachments: [],

  setDraftAttachments: (draftAttachments) => set({ draftAttachments }),

  addDraftFileFromToken: async (token: string, name?: string, size?: number) => {
    if (processingTokens.has(token)) {
      return;
    }
    processingTokens.add(token);

    const addToast = useUIStore.getState().addToast;
    const currentDrafts = get().draftAttachments;

    if (name && typeof size === "number") {
      const isDuplicate = currentDrafts.some((a) => a.name === name && a.size === size);
      if (isDuplicate) {
        processingTokens.delete(token);
        return;
      }
    }

    try {
      const payload = await invoke<{
        name: string;
        size: number;
        mimeType: string;
        dataUrl?: string;
        textContent?: string;
      }>("read_file_from_token", { token });

      // Fallback check in case metadata wasn't passed to addDraftFileFromToken
      const isDuplicate = currentDrafts.some((a) => a.name === payload.name && a.size === payload.size);
      if (isDuplicate) {
        return;
      }

      // Determine classification kind
      const isImage = payload.mimeType.startsWith("image/");
      const kind = isImage ? "image" : "text";

      const modelStore = useModelStore.getState();
      const currentModel = modelStore.models.find((m) => m.id === modelStore.selectedModel);
      if (isImage && currentModel && currentModel.supportsImages === false) {
        addToast(`"${currentModel.name}" does not support image inputs.`, "error");
        return;
      }

      const valResult = validateFile(
        {
          name: payload.name,
          size: payload.size,
          type: payload.mimeType,
        },
        currentDrafts.length,
      );

      if (!valResult.ok) {
        addToast(valResult.reason || "Invalid file", "error");
        return;
      }

      const attachment: Attachment = {
        id: generateId(),
        name: payload.name,
        mimeType: payload.mimeType,
        size: payload.size,
        kind,
        dataUrl: payload.dataUrl,
        textContent: payload.textContent,
      };

      set({ draftAttachments: [...currentDrafts, attachment] });
    } catch (err) {
      const errMsg = parseApiError(err).message;
      addToast(errMsg, "error");
    } finally {
      setTimeout(() => {
        processingTokens.delete(token);
      }, 5000);
    }
  },

  setGenerationState: (state, label, error) => {
    const generationLabel = error ? `${label ?? state}: ${error}` : (label ?? state);
    set({
      generationState: state,
      generationLabel,
      ...(get().activeId
        ? {
            generationByConversation: setConversationGeneration(get(), get().activeId!, state, generationLabel),
          }
        : {}),
    });
  },
}));

async function sendNormal(
  convId: string,
  modelConfig: ModelConfig,
  temperature: number,
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

  set((state) => {
    const nextContent = { ...state.activeStreamContent };
    delete nextContent[convId];
    const nextReasoning = { ...state.activeStreamReasoning };
    delete nextReasoning[convId];
    const nextStart = { ...state.activeStreamThinkingStart };
    delete nextStart[convId];
    const nextEnd = { ...state.activeStreamThinkingEnd };
    delete nextEnd[convId];
    const nextStreamStartTime = { ...state.activeStreamStartTime };
    delete nextStreamStartTime[convId];
    return {
      isStreaming: true,
      generationState: "loading" as GenerationState,
      generationLabel: "Loading",
      generationByConversation: setConversationGeneration(state, convId, "loading" as GenerationState, "Loading"),
      conversations: updateConversationMessages(state.conversations, convId, (msgs) => [...msgs, assistantMsg]),
      activeStreamContent: nextContent,
      activeStreamReasoning: nextReasoning,
      activeStreamThinkingStart: nextStart,
      activeStreamThinkingEnd: nextEnd,
      activeStreamStartTime: nextStreamStartTime,
    };
  });
  uiLoading("sendMessage", true);

  const streamId = generateId();
  const modelStore = useModelStore.getState();
  modelStore.setActiveStreamId(streamId, convId);

  logInfo("chat", `Sending message to ${modelConfig.name}`, {
    details: `Model: ${modelConfig.modelId}, API: ${modelConfig.apiBase}, Stream ID: ${streamId}`,
  });

  let cleanupStream: (() => void) | null = null;

  try {
    cleanupStream = await modelStore.ensureStreamListeners(
      convId,
      ({ kind, content }) => {
        set((state) => {
          const nextActiveStreamThinkingStart = { ...state.activeStreamThinkingStart };
          const nextActiveStreamThinkingEnd = { ...state.activeStreamThinkingEnd };
          const nextActiveStreamStartTime = { ...state.activeStreamStartTime };
          nextActiveStreamStartTime[convId] ||= Date.now();

          const isReasoning = kind === "reasoning";
          if (isReasoning) {
            nextActiveStreamThinkingStart[convId] ||= Date.now();
          } else if (nextActiveStreamThinkingStart[convId] && !nextActiveStreamThinkingEnd[convId]) {
            nextActiveStreamThinkingEnd[convId] = Date.now();
          }
          const generationState = isReasoning ? ("thinking" as GenerationState) : ("responding" as GenerationState);
          const generationLabel = isReasoning ? "Thinking" : "Responding";

          return {
            generationState,
            generationLabel,
            generationByConversation: setConversationGeneration(state, convId, generationState, generationLabel),
            ...(isReasoning
              ? {
                  activeStreamReasoning: {
                    ...state.activeStreamReasoning,
                    [convId]: (state.activeStreamReasoning[convId] || "") + content,
                  },
                }
              : {
                  activeStreamContent: {
                    ...state.activeStreamContent,
                    [convId]: (state.activeStreamContent[convId] || "") + content,
                  },
                }),
            activeStreamThinkingStart: nextActiveStreamThinkingStart,
            activeStreamThinkingEnd: nextActiveStreamThinkingEnd,
            activeStreamStartTime: nextActiveStreamStartTime,
          };
        });
      },
      () => {
        logInfo("stream", `Stream completed`, {
          details: `Conversation: ${convId}`,
        });
        set((state) => {
          const streamContent = state.activeStreamContent[convId] || "";
          const streamReasoning = state.activeStreamReasoning[convId] || "";
          let thinkingDuration: number | undefined = undefined;
          const start = state.activeStreamThinkingStart?.[convId];
          if (start) {
            const end = state.activeStreamThinkingEnd?.[convId] || Date.now();
            thinkingDuration = Math.round((end - start) / 1000);
          }

          const conversations = state.conversations.map((c) => {
            if (c.id !== convId) return c;
            const updated = [...c.messages];
            const lastAssistantIdx = [...updated].reverse().findIndex((m) => m.role === "assistant");
            if (lastAssistantIdx >= 0) {
              const idx = updated.length - 1 - lastAssistantIdx;
              const last = updated[idx];
              updated[idx] = {
                ...last,
                content: last.content + streamContent,
                reasoningContent: (last.reasoningContent || "") + streamReasoning || undefined,
                isStreaming: false,
                thinkingDuration: last.thinkingDuration ?? thinkingDuration,
              };
            }
            return { ...c, messages: updated };
          });
          const nextActiveStreamContent = { ...state.activeStreamContent };
          delete nextActiveStreamContent[convId];
          const nextActiveStreamReasoning = { ...state.activeStreamReasoning };
          delete nextActiveStreamReasoning[convId];

          const nextStart = { ...state.activeStreamThinkingStart };
          delete nextStart[convId];
          const nextEnd = { ...state.activeStreamThinkingEnd };
          delete nextEnd[convId];
          const nextStreamStartTime = { ...state.activeStreamStartTime };
          delete nextStreamStartTime[convId];

          return {
            conversations,
            activeStreamContent: nextActiveStreamContent,
            activeStreamReasoning: nextActiveStreamReasoning,
            activeStreamThinkingStart: nextStart,
            activeStreamThinkingEnd: nextEnd,
            activeStreamStartTime: nextStreamStartTime,
          };
        });
      },
    );

    const conv = get().conversations.find((c) => c.id === convId);
    const apiMessages: { role: string; content: string | unknown[] }[] =
      conv?.messages
        .filter((m) => (m.role === "user" || m.role === "assistant") && !m.isStreaming)
        .map((m) => ({
          role: m.role,
          content: m.role === "user" ? buildUserApiContent(m.content, m.attachments) : m.content,
        })) ?? [];

    const systemPrompt =
      modelConfig.systemPromptOverride && modelConfig.systemPromptOverride.trim()
        ? modelConfig.systemPromptOverride
        : useModelStore.getState().systemPrompt;
    if (systemPrompt && systemPrompt.trim()) {
      apiMessages.unshift({ role: "system", content: systemPrompt });
    }

    const requestTemp = modelConfig.temperature !== undefined ? modelConfig.temperature : temperature;
    const maxTokens = modelConfig.maxOutputTokens !== undefined ? modelConfig.maxOutputTokens : undefined;

    await invoke("chat_stream", {
      configId: modelConfig.id,
      messages: apiMessages,
      temperature: requestTemp,
      maxTokens,
      thinkingLevel: modelConfig.thinkingLevel ?? "auto",
      streamId,
    });

    useModelStore.getState().removeActiveStreamId(streamId);

    const start = get().activeStreamThinkingStart?.[convId];
    let thinkingDuration: number | undefined = undefined;
    if (start) {
      const end = get().activeStreamThinkingEnd?.[convId] || Date.now();
      thinkingDuration = Math.round((end - start) / 1000);
    }

    set((state) => {
      const updatedConvs = finalizeAssistantMessage(state.conversations, convId, thinkingDuration);
      const generationByConversation = setConversationGeneration(state, convId, "idle" as GenerationState, "");
      const stillStreaming = Object.values(generationByConversation).some((generation) =>
        isGenerationActive(generation.state),
      );
      const nextStart = { ...state.activeStreamThinkingStart };
      delete nextStart[convId];
      const nextEnd = { ...state.activeStreamThinkingEnd };
      delete nextEnd[convId];
      const nextStreamStartTime = { ...state.activeStreamStartTime };
      delete nextStreamStartTime[convId];

      return {
        conversations: updatedConvs,
        activeStreamThinkingStart: nextStart,
        activeStreamThinkingEnd: nextEnd,
        activeStreamStartTime: nextStreamStartTime,
        isStreaming: stillStreaming,
        generationState: stillStreaming ? state.generationState : ("idle" as GenerationState),
        generationLabel: stillStreaming ? state.generationLabel : "",
        generationByConversation,
      };
    });

    get().persistConversations();
  } catch (err) {
    const parsed = parseApiError(err);
    useModelStore.getState().removeActiveStreamId(streamId);
    set((state) => {
      const generationLabel = `Generation failed: ${parsed.message}`;
      return {
        conversations: setAssistantError(state.conversations, convId, err),
        isStreaming: Object.entries(state.generationByConversation).some(
          ([id, generation]) => id !== convId && isGenerationActive(generation.state),
        ),
        generationState: "error" as GenerationState,
        generationLabel,
        generationByConversation: setConversationGeneration(state, convId, "error" as GenerationState, generationLabel),
      };
    });
    uiToast(parsed.message, "error");
    logError("chat", "Failed to send message or stream response", {
      error: err,
      action: parsed.action,
      details: `Model: ${modelConfig?.name}, Category: ${parsed.category}, Retryable: ${parsed.retryable}${parsed.rawDetail ? `\nRaw: ${parsed.rawDetail}` : ""}`,
    });
  } finally {
    cleanupStream?.();
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
    provider: titleModelConfig.provider,
    userMessage: userText,
    systemPrompt,
  })
    .then((title) => {
      const trimmed = title.trim();
      if (trimmed) {
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === convId ? { ...c, title: c.id.startsWith("compare-") ? `${trimmed} (Compare)` : trimmed } : c,
          ),
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
