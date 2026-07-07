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
  loadStrictSsl,
  loadBlockedHosts,
  DEFAULT_BLOCKED_HOSTS,
  loadOfflineMode,
  loadLanguage,
} from "../utils/storage";
import { generateId } from "../utils/generateId";
import { logError, logInfo, logWarn } from "../utils/logger";
import { TITLE_MAX_LENGTH } from "../config/constants";
import { parseApiError } from "../utils/parseApiError";
import { sendWithToolLoop } from "../services/toolLoop";
import { buildUserApiContent, validateFile } from "../utils/attachments";
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

interface EnabledToolLoopConfig {
  shouldUseTools: boolean;
  searchConfig: SearchApiConfig | undefined;
  searchApiKey: string;
  mcpTools: McpTool[];
  mcpCallTool:
    ((serverId: string, toolName: string, args: Record<string, string>) => Promise<McpToolResult>) | undefined;
}

function getEnabledToolLoopConfig(): EnabledToolLoopConfig {
  const { isSearchEnabled, activeSearchId, searchConfigs, searchApiKeys } = useSearchStore.getState();
  const searchConfig =
    isSearchEnabled && activeSearchId ? searchConfigs.find((config) => config.id === activeSearchId) : undefined;
  const searchApiKey = searchConfig ? (searchApiKeys[searchConfig.id] ?? searchConfig.apiKey ?? "") : "";

  const { enabledServerIds, availableTools } = useMcpStore.getState();
  const mcpTools = availableTools.filter((tool) => enabledServerIds.has(tool.serverId));
  const mcpCallTool =
    mcpTools.length > 0
      ? (serverId: string, toolName: string, args: Record<string, string>) =>
          useMcpStore.getState().callTool(serverId, toolName, args)
      : undefined;

  const { activeProjectId, isProjectsEnabled } = useProjectStore.getState();

  return {
    shouldUseTools: Boolean(searchConfig) || mcpTools.length > 0 || Boolean(isProjectsEnabled && activeProjectId),
    searchConfig,
    searchApiKey,
    mcpTools,
    mcpCallTool,
  };
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

  setCompareIds: (ids: string[]) => void;
  setIsCompareMode: (val: boolean) => void;

  init: () => Promise<void>;
  cleanupEmptyConversations: (exceptId?: string | null) => void;
  setActiveId: (id: string | null, isHistoryMove?: boolean) => void;
  navigateBack: () => void;
  navigateForward: () => void;
  newChat: () => string;
  deleteChat: (id: string) => void;
  renameChat: (id: string, newTitle: string) => void;
  togglePinChat: (id: string) => void;
  confirmRename: (newTitle: string) => void;
  sendMessage: (text: string, attachments?: Attachment[]) => Promise<void>;
  retryLastMessage: (convId: string) => Promise<void>;
  stopStreaming: () => void;
  exportChat: (id: string) => void | Promise<void>;
  persistConversations: () => Promise<void>;
  clearAllChats: () => Promise<void>;
  applyPendingWorktree: (convId: string) => Promise<void>;
  discardPendingWorktree: (convId: string) => Promise<void>;
  cleanup: () => void;
  setGenerationState: (state: GenerationState, label?: string, error?: string) => void;
  setDraftAttachments: (attachments: Attachment[]) => void;
  addDraftFileFromToken: (token: string) => Promise<void>;
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

  setCompareIds: (compareIds) => set({ compareIds }),
  setIsCompareMode: (isCompareMode) => set({ isCompareMode }),

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
        loadedStrictSsl,
        loadedBlockedHosts,
        loadedOfflineMode,
        loadedLanguage,
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
        loadStrictSsl(),
        loadBlockedHosts(),
        loadOfflineMode(),
        loadLanguage(),
        useProjectStore.getState().init(),
      ]);

      const models = loadedModels || [];
      const modelsWithKeys = models.map((m) => ({
        ...m,
        apiKey: loadedKeys[m.id] ?? m.apiKey,
      }));

      const storedHasStarted = await loadHasStarted();
      const hasOnboarded = storedHasStarted || modelsWithKeys.length > 0;

      if (!hasOnboarded) {
        localStorage.clear();
      }

      const nonEmptyConvs = hasOnboarded ? (loadedConvs || []).filter((c) => c.messages.length > 0) : [];
      const searchConfigs = loadedSearchConfigs || [];

      modelSetState({
        models: modelsWithKeys,
        selectedModel: modelsWithKeys.length > 0 ? modelsWithKeys[0].id : "",
        apiKeys: loadedKeys,
        modelStatuses: {},
        titleConfig: loadedTitleCfg,
        systemPrompt: loadedSystemPrompt,
        maxToolSteps: loadedMaxToolSteps,
      });

      searchSetState({
        searchConfigs,
        activeSearchId: searchConfigs.find((c) => c.enabled)?.id ?? null,
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
        enabledServerIds: new Set(mcpEnabledServers.filter((id) => mcpConfigs.some((c) => c.id === id))),
      });

      const initialActiveId = nonEmptyConvs.length > 0 ? nonEmptyConvs[0].id : null;
      set({
        conversations: nonEmptyConvs,
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
        strictSsl: hasOnboarded ? loadedStrictSsl : true,
        blockedHosts: hasOnboarded ? loadedBlockedHosts : DEFAULT_BLOCKED_HOSTS,
        offlineMode: hasOnboarded ? loadedOfflineMode : false,
        language: hasOnboarded ? loadedLanguage : "en",
      });
      if (typeof document !== "undefined") {
        document.documentElement.lang = hasOnboarded ? loadedLanguage : "en";
      }
      document.documentElement.classList.toggle("animations-disabled", hasOnboarded ? loadedAnimationsDisabled : false);

      // Apply always-on-top setting
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        getCurrentWindow()
          .setAlwaysOnTop(hasOnboarded ? loadedAlwaysOnTop : false)
          .catch((e) => {
            logWarn("general", "Could not apply always-on-top on startup (promise rejected)", { details: String(e) });
          });
      } catch (e) {
        logWarn("general", "Could not apply always-on-top on startup", { details: String(e) });
      }

      // Synchronize launch on startup with the OS autostart setting
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const currentlyEnabled = await invoke<boolean>("is_autostart_enabled");
        if (loadedLaunchOnStartup !== currentlyEnabled) {
          await invoke("set_autostart_enabled", { enabled: loadedLaunchOnStartup });
        }
      } catch (e) {
        logWarn("general", "Could not synchronize launch on startup with OS", { details: String(e) });
      }

      logInfo("chat", "App state initialized", {
        details: `Loaded ${modelsWithKeys.length} models, ${nonEmptyConvs.length} conversations, ${searchConfigs.length} search configs, ${mcpConfigs.length} MCP servers`,
      });

      if (!loadedDisableBgActivity) {
        modelCheckConnections();
        modelStartHealthCheck();
      }

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

  cleanupEmptyConversations: (exceptId?: string | null) => {
    const { conversations, activeId } = get();
    const keepId = exceptId !== undefined ? exceptId : activeId;
    const nonEmpty = conversations.filter((c) => {
      if (c.id.startsWith("compare-")) {
        return get().isCompareMode && get().compareIds.includes(c.id);
      }
      return c.messages.length > 0 || c.id === keepId;
    });
    if (nonEmpty.length === conversations.length) return;
    const activeRemoved = activeId && !nonEmpty.find((c) => c.id === activeId);
    set({
      conversations: nonEmpty,
      ...(activeRemoved ? { activeId: nonEmpty.length > 0 ? nonEmpty[0].id : null } : {}),
    });
  },

  setActiveId: (id, isHistoryMove = false) => {
    const { activeId, navigationHistory, navigationIndex } = get();
    if (activeId === id) return;

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
    set((state) => {
      const newHistory = state.navigationHistory.slice(0, state.navigationIndex + 1);
      newHistory.push(id);
      return {
        conversations: [conv, ...state.conversations],
        activeId: id,
        navigationHistory: newHistory,
        navigationIndex: newHistory.length - 1,
      };
    });
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
      const newHistory = state.navigationHistory.filter((x) => x !== id);
      let newIndex = state.navigationIndex;
      const oldActiveIndex = state.navigationHistory.indexOf(id);
      if (oldActiveIndex !== -1) {
        if (newIndex >= oldActiveIndex) {
          newIndex = Math.max(0, newIndex - 1);
        }
      }
      if (newIndex >= newHistory.length) {
        newIndex = newHistory.length - 1;
      }
      const nextActiveId = state.activeId === id ? (newIndex >= 0 ? newHistory[newIndex] : null) : state.activeId;

      const isCompareDeleted = state.compareIds.includes(id);
      const isActiveDeleted = state.activeId === id;
      const nextCompareIds = state.compareIds.filter((x) => x !== id);

      return {
        conversations: state.conversations.filter((c) => c.id !== id),
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
    const { isStreaming, activeId, isCompareMode, compareIds } = get();
    const { selectedModel, models, temperature, apiKeys, titleConfig } = useModelStore.getState();

    if (isStreaming) return;

    let convId = activeId;
    let activeCompareIds = [...compareIds];

    const firstAttachmentName = attachments && attachments.length > 0 ? attachments[0].name : "New chat";
    const initialTitle = text ? truncateTitle(text) : firstAttachmentName;
    const { activeProjectId, isProjectsEnabled } = useProjectStore.getState();

    if (!convId) {
      const id = generateId();
      const modelConfig = models.find((m) => m.id === selectedModel);
      const conv: Conversation = {
        id,
        title: initialTitle,
        timestamp: new Date(),
        messages: [],
        model: modelConfig?.id || selectedModel,
        projectId: (isProjectsEnabled && activeProjectId) || undefined,
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
        projectId: (isProjectsEnabled && activeProjectId) || undefined,
      };
      set((state) => ({
        conversations: [conv, ...state.conversations],
        compareIds: [id],
      }));
      activeCompareIds = [id];
    }

    const userMsg: Message = {
      id: generateId(),
      role: "user",
      content: text,
      timestamp: new Date(),
      attachments,
    };

    const fallbackTitle = text ? truncateTitle(text) : firstAttachmentName;

    const runForConversation = async (cId: string, modelConfig: ModelConfig) => {
      if (!modelConfig) return;
      const currentConvs = get().conversations;
      const isFirstForThis = (currentConvs.find((c) => c.id === cId)?.messages?.length ?? 0) === 0;

      set((state) => ({
        conversations: updateConversationMessages(state.conversations, cId, (msgs) => [...msgs, userMsg], {
          title: isFirstForThis
            ? activeCompareIds.includes(cId)
              ? fallbackTitle + " (Compare)"
              : fallbackTitle
            : undefined,
        }),
      }));

      if (isFirstForThis && titleConfig.enabled) {
        generateConversationTitle(cId, text || fallbackTitle, modelConfig, apiKeys, titleConfig, set, get);
      }

      const toolLoop = getEnabledToolLoopConfig();
      if (toolLoop.shouldUseTools) {
        const {
          activeProjectId: runActiveProjectId,
          isProjectsEnabled: runProjectsEnabled,
          projects: runProjects,
        } = useProjectStore.getState();
        const activeProject = runProjectsEnabled ? runProjects.find((p) => p.id === runActiveProjectId) || null : null;
        await sendWithToolLoop(
          cId,
          modelConfig,
          temperature,
          toolLoop.searchConfig,
          toolLoop.searchApiKey,
          toolLoop.mcpTools,
          toolLoop.mcpCallTool,
          (fn) => set(fn as (state: ChatState) => Partial<ChatState>),
          get,
          searchPerformSearch,
          searchFetchUrlContent,
          activeProject,
        );
      } else {
        await sendNormal(cId, modelConfig, temperature, set, get);
      }
    };

    const primaryConv = get().conversations.find((c) => c.id === convId);
    const primaryModel = primaryConv?.model || selectedModel;
    let primaryModelConfig = models.find((m) => m.id === primaryModel) ?? models[0];

    const {
      activeProjectId: sendActiveProjectId,
      isProjectsEnabled: sendProjectsEnabled,
      projects: sendProjects,
    } = useProjectStore.getState();
    const activeProject = sendProjectsEnabled ? sendProjects.find((p) => p.id === sendActiveProjectId) || null : null;
    if (activeProject && activeProject.modelOverride) {
      const overrideModel = models.find((m) => m.id === activeProject.modelOverride);
      if (overrideModel && overrideModel.enabled !== false) {
        primaryModelConfig = overrideModel;
      }
    }

    if (!primaryModelConfig) {
      logError("model", "No model configuration selected — user tried to send message without any model configured", {
        action: "Go to Settings > Model Providers and add at least one model configuration.",
      });
      uiToast("No model configured — add one in Settings", "error");
      return;
    }

    set({
      isStreaming: true,
      generationState: "thinking" as GenerationState,
      generationLabel: "Thinking",
    });

    const promises = [runForConversation(convId, primaryModelConfig)];

    if (isCompareMode && activeCompareIds.length > 0) {
      for (const compId of activeCompareIds) {
        const compareConv = get().conversations.find((c) => c.id === compId);
        if (!compareConv) continue;
        const compareModel = compareConv.model || selectedModel;
        const compareModelConfig = models.find((m) => m.id === compareModel) ?? models[0];
        if (compareModelConfig) {
          promises.push(runForConversation(compId, compareModelConfig));
        }
      }
    }

    await Promise.all(promises);

    useGitStore.getState().autoCommitIfNeeded();
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
        generationByConversation: {},
        conversations: convs,
      };
    });
    uiLoading("sendMessage", false);
    uiLoading("toolExecution", false);
  },

  retryLastMessage: async (convId) => {
    const { isStreaming, conversations } = get();
    const { selectedModel, models, temperature } = useModelStore.getState();

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

    const {
      activeProjectId: retryActiveProjectId,
      isProjectsEnabled: retryProjectsEnabled,
      projects: retryProjects,
    } = useProjectStore.getState();
    const activeProject = retryProjectsEnabled
      ? retryProjects.find((p) => p.id === retryActiveProjectId) || null
      : null;
    let modelConfig =
      models.find((m) => m.id === conv.model) ?? models.find((m) => m.id === selectedModel) ?? models[0];
    if (activeProject && activeProject.modelOverride) {
      const overrideModel = models.find((m) => m.id === activeProject.modelOverride);
      if (overrideModel && overrideModel.enabled !== false) {
        modelConfig = overrideModel;
      }
    }
    if (!modelConfig) {
      logError("model", "No model configuration selected — user tried to retry message without any model configured", {
        action: "Go to Settings > Model Providers and add at least one model configuration.",
      });
      uiToast("No model configured — add one in Settings", "error");
      return;
    }

    const toolLoop = getEnabledToolLoopConfig();
    if (toolLoop.shouldUseTools) {
      const {
        activeProjectId: retryToolActiveProjectId,
        isProjectsEnabled: retryToolProjectsEnabled,
        projects: retryToolProjects,
      } = useProjectStore.getState();
      const activeProject = retryToolProjectsEnabled
        ? retryToolProjects.find((p) => p.id === retryToolActiveProjectId) || null
        : null;
      await sendWithToolLoop(
        convId,
        modelConfig,
        temperature,
        toolLoop.searchConfig,
        toolLoop.searchApiKey,
        toolLoop.mcpTools,
        toolLoop.mcpCallTool,
        (fn) => set(fn as (state: ChatState) => Partial<ChatState>),
        get,
        searchPerformSearch,
        searchFetchUrlContent,
        activeProject,
      );
    } else {
      await sendNormal(convId, modelConfig, temperature, set, get);
    }

    // Auto-commit if enabled and changes exist
    useGitStore.getState().autoCommitIfNeeded();
  },

  applyPendingWorktree: async (convId) => {
    const conv = get().conversations.find((c) => c.id === convId);
    if (!conv || !conv.pendingWorktree || !conv.projectId) return;

    uiLoading("toolExecution", true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("git_worktree_apply", {
        projectId: conv.projectId,
        worktreePath: conv.pendingWorktree.path,
        branchName: conv.pendingWorktree.branch,
      });

      await useProjectStore.getState().setWorktree(null, null);

      set((state) => ({
        conversations: state.conversations.map((c) => (c.id === convId ? { ...c, pendingWorktree: undefined } : c)),
      }));
      get().persistConversations();
      uiToast("Changes applied successfully to workspace!", "success");
    } catch (err) {
      logError("chat", "Failed to apply worktree changes", { error: err });
      uiToast("Failed to apply changes: " + parseApiError(err).message, "error");
    } finally {
      uiLoading("toolExecution", false);
    }
  },

  discardPendingWorktree: async (convId) => {
    const conv = get().conversations.find((c) => c.id === convId);
    if (!conv || !conv.pendingWorktree || !conv.projectId) return;

    uiLoading("toolExecution", true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("git_worktree_discard", {
        projectId: conv.projectId,
        worktreePath: conv.pendingWorktree.path,
        branchName: conv.pendingWorktree.branch,
      });

      await useProjectStore.getState().setWorktree(null, null);

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

  draftAttachments: [],

  setDraftAttachments: (draftAttachments) => set({ draftAttachments }),

  addDraftFileFromToken: async (token: string) => {
    const addToast = useUIStore.getState().addToast;
    const currentDrafts = get().draftAttachments;

    try {
      const payload = await invoke<{
        name: string;
        size: number;
        mimeType: string;
        dataUrl?: string;
        textContent?: string;
      }>("read_file_from_token", { token });

      // Check for duplicate by name and size
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
      const errMsg = err instanceof Error ? err.message : String(err);
      addToast(errMsg || `Failed to read file from token`, "error");
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

  set((state) => ({
    isStreaming: true,
    generationState: "thinking" as GenerationState,
    generationLabel: "Thinking",
    generationByConversation: setConversationGeneration(state, convId, "thinking" as GenerationState, "Thinking"),
    conversations: updateConversationMessages(state.conversations, convId, (msgs) => [...msgs, assistantMsg]),
  }));
  uiLoading("sendMessage", true);

  const streamId = generateId();
  const modelStore = useModelStore.getState();
  modelStore.setActiveStreamId(streamId, convId);

  logInfo("chat", `Sending message to ${modelConfig.name}`, {
    details: `Model: ${modelConfig.modelId}, API: ${modelConfig.apiBase}, Stream ID: ${streamId}`,
  });

  try {
    await modelStore.ensureStreamListeners(
      (cId, content) => {
        set((state) => {
          const newState: Partial<ChatState> = {};
          if (state.generationState === "thinking" && !content.startsWith("<reasoning>")) {
            newState.generationState = "responding";
            newState.generationLabel = "Responding";
          }
          const nextGenerationByConversation = content.startsWith("<reasoning>")
            ? state.generationByConversation
            : setConversationGeneration(state, cId, "responding" as GenerationState, "Responding");
          return {
            ...newState,
            generationByConversation: nextGenerationByConversation,
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
        set((state) => {
          const conversations = state.conversations.map((c) => {
            if (c.id !== cId) return c;
            const updated = [...c.messages];
            const last = updated[updated.length - 1];
            if (last && last.role === "assistant") {
              updated[updated.length - 1] = { ...last, isStreaming: false };
            }
            return { ...c, messages: updated };
          });
          const stillStreaming = conversations.some((c) => c.messages.some((m) => m.isStreaming));
          return {
            conversations,
            isStreaming: stillStreaming,
            generationState: stillStreaming ? state.generationState : ("idle" as GenerationState),
            generationLabel: stillStreaming ? state.generationLabel : "",
            generationByConversation: setConversationGeneration(state, cId, "idle" as GenerationState, ""),
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
      streamId,
    });

    const convBeforeFinalize = get().conversations.find((c) => c.id === convId);
    const lastMsg = convBeforeFinalize?.messages[convBeforeFinalize.messages.length - 1];
    const streamStillActive = lastMsg && lastMsg.role === "assistant" && lastMsg.isStreaming;

    if (streamStillActive) {
      useModelStore.getState().removeActiveStreamId(streamId);
    }

    set((state) => ({
      conversations: finalizeAssistantMessage(state.conversations, convId),
      ...(streamStillActive
        ? {
            isStreaming: finalizeAssistantMessage(state.conversations, convId).some((c) =>
              c.messages.some((m) => m.isStreaming),
            ),
          }
        : {}),
    }));

    get().persistConversations();
  } catch (err) {
    const parsed = parseApiError(err);
    useModelStore.getState().removeActiveStreamId(streamId);
    set((state) => {
      const generationLabel = `Generation failed: ${parsed.message}`;
      return {
        conversations: setAssistantError(state.conversations, convId, err),
        isStreaming: Object.keys(state.generationByConversation).some((id) => id !== convId),
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
    modelReleaseListeners();
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
