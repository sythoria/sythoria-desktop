import { useCallback, useEffect, useMemo } from "react";
import { Menu } from "lucide-react";
import Sidebar from "./components/Sidebar";
import ChatArea from "./components/ChatArea";
import InputBar from "./components/InputBar";
import Settings from "./components/Settings";
import StartScreen from "./components/StartScreen";
import { RenameChatModal } from "./components/ui/Modal";
import { useAppStore } from "./store/useAppStore";
import "./index.css";

function App() {
  const conversations = useAppStore((s) => s.conversations);
  const activeId = useAppStore((s) => s.activeId);
  const models = useAppStore((s) => s.models);
  const selectedModel = useAppStore((s) => s.selectedModel);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const isStreaming = useAppStore((s) => s.isStreaming);
  const connectionStatus = useAppStore((s) => s.connectionStatus);
  const hasStarted = useAppStore((s) => s.hasStarted);
  const isConfigLoaded = useAppStore((s) => s.isConfigLoaded);
  const view = useAppStore((s) => s.view);
  const showRenameModal = useAppStore((s) => s.showRenameModal);
  const renameCurrentTitle = useAppStore((s) => s.renameCurrentTitle);

  const init = useAppStore((s) => s.init);
  const setActiveId = useAppStore((s) => s.setActiveId);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const setView = useAppStore((s) => s.setView);
  const setHasStarted = useAppStore((s) => s.setHasStarted);
  const setSelectedModel = useAppStore((s) => s.setSelectedModel);
  const newChat = useAppStore((s) => s.newChat);
  const deleteChat = useAppStore((s) => s.deleteChat);
  const openRenameModal = useAppStore((s) => s.openRenameModal);
  const confirmRename = useAppStore((s) => s.confirmRename);
  const closeRenameModal = useAppStore((s) => s.closeRenameModal);
  const sendMessage = useAppStore((s) => s.sendMessage);
  const setupConnectionListeners = useAppStore((s) => s.setupConnectionListeners);

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );
  const messages = activeConversation?.messages ?? [];

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    setupConnectionListeners().then((fn) => {
      cleanup = fn;
    });
    return () => cleanup?.();
  }, [setupConnectionListeners]);

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
        connectionStatus={connectionStatus}
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

          <ChatArea messages={messages} connectionStatus={connectionStatus} onSuggestionClick={sendMessage} />

          <InputBar
            models={models}
            onSend={sendMessage}
            selectedModel={selectedModel}
            onModelChange={setSelectedModel}
            disabled={isStreaming}
            connectionStatus={connectionStatus}
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
