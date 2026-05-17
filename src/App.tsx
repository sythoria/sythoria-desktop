import { useCallback, useEffect, useMemo } from "react";
import { Menu } from "lucide-react";
import Sidebar from "./components/Sidebar";
import ChatArea from "./components/ChatArea";
import InputBar from "./components/InputBar";
import Settings from "./components/Settings";
import StartScreen from "./components/StartScreen";
import { RenameChatModal } from "./components/ui/Modal";
import { useAppStore } from "./store/useAppStore";
import { useShallow } from "zustand/react/shallow";
import "./index.css";

function App() {
  const {
    conversations,
    activeId,
    models,
    selectedModel,
    sidebarOpen,
    isStreaming,
    modelStatuses,
    hasStarted,
    isConfigLoaded,
    view,
    showRenameModal,
    renameCurrentTitle,
  } = useAppStore(
    useShallow((s) => ({
      conversations: s.conversations,
      activeId: s.activeId,
      models: s.models,
      selectedModel: s.selectedModel,
      sidebarOpen: s.sidebarOpen,
      isStreaming: s.isStreaming,
      modelStatuses: s.modelStatuses,
      hasStarted: s.hasStarted,
      isConfigLoaded: s.isConfigLoaded,
      view: s.view,
      showRenameModal: s.showRenameModal,
      renameCurrentTitle: s.renameCurrentTitle,
    })),
  );

  const {
    init,
    setActiveId,
    setSidebarOpen,
    setView,
    setHasStarted,
    setSelectedModel,
    newChat,
    deleteChat,
    openRenameModal,
    confirmRename,
    closeRenameModal,
    sendMessage,
  } = useAppStore(
    useShallow((s) => ({
      init: s.init,
      setActiveId: s.setActiveId,
      setSidebarOpen: s.setSidebarOpen,
      setView: s.setView,
      setHasStarted: s.setHasStarted,
      setSelectedModel: s.setSelectedModel,
      newChat: s.newChat,
      deleteChat: s.deleteChat,
      openRenameModal: s.openRenameModal,
      confirmRename: s.confirmRename,
      closeRenameModal: s.closeRenameModal,
      sendMessage: s.sendMessage,
    })),
  );

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );
  const messages = activeConversation?.messages ?? [];

  useEffect(() => {
    init();
  }, [init]);

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

  if (!isConfigLoaded) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-chat">
        <div className="animate-pulse-soft w-8 h-8 rounded-full bg-accent/30" />
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
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        modelStatuses={modelStatuses}
      />

      {view === "settings" ? (
        <Settings />
      ) : (
        <main className="flex-1 flex flex-col min-w-0 bg-chat">
          <header className="shrink-0 flex items-center justify-between px-4 py-3 md:px-6 border-b border-border/50 bg-chat/80 backdrop-blur-md">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSidebarOpen(true)}
                className="md:hidden p-1.5 rounded-lg text-text-muted hover:text-text-secondary hover:bg-hover transition-colors"
              >
                <Menu size={18} />
              </button>
              <h2 className="text-sm font-medium text-text-secondary truncate">
                {activeConversation?.title ?? "Sythoria"}
              </h2>
            </div>

            <div className="flex items-center gap-3" />
          </header>

          <ChatArea messages={messages} onSuggestionClick={sendMessage} />

          <InputBar
            models={models}
            onSend={sendMessage}
            selectedModel={selectedModel}
            onModelChange={setSelectedModel}
            disabled={isStreaming}
            modelStatuses={modelStatuses}
          />
        </main>
      )}

      <RenameChatModal
        isOpen={showRenameModal}
        currentTitle={renameCurrentTitle}
        onConfirm={confirmRename}
        onCancel={closeRenameModal}
      />
    </div>
  );
}

export default App;
