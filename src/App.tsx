import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Menu } from "lucide-react";
import Sidebar from "./components/Sidebar";
import ChatArea from "./components/ChatArea";
import InputBar from "./components/InputBar";
import Settings from "./components/Settings";
import StartScreen from "./components/StartScreen";
import ScrollToBottomButton from "./components/ScrollToBottomButton";
import { RenameChatModal } from "./components/ui/Modal";
import { Spinner } from "./components/ui/Spinner";
import { ToastContainer } from "./components/ui/Toast";
import { useChatStore } from "./store/useChatStore";
import { useModelStore } from "./store/useModelStore";
import { useSearchStore } from "./store/useSearchStore";
import { useMcpStore } from "./store/useMcpStore";
import { useUIStore } from "./store/useUIStore";
import { useShallow } from "zustand/react/shallow";
import { useScrollButton } from "./hooks/useScrollPosition";
import { springs, motionTokens } from "./lib/motion-tokens";

import "./index.css";

function App() {
  const { conversations, activeId, isStreaming, generationState, generationLabel } = useChatStore(
    useShallow((s) => ({
      conversations: s.conversations,
      activeId: s.activeId,
      isStreaming: s.isStreaming,
      generationState: s.generationState,
      generationLabel: s.generationLabel,
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
    hasStarted,
    isConfigLoaded,
    view,
    showRenameModal,
    renameCurrentTitle,
    loading,
    toasts,
  } = useUIStore(
    useShallow((s) => ({
      sidebarOpen: s.sidebarOpen,
      sidebarCollapsed: s.sidebarCollapsed,
      hasStarted: s.hasStarted,
      isConfigLoaded: s.isConfigLoaded,
      view: s.view,
      showRenameModal: s.showRenameModal,
      renameCurrentTitle: s.renameCurrentTitle,
      loading: s.loading,
      toasts: s.toasts,
    })),
  );
  const {
    setSidebarOpen,
    toggleSidebarCollapsed,
    setView,
    setHasStarted,
    openRenameModal,
    closeRenameModal,
    dismissToast,
  } = useUIStore(
    useShallow((s) => ({
      setSidebarOpen: s.setSidebarOpen,
      toggleSidebarCollapsed: s.toggleSidebarCollapsed,
      setView: s.setView,
      setHasStarted: s.setHasStarted,
      openRenameModal: s.openRenameModal,
      closeRenameModal: s.closeRenameModal,
      dismissToast: s.dismissToast,
    })),
  );

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );
  const messages = activeConversation?.messages ?? [];

  const { isAtBottom, setIsAtBottom, scrollToBottom, virtuosoRef } = useScrollButton();

  const [hasNewMessages, setHasNewMessages] = useState(false);
  const prevMessageCountRef = useRef(0);

  useEffect(() => {
    if (activeId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHasNewMessages(false);
    }
  }, [activeId]);

  useEffect(() => {
    if (messages.length > prevMessageCountRef.current && !isAtBottom && !isStreaming) {
      setHasNewMessages(true);
    }
    if (isAtBottom) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHasNewMessages(false);
    }
    prevMessageCountRef.current = messages.length;
  }, [messages.length, isAtBottom, isStreaming]);

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && isStreaming) {
        stopStreaming();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "b") {
        e.preventDefault();
        toggleSidebarCollapsed();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isStreaming, stopStreaming, toggleSidebarCollapsed]);

  useEffect(() => {
    return () => {
      useChatStore.getState().cleanup();
    };
  }, []);

  const handleStart = useCallback(() => {
    setHasStarted(true);
  }, [setHasStarted]);

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
  }, [scrollToBottom]);

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
    return <StartScreen onStart={handleStart} />;
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-chat">
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
        onToggleCollapse={toggleSidebarCollapsed}
      />

      <AnimatePresence mode="wait">
        {view === "settings" ? (
          <motion.div
            key="settings"
            className="flex-1 flex flex-col min-w-0 overflow-hidden"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={springs.gentle}
          >
            <Settings />
          </motion.div>
        ) : (
          <motion.main
            key="chat"
            className="flex-1 flex flex-col min-w-0 relative bg-chat"
            aria-label="Chat area"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={springs.gentle}
          >
            <header className="shrink-0 flex items-center justify-between px-4 py-3 md:px-6 border-b border-border/50 bg-chat/80 backdrop-blur-md">
              <div className="flex items-center gap-3">
                <motion.button
                  onClick={() => setSidebarOpen(true)}
                  className="md:hidden p-1.5 rounded-lg text-text-muted hover:text-text-secondary hover:bg-hover transition-colors"
                  aria-label="Open sidebar"
                  whileHover={{ scale: motionTokens.scale.pop }}
                  whileTap={{ scale: motionTokens.scale.press }}
                  transition={springs.snappy}
                >
                  <Menu size={18} />
                </motion.button>
                <motion.h2
                  className="text-sm font-medium text-text-secondary truncate"
                  key={activeConversation?.id ?? "empty"}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={springs.gentle}
                >
                  {activeConversation?.title ?? "Sythoria"}
                </motion.h2>
              </div>

              <div className="flex items-center gap-2" />
            </header>

            <ChatArea
              messages={messages}
              isAtBottom={isAtBottom}
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
