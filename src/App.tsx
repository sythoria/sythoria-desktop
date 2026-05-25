import { useCallback, useEffect, useMemo, useState, useRef } from "react";
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
import { useUIStore } from "./store/useUIStore";
import { useShallow } from "zustand/react/shallow";
import { useScrollButton } from "./hooks/useScrollPosition";

import "./index.css";

function App() {
  const { conversations, activeId, isStreaming, generationState, activityLog } = useChatStore(
    useShallow((s) => ({
      conversations: s.conversations,
      activeId: s.activeId,
      isStreaming: s.isStreaming,
      generationState: s.generationState,
      activityLog: s.activityLog,
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

  const { sidebarOpen, hasStarted, isConfigLoaded, view, showRenameModal, renameCurrentTitle, loading, toasts } =
    useUIStore(
      useShallow((s) => ({
        sidebarOpen: s.sidebarOpen,
        hasStarted: s.hasStarted,
        isConfigLoaded: s.isConfigLoaded,
        view: s.view,
        showRenameModal: s.showRenameModal,
        renameCurrentTitle: s.renameCurrentTitle,
        loading: s.loading,
        toasts: s.toasts,
      })),
    );
  const { setSidebarOpen, setView, setHasStarted, openRenameModal, closeRenameModal, dismissToast } = useUIStore(
    useShallow((s) => ({
      setSidebarOpen: s.setSidebarOpen,
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHasNewMessages(false);
  }, [activeId]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && isStreaming) {
        stopStreaming();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isStreaming, stopStreaming]);

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

  const [inputAutoFocus, setInputAutoFocus] = useState(false);

  const handleSuggestionClick = useCallback(() => {
    toggleSearchEnabled(true);
    setInputAutoFocus(false);
    requestAnimationFrame(() => setInputAutoFocus(true));
  }, [toggleSearchEnabled]);

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
      />

      {view === "settings" ? (
        <Settings />
      ) : (
        <main className="flex-1 flex flex-col min-w-0 relative bg-chat" aria-label="Chat area">
          <header className="shrink-0 flex items-center justify-between px-4 py-3 md:px-6 border-b border-border/50 bg-chat/80 backdrop-blur-md">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSidebarOpen(true)}
                className="md:hidden p-1.5 rounded-lg text-text-muted hover:text-text-secondary hover:bg-hover transition-colors"
                aria-label="Open sidebar"
              >
                <Menu size={18} />
              </button>
              <h2 className="text-sm font-medium text-text-secondary truncate">
                {activeConversation?.title ?? "Sythoria"}
              </h2>
            </div>

            <div className="flex items-center gap-2" />
          </header>

          <ChatArea
            messages={messages}
            onSuggestionClick={handleSuggestionClick}
            isAtBottom={isAtBottom}
            setIsAtBottom={setIsAtBottom}
            virtuosoRef={virtuosoRef}
            onRetry={handleRetry}
            activityLog={activityLog}
            generationState={generationState}
          />

          <div
            className={`absolute left-1/2 -translate-x-1/2 bottom-[180px] md:bottom-[160px] z-30 transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${!isAtBottom && messages.length > 0 && !isStreaming ? "opacity-100 translate-y-0 scale-100 pointer-events-auto" : "opacity-0 translate-y-3 scale-90 pointer-events-none"}`}
          >
            <ScrollToBottomButton onClick={handleScrollToBottom} hasNewMessages={hasNewMessages} />
          </div>

          <InputBar
            models={models}
            onSend={sendMessage}
            selectedModel={selectedModel}
            onModelChange={setSelectedModel}
            disabled={isStreaming}
            modelStatuses={modelStatuses}
            isSearchEnabled={isSearchEnabled}
            onToggleSearch={toggleSearchEnabled}
            inputAutoFocus={inputAutoFocus}
            isStreaming={isStreaming}
            onStop={stopStreaming}
          />
        </main>
      )}

      {showRenameModal && (
        <RenameChatModal
          isOpen={showRenameModal}
          currentTitle={renameCurrentTitle}
          onConfirm={confirmRename}
          onCancel={closeRenameModal}
        />
      )}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

export default App;
