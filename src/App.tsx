import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Menu, PanelLeft, MessageSquarePlus, ChevronLeft, ChevronRight } from "lucide-react";
import Sidebar from "./components/Sidebar";
import ChatArea from "./components/ChatArea";
import InputBar from "./components/InputBar";
import Settings from "./components/settings";
import ScrollToBottomButton from "./components/ScrollToBottomButton";
import { RenameChatModal } from "./components/ui/Modal";
import { Spinner } from "./components/ui/Spinner";
import { ToastContainer } from "./components/ui/Toast";
import StartScreen from "./components/StartScreen";
import { DragOverlay } from "./components/ui/DragOverlay";
import { useChatStore } from "./store/useChatStore";
import { useModelStore } from "./store/useModelStore";
import { useSearchStore } from "./store/useSearchStore";
import { useMcpStore } from "./store/useMcpStore";
import { useUIStore } from "./store/useUIStore";
import { useKeybindStore, matchKeybind } from "./store/useKeybindStore";
import { useAppshotStore } from "./store/useAppshotStore";
import { useShallow } from "zustand/react/shallow";
import { useScrollButton } from "./hooks/useScrollPosition";
import { useScrollTracking } from "./hooks/useScrollTracking";
import { springs, motionTokens } from "./lib/motion-tokens";

import "./index.css";

function App() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const { conversations, activeId, isStreaming, generationState, generationLabel, navigationHistory, navigationIndex } =
    useChatStore(
      useShallow((s) => ({
        conversations: s.conversations,
        activeId: s.activeId,
        isStreaming: s.isStreaming,
        generationState: s.generationState,
        generationLabel: s.generationLabel,
        navigationHistory: s.navigationHistory,
        navigationIndex: s.navigationIndex,
      })),
    );
  const {
    init,
    setActiveId,
    newChat,
    deleteChat,
    sendMessage,
    stopStreaming,
    retryLastMessage,
    exportChat,
    confirmRename,
    navigateBack,
    navigateForward,
  } = useChatStore(
    useShallow((s) => ({
      init: s.init,
      setActiveId: s.setActiveId,
      newChat: s.newChat,
      deleteChat: s.deleteChat,
      sendMessage: s.sendMessage,
      stopStreaming: s.stopStreaming,
      retryLastMessage: s.retryLastMessage,
      exportChat: s.exportChat,
      confirmRename: s.confirmRename,
      navigateBack: s.navigateBack,
      navigateForward: s.navigateForward,
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
    })),
  );
  const {
    setSidebarOpen,
    toggleSidebarCollapsed,
    setView,
    openRenameModal,
    closeRenameModal,
    dismissToast,
    setHasStarted,
  } = useUIStore(
    useShallow((s) => ({
      setSidebarOpen: s.setSidebarOpen,
      toggleSidebarCollapsed: s.toggleSidebarCollapsed,
      setView: s.setView,
      openRenameModal: s.openRenameModal,
      closeRenameModal: s.closeRenameModal,
      dismissToast: s.dismissToast,
      setHasStarted: s.setHasStarted,
    })),
  );

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );
  const messages = activeConversation?.messages ?? [];

  const { isAtBottom, setIsAtBottom, scrollToBottom, virtuosoRef } = useScrollButton();
  const { hasNewMessages, setHasNewMessages } = useScrollTracking(activeId, messages.length, isAtBottom, isStreaming);

  // Scroll to bottom instantly when switching conversations or going to the chat view
  useEffect(() => {
    if (view === "chat" && activeId) {
      const scroll = () => {
        scrollToBottom("auto");
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
  }, [activeId, view, scrollToBottom]);

  useEffect(() => {
    init();
    useUIStore.getState().initDownloadedThemes();
    useKeybindStore.getState().initKeybinds();
  }, [init]);

  useEffect(() => {
    let active = true;
    let unlistenDragEnter: (() => void) | undefined;
    let unlistenDragOver: (() => void) | undefined;
    let unlistenDragLeave: (() => void) | undefined;
    let unlistenDragDrop: (() => void) | undefined;

    async function setupListeners() {
      const { listen } = await import("@tauri-apps/api/event");

      const enter = await listen("tauri://drag-enter", () => {
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
        useUIStore.getState().setIsDraggingFile(false);
      });
      if (!active) {
        leave();
        return;
      }
      unlistenDragLeave = leave;

      const drop = await listen<{ paths: string[] }>("tauri://drag-drop", async (event) => {
        useUIStore.getState().setIsDraggingFile(false);
        const uiState = useUIStore.getState();
        if (uiState.view !== "chat") return;

        const { paths } = event.payload;
        if (paths && paths.length > 0) {
          const chatStore = useChatStore.getState();
          for (const path of paths) {
            await chatStore.addDraftFileFromPath(path);
          }
        }
      });
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
  ]);

  useEffect(() => {
    return () => {
      useChatStore.getState().cleanup();
    };
  }, []);

  const handleNewChat = useCallback(() => {
    return newChat();
  }, [newChat]);

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

  const handleScrollToBottom = useCallback(() => {
    scrollToBottom();
    setHasNewMessages(false);
  }, [scrollToBottom, setHasNewMessages]);

  const handleRetry = useCallback(() => {
    if (activeId) retryLastMessage(activeId);
  }, [activeId, retryLastMessage]);

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
    <div className="flex h-screen w-screen overflow-hidden bg-transparent">
      <div className="flex flex-1 overflow-hidden rounded-[18px] border-[12px] border-white/5 relative glass-app-container">
        <AnimatePresence>{isDraggingFile && <DragOverlay />}</AnimatePresence>
        {!(view === "settings" && (isMobile ? sidebarOpen : !sidebarCollapsed)) && (
          <div className="absolute top-0 left-0 z-50 flex items-center h-[32px] pl-[80px]" data-tauri-drag-region>
            <div className="flex items-center gap-1 h-full">
              <button
                onClick={toggleSidebarCollapsed}
                className="hidden md:flex p-1.5 rounded-md text-text-muted hover:text-text-secondary hover:bg-hover transition-colors items-center justify-center"
                aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                <PanelLeft size={16} />
              </button>

              {!sidebarOpen && (
                <button
                  onClick={() => setSidebarOpen(true)}
                  className="flex md:hidden p-1.5 rounded-md text-text-muted hover:text-text-secondary hover:bg-hover transition-colors items-center justify-center"
                  aria-label="Open sidebar"
                  title="Open sidebar"
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
                  aria-label="Navigate back"
                  title="Back"
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
                  aria-label="Navigate forward"
                  title="Forward"
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
                    aria-label="Start new chat"
                    title="New Chat"
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
                  className="shrink-0 flex items-center justify-between px-4 py-4 md:px-6 bg-chat/80 backdrop-blur-md relative z-10 pt-6"
                  data-tauri-drag-region
                >
                  <div className="absolute left-1/2 -translate-x-1/2">
                    <motion.h2
                      className="text-sm font-medium text-text-secondary"
                      key={activeConversation?.id ?? "empty"}
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={springs.gentle}
                    >
                      {activeConversation?.title ?? "New chat"}
                    </motion.h2>
                  </div>
                  <div className="flex items-center gap-2"></div>
                </header>

                <ChatArea
                  messages={messages}
                  setIsAtBottom={setIsAtBottom}
                  virtuosoRef={virtuosoRef}
                  onRetry={handleRetry}
                  generationState={generationState}
                  generationLabel={generationLabel}
                />

                <motion.div
                  className={`absolute left-1/2 -translate-x-1/2 bottom-[180px] md:bottom-[160px] z-30 ${!isAtBottom && messages.length > 0 && !isStreaming ? "opacity-100 translate-y-0 scale-100 pointer-events-auto" : "opacity-0 translate-y-3 scale-90 pointer-events-none"}`}
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

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

export default App;
