import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { motion, AnimatePresence } from "motion/react";
import {
  Menu,
  PanelLeft,
  MessageSquarePlus,
  ChevronLeft,
  ChevronRight,
  Split,
  X,
  Plus,
  Link,
  Maximize2,
  Minimize2,
  ArrowLeft,
  Ghost,
} from "lucide-react";
import Sidebar from "./components/Sidebar";
import ChatArea from "./components/ChatArea";
import { type Conversation, STATUS_COLORS } from "./types";
import { ComparisonColumn } from "./components/ComparisonColumn";
import InputBar from "./components/InputBar";
import Settings from "./components/settings";
import ScrollToBottomButton from "./components/ScrollToBottomButton";
import { RenameChatModal, ToolConfirmationModal, UpdateModal } from "./components/ui/Modal";
import { Spinner } from "./components/ui/Spinner";
import { ToastContainer } from "./components/ui/Toast";
import { LinkWarningModal } from "./components/LinkWarningModal";

const STATUS_LABELS: Record<string, string> = {
  disconnected: "Disconnected",
  connecting: "Connecting\u2026",
  connected: "Connected",
  error: "Connection error",
};
import StartScreen from "./components/StartScreen";
import { DragOverlay } from "./components/ui/DragOverlay";
import { TitleBar } from "./components/TitleBar";
import { CommandPalette } from "./components/CommandPalette";
import ProjectConfigModal from "./components/ProjectConfigModal";
import { SpotlightArea } from "./components/SpotlightArea";
import { useChatStore } from "./store/useChatStore";
import { useModelStore } from "./store/useModelStore";
import { useSearchStore } from "./store/useSearchStore";
import { useMcpStore } from "./store/useMcpStore";
import { useUIStore } from "./store/useUIStore";
import { useProjectStore } from "./store/useProjectStore";
import { useKeybindStore, matchKeybind } from "./store/useKeybindStore";
import { useAppshotStore } from "./store/useAppshotStore";
import { useShallow } from "zustand/react/shallow";
import { useScrollButton } from "./hooks/useScrollPosition";
import { useScrollTracking } from "./hooks/useScrollTracking";
import { springs, motionTokens } from "./lib/motion-tokens";
import { useTranslation } from "./utils/i18n";

import "./index.css";

const STATUS_KEYS: Record<string, string> = {
  disconnected: "status.disconnected",
  connecting: "status.connecting",
  connected: "status.connected",
  error: "status.error",
};

function getSafeSrcDoc(content: string, allowNetwork: boolean): string {
  const connectSrc = allowNetwork ? "*" : "'none'";
  const imgSrc = allowNetwork ? "*" : "'self' data: blob:";
  const fontSrc = allowNetwork ? "*" : "'self' data:";
  const styleSrc = "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; style-src 'self' 'unsafe-inline';";

  const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${styleSrc} connect-src ${connectSrc}; img-src ${imgSrc}; font-src ${fontSrc}; object-src 'none'; frame-src 'none';">`;

  const lowerContent = content.toLowerCase();
  const headIndex = lowerContent.indexOf("<head>");
  if (headIndex !== -1) {
    const insertPos = headIndex + 6;
    return content.slice(0, insertPos) + "\n  " + cspMeta + content.slice(insertPos);
  }

  const htmlIndex = lowerContent.indexOf("<html>");
  if (htmlIndex !== -1) {
    const insertPos = htmlIndex + 6;
    return content.slice(0, insertPos) + "\n<head>\n  " + cspMeta + "\n</head>" + content.slice(insertPos);
  }

  return "<!DOCTYPE html>\n<html>\n<head>\n  " + cspMeta + "\n</head>\n<body>\n" + content + "\n</body>\n</html>";
}

function App() {
  const { t } = useTranslation();
  const isMac = typeof window !== "undefined" && window.navigator.userAgent.includes("Mac");
  const [isMobile, setIsMobile] = useState(false);
  const activeListenerIdRef = useRef("");

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);

    // Show window after React has mounted to prevent white flash
    // We delay it slightly to ensure the first frame is painted
    setTimeout(() => {
      getCurrentWindow().show();
    }, 100);

    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const {
    conversations,
    activeId,
    isStreaming,
    generationState,
    generationByConversation,
    navigationHistory,
    navigationIndex,
    isCompareMode,
    compareIds,
  } = useChatStore(
    useShallow((s) => ({
      conversations: s.conversations,
      activeId: s.activeId,
      isStreaming: s.isStreaming,
      generationState: s.generationState,
      generationByConversation: s.generationByConversation,
      navigationHistory: s.navigationHistory,
      navigationIndex: s.navigationIndex,
      isCompareMode: s.isCompareMode,
      compareIds: s.compareIds,
    })),
  );
  const {
    init,
    setActiveId,
    newChat,
    newTemporaryChat,
    deleteChat,
    sendMessage,
    stopStreaming,
    retryLastMessage,
    exportChat,
    confirmRename,
    navigateBack,
    navigateForward,
    setIsCompareMode,
    togglePinChat,
  } = useChatStore(
    useShallow((s) => ({
      init: s.init,
      setActiveId: s.setActiveId,
      newChat: s.newChat,
      newTemporaryChat: s.newTemporaryChat,
      deleteChat: s.deleteChat,
      sendMessage: s.sendMessage,
      stopStreaming: s.stopStreaming,
      retryLastMessage: s.retryLastMessage,
      exportChat: s.exportChat,
      confirmRename: s.confirmRename,
      navigateBack: s.navigateBack,
      navigateForward: s.navigateForward,
      setIsCompareMode: s.setIsCompareMode,
      togglePinChat: s.togglePinChat,
    })),
  );

  const { models, selectedModel, modelStatuses } = useModelStore(
    useShallow((s) => ({
      models: s.models,
      selectedModel: s.selectedModel,
      modelStatuses: s.modelStatuses,
    })),
  );
  const { setSelectedModel } = useModelStore(
    useShallow((s) => ({
      setSelectedModel: s.setSelectedModel,
    })),
  );

  const { isSearchEnabled } = useSearchStore(
    useShallow((s) => ({
      isSearchEnabled: s.isSearchEnabled,
    })),
  );
  const { toggleSearchEnabled } = useSearchStore(
    useShallow((s) => ({
      toggleSearchEnabled: s.toggleSearchEnabled,
    })),
  );

  const { mcpConfigs, serverStatuses, enabledServerIds, toggleServerEnabled } = useMcpStore(
    useShallow((s) => ({
      mcpConfigs: s.mcpConfigs,
      serverStatuses: s.serverStatuses,
      enabledServerIds: s.enabledServerIds,
      toggleServerEnabled: s.toggleServerEnabled,
    })),
  );

  const handleToggleMcpServer = useCallback(
    (serverId: string) => {
      const isEnabled = enabledServerIds.has(serverId);
      toggleServerEnabled(serverId, !isEnabled);
    },
    [enabledServerIds, toggleServerEnabled],
  );

  const {
    sidebarOpen,
    sidebarCollapsed,
    isConfigLoaded,
    view,
    showRenameModal,
    renameCurrentTitle,
    loading,
    toasts,
    hasStarted,
    isDraggingFile,
    pendingToolConfirmations,
    activeArtifact,
    showUpdateModal,
    updateInfo,
    autoUpdateChecking,
  } = useUIStore(
    useShallow((s) => ({
      sidebarOpen: s.sidebarOpen,
      sidebarCollapsed: s.sidebarCollapsed,
      isConfigLoaded: s.isConfigLoaded,
      view: s.view,
      showRenameModal: s.showRenameModal,
      renameCurrentTitle: s.renameCurrentTitle,
      loading: s.loading,
      toasts: s.toasts,
      hasStarted: s.hasStarted,
      isDraggingFile: s.isDraggingFile,
      pendingToolConfirmations: s.pendingToolConfirmations,
      activeArtifact: s.activeArtifact,
      showUpdateModal: s.showUpdateModal,
      updateInfo: s.updateInfo,
      autoUpdateChecking: s.autoUpdateChecking,
    })),
  );
  const {
    setSidebarOpen,
    toggleSidebarCollapsed,
    setView,
    setActiveSection,
    openRenameModal,
    closeRenameModal,
    dismissToast,
    setHasStarted,
    respondToToolConfirmation,
    setActiveArtifact,
    setShowUpdateModal,
    checkForUpdates,
    toggleCommandPalette,
  } = useUIStore(
    useShallow((s) => ({
      setSidebarOpen: s.setSidebarOpen,
      toggleSidebarCollapsed: s.toggleSidebarCollapsed,
      setView: s.setView,
      setActiveSection: s.setActiveSection,
      openRenameModal: s.openRenameModal,
      closeRenameModal: s.closeRenameModal,
      dismissToast: s.dismissToast,
      setHasStarted: s.setHasStarted,
      respondToToolConfirmation: s.respondToToolConfirmation,
      setActiveArtifact: s.setActiveArtifact,
      setShowUpdateModal: s.setShowUpdateModal,
      checkForUpdates: s.checkForUpdates,
      toggleCommandPalette: s.toggleCommandPalette,
    })),
  );

  const { activeProjectId, setActiveProject } = useProjectStore(
    useShallow((s) => ({
      activeProjectId: s.activeProjectId,
      setActiveProject: s.setActiveProject,
    })),
  );
  const [allowArtifactNetwork, setAllowArtifactNetwork] = useState(false);

  useEffect(() => {
    if (!activeArtifact) {
      requestAnimationFrame(() => {
        setAllowArtifactNetwork(false);
      });
    }
  }, [activeArtifact]);

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );
  const parentConversation = useMemo(() => {
    if (activeConversation?.isSubagent && activeConversation.parentId) {
      return conversations.find((c) => c.id === activeConversation.parentId) ?? null;
    }
    return null;
  }, [conversations, activeConversation]);
  const messages = activeConversation?.messages ?? [];
  const primaryGeneration = activeId ? generationByConversation[activeId] : null;

  const [showAddCompareDropdown, setShowAddCompareDropdown] = useState(false);
  const addCompareDropdownRef = useRef<HTMLDivElement>(null);
  const disableBgActivity = useUIStore((s) => s.disableBgActivity);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (addCompareDropdownRef.current && !addCompareDropdownRef.current.contains(e.target as Node)) {
        setShowAddCompareDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const [syncScrolls, setSyncScrolls] = useState(true);
  const [isArtifactFullScreen, setIsArtifactFullScreen] = useState(false);

  const compareConversations = useMemo(
    () => compareIds.map((id) => conversations.find((c) => c.id === id)).filter(Boolean) as Conversation[],
    [conversations, compareIds],
  );

  const handleAddCompareModel = useCallback(
    (modelId: string) => {
      if (!activeId) return;
      const activeConv = conversations.find((c) => c.id === activeId);
      const newId = "compare-" + Date.now();
      const clonedMessages = activeConv ? activeConv.messages.map((m) => ({ ...m })) : [];

      const newConv = {
        id: newId,
        title: (activeConv?.title ?? "Comparison") + " (Compare)",
        timestamp: new Date(),
        messages: clonedMessages,
        model: modelId,
        projectId: activeConv?.projectId || undefined,
      };

      useChatStore.setState({
        conversations: [newConv, ...conversations],
        compareIds: [...compareIds, newId],
      });
    },
    [activeId, conversations, compareIds],
  );

  const handleToggleTemporaryChat = useCallback(() => {
    if (activeConversation?.isTemporary) {
      deleteChat(activeConversation.id);
    } else {
      newTemporaryChat();
    }
  }, [activeConversation, deleteChat, newTemporaryChat]);

  const handleToggleCompareMode = useCallback(() => {
    const nextCompareMode = !isCompareMode;
    setIsCompareMode(nextCompareMode);

    if (nextCompareMode) {
      let currentActiveId = activeId;
      let currentConvs = conversations;

      if (!currentActiveId) {
        currentActiveId = newChat();
        currentConvs = useChatStore.getState().conversations;
      }

      if (currentActiveId && compareIds.length === 0) {
        const activeConv = currentConvs.find((c) => c.id === currentActiveId);
        const secondaryModel =
          models.find((m) => m.id !== activeConv?.model && m.enabled !== false)?.id || selectedModel;

        const newId = "compare-" + Date.now();
        const clonedMessages = activeConv ? activeConv.messages.map((m) => ({ ...m })) : [];

        const newConv = {
          id: newId,
          title: (activeConv?.title ?? "New chat") + " (Compare)",
          timestamp: new Date(),
          messages: clonedMessages,
          model: secondaryModel,
          projectId: activeConv?.projectId || undefined,
        };

        useChatStore.setState({
          conversations: [newConv, ...useChatStore.getState().conversations],
          compareIds: [newId],
        });
      }
    } else {
      if (compareIds.length > 0) {
        compareIds.forEach((cId) => {
          const conv = conversations.find((c) => c.id === cId);
          if (conv?.pendingWorktree && conv.projectId) {
            const projectId = conv.projectId;
            const worktreePath = conv.pendingWorktree.path;
            const branchName = conv.pendingWorktree.branch;
            import("@tauri-apps/api/core").then(({ invoke }) => {
              invoke("git_worktree_discard", {
                projectId,
                worktreePath,
                branchName,
              }).catch((err) => console.error("Failed to discard worktree on compare disable:", err));
            });
          }
        });
        useChatStore.setState({
          conversations: conversations.filter((c) => !compareIds.includes(c.id)),
          compareIds: [],
        });
      }
    }
  }, [isCompareMode, activeId, compareIds, conversations, models, selectedModel, setIsCompareMode, newChat]);

  const {
    virtuosoRef: primaryVirtuosoRef,
    isAtBottom: primaryIsAtBottom,
    setIsAtBottom: primarySetIsAtBottom,
    scrollToBottom: primaryScrollToBottom,
  } = useScrollButton();

  const compareRefsMap = useRef<Record<string, any>>({});

  const activeScrollSourceRef = useRef<string | null>(null);
  const scrollTimeoutRef = useRef<any>(null);

  const handleScrollSync = useCallback(
    (cId: string, scrollTop: number, ratio: number) => {
      if (!syncScrolls) return;
      if (isStreaming) return; // Prevent scroll fighting/oscillations during streaming
      if (activeScrollSourceRef.current && activeScrollSourceRef.current !== cId) return;

      activeScrollSourceRef.current = cId;

      if (activeId !== cId && primaryVirtuosoRef.current) {
        const scroller = (primaryVirtuosoRef.current as any).getScroller?.();
        if (scroller) {
          const targetTop = ratio * (scroller.scrollHeight - scroller.clientHeight);
          primaryVirtuosoRef.current.scrollTo({ top: targetTop });
        } else {
          primaryVirtuosoRef.current.scrollTo({ top: scrollTop });
        }
      }

      compareIds.forEach((id) => {
        if (id !== cId) {
          const compRef = compareRefsMap.current[id];
          if (compRef) {
            const scroller = compRef.getScroller?.();
            if (scroller) {
              const targetTop = ratio * (scroller.scrollHeight - scroller.clientHeight);
              compRef.scrollTo({ top: targetTop });
            } else {
              compRef.scrollTo({ top: scrollTop });
            }
          }
        }
      });

      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = setTimeout(() => {
        activeScrollSourceRef.current = null;
      }, 120);
    },
    [syncScrolls, activeId, compareIds, primaryVirtuosoRef, isStreaming],
  );

  // Synchronize active project when active conversation changes
  useEffect(() => {
    if (activeConversation) {
      if (activeConversation.projectId !== activeProjectId) {
        setActiveProject(activeConversation.projectId || null);
      }
      const projectStore = useProjectStore.getState();
      if (activeConversation.pendingWorktree) {
        if (
          projectStore.activeWorktreePath !== activeConversation.pendingWorktree.path ||
          projectStore.activeWorktreeBranch !== activeConversation.pendingWorktree.branch
        ) {
          projectStore.setWorktree(activeConversation.pendingWorktree.path, activeConversation.pendingWorktree.branch);
        }
      } else {
        if (projectStore.activeWorktreePath !== null || projectStore.activeWorktreeBranch !== null) {
          projectStore.setWorktree(null, null);
        }
      }
    } else {
      const projectStore = useProjectStore.getState();
      if (projectStore.activeWorktreePath !== null || projectStore.activeWorktreeBranch !== null) {
        projectStore.setWorktree(null, null);
      }
    }
  }, [activeConversation, activeProjectId, setActiveProject]);

  const primaryTracking = useScrollTracking(activeId, messages.length, primaryIsAtBottom, isStreaming);

  const showScrollToBottom = !primaryIsAtBottom;
  const hasNewMessages = primaryTracking.hasNewMessages;

  const handleScrollToBottom = useCallback(() => {
    primaryScrollToBottom();
    primaryTracking.setHasNewMessages(false);

    if (isCompareMode) {
      compareIds.forEach((id) => {
        const compRef = compareRefsMap.current[id];
        if (compRef?.current) {
          compRef.current.scrollTo({ top: Number.MAX_SAFE_INTEGER });
        }
      });
    }
  }, [primaryScrollToBottom, primaryTracking, isCompareMode, compareIds]);

  // Scroll to bottom instantly when switching conversations or going to the chat view
  useEffect(() => {
    if (view === "chat" && activeId) {
      const scroll = () => {
        primaryScrollToBottom("auto");
        if (isCompareMode) {
          compareIds.forEach((id) => {
            const compRef = compareRefsMap.current[id];
            if (compRef?.current) {
              compRef.current.scrollTo({ top: Number.MAX_SAFE_INTEGER });
            }
          });
        }
      };

      scroll();

      const raf = requestAnimationFrame(() => {
        scroll();
      });

      const timer = setTimeout(() => {
        scroll();
      }, 60);

      return () => {
        cancelAnimationFrame(raf);
        clearTimeout(timer);
      };
    }
  }, [activeId, view, isCompareMode, primaryScrollToBottom, compareIds]);

  useEffect(() => {
    init();
    useUIStore.getState().initDownloadedThemes();
    useKeybindStore.getState().initKeybinds();
    useUIStore.getState().initSkipExternalLinkWarning();
  }, [init]);

  useEffect(() => {
    if (isConfigLoaded && autoUpdateChecking) {
      checkForUpdates(true);
    }
  }, [isConfigLoaded, autoUpdateChecking, checkForUpdates]);

  useEffect(() => {
    let active = true;
    const currentListenerId = Math.random().toString();
    activeListenerIdRef.current = currentListenerId;

    let unlistenDragEnter: (() => void) | undefined;
    let unlistenDragOver: (() => void) | undefined;
    let unlistenDragLeave: (() => void) | undefined;
    let unlistenDragDrop: (() => void) | undefined;

    async function setupListeners() {
      const { listen } = await import("@tauri-apps/api/event");

      const enter = await listen("tauri://drag-enter", () => {
        if (activeListenerIdRef.current !== currentListenerId) return;
        const uiState = useUIStore.getState();
        if (uiState.view === "chat") {
          uiState.setIsDraggingFile(true);
        }
      });
      if (!active) {
        enter();
        return;
      }
      unlistenDragEnter = enter;

      const over = await listen("tauri://drag-over", () => {
        if (activeListenerIdRef.current !== currentListenerId) return;
        const uiState = useUIStore.getState();
        if (uiState.view === "chat" && !uiState.isDraggingFile) {
          uiState.setIsDraggingFile(true);
        }
      });
      if (!active) {
        over();
        return;
      }
      unlistenDragOver = over;

      const leave = await listen("tauri://drag-leave", () => {
        if (activeListenerIdRef.current !== currentListenerId) return;
        useUIStore.getState().setIsDraggingFile(false);
      });
      if (!active) {
        leave();
        return;
      }
      unlistenDragLeave = leave;

      const drop = await listen<{ token: string; name: string; size: number }[]>(
        "sythoria://drag-drop-tokens",
        async (event) => {
          if (activeListenerIdRef.current !== currentListenerId) return;
          useUIStore.getState().setIsDraggingFile(false);
          const uiState = useUIStore.getState();
          if (uiState.view !== "chat") return;

          const payload = event.payload;
          if (payload && payload.length > 0) {
            const chatStore = useChatStore.getState();
            for (const item of payload) {
              await chatStore.addDraftFileFromToken(item.token, item.name, item.size);
            }
          }
        },
      );
      if (!active) {
        drop();
        return;
      }
      unlistenDragDrop = drop;
    }

    setupListeners();

    return () => {
      active = false;
      if (unlistenDragEnter) unlistenDragEnter();
      if (unlistenDragOver) unlistenDragOver();
      if (unlistenDragLeave) unlistenDragLeave();
      if (unlistenDragDrop) unlistenDragDrop();
    };
  }, []);

  // Spotlight: listen for show event from backend global shortcut
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen("sythoria://spotlight-shown", () => {
        const uiState = useUIStore.getState();
        uiState.setShowSpotlight(true);
      });
    })();

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && isStreaming) {
        stopStreaming();
        return;
      }

      const recording = useKeybindStore.getState().isRecording;
      if (recording) return;

      const active = document.activeElement;
      let isInputActive = false;
      if (active) {
        const tag = active.tagName.toLowerCase();
        isInputActive = tag === "input" || tag === "textarea" || active.hasAttribute("contenteditable");
      }

      const keys = useKeybindStore.getState().keybinds;

      if (matchKeybind(e, keys.zoomIn.currentCombo)) {
        e.preventDefault();
        useKeybindStore.getState().zoomIn();
      } else if (matchKeybind(e, keys.zoomOut.currentCombo)) {
        e.preventDefault();
        useKeybindStore.getState().zoomOut();
      } else if (matchKeybind(e, keys.zoomReset.currentCombo)) {
        e.preventDefault();
        useKeybindStore.getState().zoomReset();
      } else if (matchKeybind(e, keys.toggleSidebar.currentCombo)) {
        e.preventDefault();
        toggleSidebarCollapsed();
      } else if (matchKeybind(e, keys.focusInput.currentCombo)) {
        e.preventDefault();
        document.getElementById("chat-input")?.focus();
      } else if (matchKeybind(e, keys.openSearch.currentCombo)) {
        e.preventDefault();
        if (sidebarCollapsed) toggleSidebarCollapsed();
        setView("chat");
        setTimeout(() => {
          document.getElementById("sidebar-search")?.focus();
        }, 50);
      } else if (matchKeybind(e, keys.newChat.currentCombo)) {
        e.preventDefault();
        newChat();
        setView("chat");
        setTimeout(() => {
          document.getElementById("chat-input")?.focus();
        }, 50);
      } else if (matchKeybind(e, keys.captureAppshot.currentCombo)) {
        e.preventDefault();
        useAppshotStore.getState().captureAndAttachToChat();
      } else if (matchKeybind(e, keys.goBack.currentCombo)) {
        if (useChatStore.getState().navigationIndex > 0) {
          e.preventDefault();
          navigateBack();
        }
      } else if (matchKeybind(e, keys.goForward.currentCombo)) {
        const chatState = useChatStore.getState();
        if (
          chatState.navigationIndex < chatState.navigationHistory.length - 1 &&
          chatState.navigationHistory.length > 0
        ) {
          e.preventDefault();
          navigateForward();
        }
      } else if (matchKeybind(e, keys.openFilePicker.currentCombo)) {
        e.preventDefault();
        document.getElementById("file-input-element")?.click();
      } else if (matchKeybind(e, keys.prevChat.currentCombo)) {
        if (isInputActive) {
          if (!(e.ctrlKey || e.metaKey || e.altKey)) return;
        }
        const currentConversations = useChatStore.getState().conversations;
        const currentActiveId = useChatStore.getState().activeId;
        const idx = currentConversations.findIndex((c) => c.id === currentActiveId);
        if (idx > 0) {
          e.preventDefault();
          setActiveId(currentConversations[idx - 1].id);
        }
      } else if (matchKeybind(e, keys.nextChat.currentCombo)) {
        if (isInputActive) {
          if (!(e.ctrlKey || e.metaKey || e.altKey)) return;
        }
        const currentConversations = useChatStore.getState().conversations;
        const currentActiveId = useChatStore.getState().activeId;
        const idx = currentConversations.findIndex((c) => c.id === currentActiveId);
        if (idx >= 0 && idx < currentConversations.length - 1) {
          e.preventDefault();
          setActiveId(currentConversations[idx + 1].id);
        }
      } else if (matchKeybind(e, keys.openSettings.currentCombo)) {
        e.preventDefault();
        setView("settings");
      } else if (matchKeybind(e, keys.toggleModel.currentCombo)) {
        e.preventDefault();
        document.getElementById("model-selector-button")?.click();
      } else if (matchKeybind(e, keys.commandPalette.currentCombo)) {
        e.preventDefault();
        toggleCommandPalette();
      } else if (matchKeybind(e, keys.renameChat.currentCombo)) {
        e.preventDefault();
        if (activeId) {
          const title = useChatStore.getState().conversations.find((c) => c.id === activeId)?.title || "";
          openRenameModal(activeId, title);
        }
      } else if (matchKeybind(e, keys.exportChat.currentCombo)) {
        e.preventDefault();
        if (activeId) {
          exportChat(activeId);
        }
      } else if (matchKeybind(e, keys.togglePinChat.currentCombo)) {
        e.preventDefault();
        if (activeId) {
          togglePinChat(activeId);
        }
      } else if (matchKeybind(e, keys.openWorkspaces.currentCombo)) {
        e.preventDefault();
        setView("settings");
        setActiveSection("projects");
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    isStreaming,
    stopStreaming,
    toggleSidebarCollapsed,
    sidebarCollapsed,
    setView,
    newChat,
    navigateBack,
    navigateForward,
    setActiveId,
    toggleCommandPalette,
    openRenameModal,
    exportChat,
    togglePinChat,
    setActiveSection,
    activeId,
  ]);

  useEffect(() => {
    return () => {
      useChatStore.getState().cleanup();
    };
  }, []);

  const handleNewChat = useCallback(() => {
    return newChat();
  }, [newChat]);

  useEffect(() => {
    const unlistens: (() => void)[] = [];
    async function setupMenuListeners() {
      const { listen } = await import("@tauri-apps/api/event");
      const { uiToast } = await import("./store/helpers");

      const un1 = await listen("menu-new-conversation", () => {
        handleNewChat();
      });
      const un2 = await listen("menu-create-project", () => {
        setView("settings");
        setActiveSection("projects");
      });
      const un3 = await listen("menu-command-palette", () => {
        toggleCommandPalette();
      });
      const un4 = await listen("menu-check-updates", () => {
        uiToast("You are on the latest version", "success");
      });
      const un5 = await listen("menu-zoom-in", () => {
        useKeybindStore.getState().zoomIn();
      });
      const un6 = await listen("menu-zoom-out", () => {
        useKeybindStore.getState().zoomOut();
      });
      const un7 = await listen("menu-zoom-reset", () => {
        useKeybindStore.getState().zoomReset();
      });

      unlistens.push(un1, un2, un3, un4, un5, un6, un7);
    }
    setupMenuListeners();

    return () => {
      unlistens.forEach((fn) => fn());
    };
  }, [handleNewChat, setView, setActiveSection, toggleCommandPalette]);

  const handleDeleteChat = useCallback(
    (id: string) => {
      deleteChat(id);
    },
    [deleteChat],
  );

  const handleSelectConversation = useCallback(
    (id: string) => {
      setActiveId(id);
      setView("chat");
      setSidebarOpen(false);
    },
    [setActiveId, setView, setSidebarOpen],
  );

  const handleSettingsClick = useCallback(() => {
    setView("settings");
    setSidebarOpen(false);
  }, [setView, setSidebarOpen]);

  const handleRetry = useCallback(() => {
    if (activeId) retryLastMessage(activeId);
  }, [activeId, retryLastMessage]);

  const renderArtifactContent = () => {
    if (!activeArtifact) return null;
    return (
      <div className="flex flex-1 flex-col overflow-hidden h-full">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-4">
            <h3 className="text-sm font-semibold text-text-primary">{activeArtifact.title}</h3>
            {(activeArtifact.type === "html" || activeArtifact.type === "svg") && (
              <div className="flex items-center gap-2 border-l border-border pl-4">
                <input
                  id="allow-network-toggle"
                  type="checkbox"
                  checked={allowArtifactNetwork}
                  onChange={(e) => setAllowArtifactNetwork(e.target.checked)}
                  className="w-3.5 h-3.5 accent-accent cursor-pointer rounded border-border"
                />
                <label
                  htmlFor="allow-network-toggle"
                  className="text-xs text-text-muted font-medium cursor-pointer select-none hover:text-text-secondary transition-colors"
                >
                  Allow Network Access
                </label>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsArtifactFullScreen(!isArtifactFullScreen)}
              className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-hover hover:text-text-primary"
              aria-label={isArtifactFullScreen ? "Show side panel" : "Show full screen"}
              title={isArtifactFullScreen ? "Side Panel" : "Full Screen"}
            >
              {isArtifactFullScreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
            <button
              onClick={() => {
                setActiveArtifact(null);
                setIsArtifactFullScreen(false);
              }}
              className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-hover hover:text-text-primary"
              aria-label="Close artifact preview"
              title="Close"
            >
              <X size={16} />
            </button>
          </div>
        </div>
        {activeArtifact.type === "html" || activeArtifact.type === "svg" ? (
          <iframe
            title={activeArtifact.title}
            sandbox="allow-scripts"
            srcDoc={getSafeSrcDoc(activeArtifact.content, allowArtifactNetwork)}
            className="min-h-0 flex-1 bg-white"
          />
        ) : (
          <pre className="min-h-0 flex-1 overflow-auto bg-chat p-4 font-mono text-xs text-text-primary">
            {activeArtifact.content}
          </pre>
        )}
      </div>
    );
  };

  const handlePrimaryModelChange = useCallback(
    (newModelId: string) => {
      setSelectedModel(newModelId);
      if (activeId) {
        useChatStore.setState((state) => ({
          conversations: state.conversations.map((c) => (c.id === activeId ? { ...c, model: newModelId } : c)),
        }));
      }
    },
    [activeId, setSelectedModel],
  );

  const handleCompareModelChange = useCallback((cId: string, newModelId: string) => {
    useChatStore.setState((state) => ({
      conversations: state.conversations.map((conv) => (conv.id === cId ? { ...conv, model: newModelId } : conv)),
    }));
  }, []);

  const handleCompareClose = useCallback(
    (cId: string) => {
      deleteChat(cId);
    },
    [deleteChat],
  );

  const handleCompareRetry = useCallback(
    (cId: string) => {
      retryLastMessage(cId);
    },
    [retryLastMessage],
  );

  const handlePrimaryScroll = useCallback(
    (top: number, ratio: number) => {
      if (activeId) handleScrollSync(activeId, top, ratio);
    },
    [activeId, handleScrollSync],
  );

  const handleCompareScroll = useCallback(
    (cId: string, top: number, ratio: number) => {
      handleScrollSync(cId, top, ratio);
    },
    [handleScrollSync],
  );

  if (!isConfigLoaded || loading.init) {
    return (
      <div
        className="flex h-screen w-screen items-center justify-center bg-chat"
        role="status"
        aria-label="Loading application"
      >
        <div className="flex flex-col items-center gap-3">
          <Spinner size="lg" />
          <p className="text-sm text-text-muted">Loading Sythoria...</p>
        </div>
      </div>
    );
  }

  if (!hasStarted) {
    return <StartScreen onStart={() => setHasStarted(true)} />;
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden flex-col bg-surface">
      <TitleBar />
      <CommandPalette />
      <SpotlightArea />
      <div className="flex flex-1 overflow-hidden relative glass-app-container">
        <AnimatePresence>{isDraggingFile && <DragOverlay />}</AnimatePresence>
        {!(view === "settings" && (isMobile ? sidebarOpen : !sidebarCollapsed)) && (
          <div
            className={`absolute top-0 left-0 z-50 flex items-center ${isMac ? "h-14 pl-[90px]" : "h-[32px] pl-4"}`}
            data-tauri-drag-region
          >
            <div className="flex items-center gap-1 h-full">
              <button
                onClick={toggleSidebarCollapsed}
                className="hidden md:flex p-1.5 rounded-md text-text-muted hover:text-text-secondary hover:bg-hover transition-colors items-center justify-center"
                aria-label={sidebarCollapsed ? t("tooltip.expandSidebar") : t("tooltip.collapseSidebar")}
                title={sidebarCollapsed ? t("tooltip.expandSidebar") : t("tooltip.collapseSidebar")}
              >
                <PanelLeft size={16} />
              </button>

              {!sidebarOpen && (
                <button
                  onClick={() => setSidebarOpen(true)}
                  className="flex md:hidden p-1.5 rounded-md text-text-muted hover:text-text-secondary hover:bg-hover transition-colors items-center justify-center"
                  aria-label={t("tooltip.openSidebar") || "Open sidebar"}
                  title={t("tooltip.openSidebar") || "Open sidebar"}
                >
                  <Menu size={16} />
                </button>
              )}

              {/* History navigation arrows */}
              <div className="hidden md:flex items-center gap-0.5 mx-1">
                <button
                  onClick={navigateBack}
                  disabled={!(navigationIndex > 0)}
                  className={`p-1 rounded-md transition-colors ${
                    navigationIndex > 0
                      ? "text-text-secondary hover:bg-hover cursor-pointer"
                      : "text-text-muted/30 cursor-not-allowed"
                  }`}
                  aria-label={t("tooltip.navigateBack") || "Navigate back"}
                  title={t("common.back") || "Back"}
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  onClick={navigateForward}
                  disabled={!(navigationIndex < navigationHistory.length - 1 && navigationHistory.length > 0)}
                  className={`p-1 rounded-md transition-colors ${
                    navigationIndex < navigationHistory.length - 1 && navigationHistory.length > 0
                      ? "text-text-secondary hover:bg-hover cursor-pointer"
                      : "text-text-muted/30 cursor-not-allowed"
                  }`}
                  aria-label={t("tooltip.navigateForward") || "Navigate forward"}
                  title={t("tooltip.navigateForward") || "Forward"}
                >
                  <ChevronRight size={16} />
                </button>
              </div>

              <AnimatePresence>
                {sidebarCollapsed && (
                  <motion.button
                    key="new-chat-btn"
                    initial={{ opacity: 0, scale: 0.8, x: -10 }}
                    animate={{ opacity: 1, scale: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.8, x: -10 }}
                    transition={{ duration: motionTokens.duration.fast }}
                    onClick={handleNewChat}
                    className="hidden md:flex p-1.5 rounded-md text-text-muted hover:text-text-secondary hover:bg-hover transition-colors items-center justify-center"
                    aria-label={t("common.newChat") || "Start new chat"}
                    title={t("common.newChat") || "New Chat"}
                  >
                    <MessageSquarePlus size={16} />
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}

        <Sidebar
          conversations={conversations}
          activeId={activeId}
          onSelect={handleSelectConversation}
          onNewChat={handleNewChat}
          onSettingsClick={handleSettingsClick}
          onDeleteChat={handleDeleteChat}
          onRenameChat={openRenameModal}
          onExportChat={exportChat}
          onPinChat={togglePinChat}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          modelStatuses={modelStatuses}
          isCollapsed={sidebarCollapsed}
        />

        <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative bg-chat">
          <AnimatePresence mode="wait">
            {view === "settings" ? (
              <motion.div
                key="settings"
                className="flex-1 flex flex-col min-w-0 overflow-hidden"
                initial={{ opacity: 0, y: 6, scale: 0.99 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.99 }}
                transition={{ type: "tween", ease: motionTokens.easing.smooth, duration: motionTokens.duration.fast }}
              >
                <Settings />
              </motion.div>
            ) : (
              <motion.main
                key="chat"
                className="flex-1 flex flex-col min-w-0 min-h-0 relative"
                aria-label="Chat area"
                initial={{ opacity: 0, y: -6, scale: 0.99 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.99 }}
                transition={{ type: "tween", ease: motionTokens.easing.smooth, duration: motionTokens.duration.fast }}
              >
                <header
                  className="shrink-0 flex items-center justify-between px-4 py-4 md:px-6 bg-chat/80 backdrop-blur-md relative z-20 pt-6"
                  data-tauri-drag-region
                >
                  <div className="flex items-center gap-2 pl-12 md:pl-28 z-20">
                    {activeConversation?.isSubagent && activeConversation.parentId && (
                      <button
                        onClick={() => setActiveId(activeConversation.parentId!)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-accent-soft/50 hover:bg-accent-soft/80 text-text-primary text-xs transition-colors font-medium border border-border/30 cursor-pointer shadow-sm"
                        title={`Return to: ${parentConversation?.title || "Parent Chat"}`}
                      >
                        <ArrowLeft size={14} className="text-accent" />
                        <span>Parent Chat</span>
                      </button>
                    )}
                  </div>
                  <div className="absolute left-1/2 -translate-x-1/2">
                    <motion.h2
                      className="text-sm font-medium text-text-secondary"
                      key={activeConversation?.id ?? "empty"}
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={springs.gentle}
                    >
                      {activeConversation
                        ? activeConversation.title === "Untitled" || !activeConversation.title
                          ? t("common.untitled")
                          : activeConversation.title.endsWith(" (Compare)")
                            ? `${activeConversation.title.slice(0, -10)} (${t("common.compare")})`
                            : activeConversation.title
                        : t("common.newChat")}
                    </motion.h2>
                  </div>
                  <div className="flex items-center gap-2 ml-auto relative">
                    {isCompareMode && (
                      <>
                        <button
                          onClick={() => setSyncScrolls(!syncScrolls)}
                          className={`p-1.5 rounded-md transition-colors ${
                            syncScrolls
                              ? "text-accent bg-accent/10 hover:bg-accent/15"
                              : "text-text-muted hover:text-text-secondary hover:bg-hover"
                          }`}
                          aria-label={syncScrolls ? t("tooltip.disableSyncScrolls") : t("tooltip.syncScrolls")}
                          title={syncScrolls ? t("tooltip.disableSyncScrolls") : t("tooltip.syncScrolls")}
                        >
                          <Link size={16} />
                        </button>
                        <div ref={addCompareDropdownRef} className="relative">
                          <button
                            onClick={() => setShowAddCompareDropdown(!showAddCompareDropdown)}
                            className={`p-1.5 rounded-md transition-colors flex items-center justify-center ${
                              showAddCompareDropdown
                                ? "text-text-primary bg-hover"
                                : "text-text-muted hover:text-text-secondary hover:bg-hover"
                            }`}
                            aria-label={t("tooltip.addCompareModel") || "Add model to compare"}
                            title={t("tooltip.addCompareModel") || "Add model to compare"}
                          >
                            <Plus size={16} />
                          </button>
                          <AnimatePresence>
                            {showAddCompareDropdown && (
                              <motion.div
                                className="absolute right-0 mt-1.5 w-64 bg-surface border border-border rounded-xl p-1 z-50 max-h-72 overflow-y-auto overflow-x-hidden"
                                style={{ boxShadow: "var(--shadow-xl)" }}
                                role="listbox"
                                aria-label="Available models to compare"
                                initial={{ opacity: 0, y: 8, scale: motionTokens.scale.subtle }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: 8, scale: motionTokens.scale.subtle }}
                                transition={springs.gentle}
                              >
                                {models
                                  .filter(
                                    (m) =>
                                      m.enabled !== false &&
                                      m.id !== (activeConversation?.model || selectedModel) &&
                                      !compareConversations.some((c) => c.model === m.id),
                                  )
                                  .map((model) => {
                                    const status = modelStatuses[model.id] ?? "disconnected";
                                    return (
                                      <button
                                        key={model.id}
                                        onClick={() => {
                                          handleAddCompareModel(model.id);
                                          setShowAddCompareDropdown(false);
                                        }}
                                        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-colors text-left text-text-secondary hover:bg-hover hover:text-text-primary"
                                      >
                                        {!disableBgActivity && (
                                          <div
                                            className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_COLORS[status]}`}
                                            title={t(STATUS_KEYS[status]) || STATUS_LABELS[status] || status}
                                            aria-label={t(STATUS_KEYS[status]) || STATUS_LABELS[status] || status}
                                          />
                                        )}
                                        <span className="truncate flex-1">{model.name}</span>
                                      </button>
                                    );
                                  })}
                                {models.filter(
                                  (m) =>
                                    m.enabled !== false &&
                                    m.id !== (activeConversation?.model || selectedModel) &&
                                    !compareConversations.some((c) => c.model === m.id),
                                ).length === 0 && (
                                  <div className="px-3 py-4 text-center text-xs text-text-muted italic">
                                    No other models enabled
                                  </div>
                                )}
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      </>
                    )}
                    <button
                      onClick={handleToggleTemporaryChat}
                      className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                        activeConversation?.isTemporary
                          ? "text-accent bg-accent/10 hover:bg-accent/15"
                          : "text-text-muted hover:text-text-secondary hover:bg-hover"
                      }`}
                      aria-label={activeConversation?.isTemporary ? "Disable temporary chat" : "Enable temporary chat"}
                      title={activeConversation?.isTemporary ? "Disable temporary chat" : "Enable temporary chat"}
                    >
                      <Ghost size={16} className={activeConversation?.isTemporary ? "animate-pulse" : ""} />
                    </button>
                    <button
                      onClick={handleToggleCompareMode}
                      className={`p-1.5 rounded-md transition-colors ${
                        isCompareMode
                          ? "text-accent bg-accent/10 hover:bg-accent/15"
                          : "text-text-muted hover:text-text-secondary hover:bg-hover"
                      }`}
                      aria-label={isCompareMode ? t("tooltip.disableCompare") : t("tooltip.enableCompare")}
                      title={isCompareMode ? t("tooltip.disableCompare") : t("tooltip.enableCompare")}
                    >
                      <Split size={16} />
                    </button>
                  </div>
                </header>

                <div className="flex-1 min-h-0 flex flex-row overflow-hidden relative">
                  {/* Left Column */}
                  <div className="flex-1 min-w-0 min-h-0 flex flex-col relative">
                    {isCompareMode && compareConversations.length > 0 ? (
                      <div className="comparison-grid-container">
                        {/* Primary Column */}
                        <ComparisonColumn
                          conversation={activeConversation!}
                          isPrimary={true}
                          models={models}
                          onModelChange={handlePrimaryModelChange}
                          generationState={primaryGeneration?.state ?? generationState}
                          onRetry={handleRetry}
                          isStreaming={isStreaming}
                          onScroll={syncScrolls ? handlePrimaryScroll : undefined}
                          ref={primaryVirtuosoRef}
                        />

                        {/* Comparison Columns */}
                        {compareConversations.map((c) => {
                          const compGen = generationByConversation[c.id];
                          return (
                            <ComparisonColumn
                              key={c.id}
                              conversation={c}
                              models={models}
                              onModelChange={(newModelId) => handleCompareModelChange(c.id, newModelId)}
                              onClose={() => handleCompareClose(c.id)}
                              generationState={compGen?.state ?? "idle"}
                              onRetry={() => handleCompareRetry(c.id)}
                              isStreaming={isStreaming}
                              onScroll={syncScrolls ? (top, ratio) => handleCompareScroll(c.id, top, ratio) : undefined}
                              ref={(el) => {
                                compareRefsMap.current[c.id] = el;
                              }}
                            />
                          );
                        })}
                      </div>
                    ) : (
                      <ChatArea
                        messages={messages}
                        setIsAtBottom={primarySetIsAtBottom}
                        virtuosoRef={primaryVirtuosoRef}
                        onRetry={handleRetry}
                        generationState={primaryGeneration?.state ?? generationState}
                        conversationId={activeId || undefined}
                        pendingWorktree={activeConversation?.pendingWorktree}
                      />
                    )}

                    <motion.div
                      className={`absolute left-1/2 -translate-x-1/2 bottom-[180px] md:bottom-[160px] z-30 ${showScrollToBottom && messages.length > 0 && !isStreaming ? "opacity-100 translate-y-0 scale-100 pointer-events-auto" : "opacity-0 translate-y-3 scale-90 pointer-events-none"}`}
                      transition={{ duration: motionTokens.duration.fast }}
                      initial={false}
                    >
                      <ScrollToBottomButton onClick={handleScrollToBottom} hasNewMessages={hasNewMessages} />
                    </motion.div>

                    <InputBar
                      models={models}
                      onSend={sendMessage}
                      selectedModel={selectedModel}
                      onModelChange={setSelectedModel}
                      disabled={isStreaming}
                      modelStatuses={modelStatuses}
                      isSearchEnabled={isSearchEnabled}
                      onToggleSearch={toggleSearchEnabled}
                      mcpServers={mcpConfigs}
                      mcpServerStatuses={serverStatuses}
                      enabledMcpServerIds={enabledServerIds}
                      onToggleMcpServer={handleToggleMcpServer}
                      isStreaming={isStreaming}
                      onStop={stopStreaming}
                      centered={messages.length === 0}
                    />
                  </div>

                  {/* Right Column: Split Screen Artifact Panel */}
                  <AnimatePresence>
                    {activeArtifact && !isArtifactFullScreen && (
                      <motion.div
                        key="artifact-preview-split"
                        className="w-[45%] border-l border-border bg-surface flex flex-col h-full min-h-0 min-w-[320px] relative z-20 shadow-lg"
                        initial={{ x: "100%", opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        exit={{ x: "100%", opacity: 0 }}
                        transition={springs.gentle}
                      >
                        {renderArtifactContent()}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.main>
            )}
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence>
        {showRenameModal && (
          <motion.div
            key="rename-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: motionTokens.duration.fast }}
          >
            <RenameChatModal
              isOpen={showRenameModal}
              currentTitle={renameCurrentTitle}
              onConfirm={confirmRename}
              onCancel={closeRenameModal}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <ProjectConfigModal />
      <ToolConfirmationModal
        confirmation={
          pendingToolConfirmations && pendingToolConfirmations.length > 0 ? pendingToolConfirmations[0] : null
        }
        onRespond={respondToToolConfirmation}
      />
      <UpdateModal
        isOpen={showUpdateModal}
        onClose={() => setShowUpdateModal(false)}
        currentVersion={updateInfo?.currentVersion || ""}
        latestVersion={updateInfo?.latestVersion || ""}
        releaseUrl={updateInfo?.releaseUrl || ""}
        releaseNotes={updateInfo?.releaseNotes}
      />
      <LinkWarningModal />
      <AnimatePresence>
        {activeArtifact && isArtifactFullScreen && (
          <motion.div
            key="artifact-preview-fullscreen"
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-transparent"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: motionTokens.duration.fast }}
          >
            <button
              className="absolute inset-0 cursor-default"
              style={{ backgroundColor: "var(--theme-overlay)" }}
              onClick={() => {
                setActiveArtifact(null);
                setIsArtifactFullScreen(false);
              }}
              aria-label="Close artifact preview"
            />
            <motion.div
              className="relative z-10 flex h-[min(760px,90vh)] w-[min(980px,92vw)] flex-col overflow-hidden rounded-xl border border-border bg-surface"
              style={{ boxShadow: "var(--shadow-xl)" }}
              initial={{ opacity: 0, scale: 0.98, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 8 }}
              transition={springs.gentle}
            >
              {renderArtifactContent()}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

export default App;
