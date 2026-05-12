import { useState, useCallback, useEffect, useMemo } from "react";
import { Menu } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import Sidebar from "./components/Sidebar";
import ChatArea from "./components/ChatArea";
import InputBar from "./components/InputBar";
import Settings from "./components/Settings";
import StartScreen from "./components/StartScreen";
import { Modal } from "./components/ui/Modal";
import type { Conversation, Message, ConnectionStatus, ModelConfig } from "./types";
import { loadModelConfigs, saveModelConfigs } from "./types";
import "./index.css";

function generateId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID().slice(0, 8);
  }
  return Math.random().toString(36).substring(2, 11);
}

type View = "chat" | "settings";

function App() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [temperature, setTemperature] = useState(0.7);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("disconnected");
  const [hasStarted, setHasStarted] = useState(false);
  const [isConfigLoaded, setIsConfigLoaded] = useState(false);
  const [view, setView] = useState<View>("chat");
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId]
  );
  const messages = activeConversation?.messages ?? [];

  useEffect(() => {
    async function loadConfigs() {
      const loaded = await loadModelConfigs();
      if (loaded && loaded.length > 0) {
        setModels(loaded);
        setSelectedModel(loaded[0].id);
        setHasStarted(true);
      }
      setIsConfigLoaded(true);
    }
    loadConfigs();
  }, []);

  useEffect(() => {
    if (isConfigLoaded) {
      saveModelConfigs(models);
      if (!models.find(m => m.id === selectedModel) && models.length > 0) {
        setSelectedModel(models[0].id);
      }
    }
  }, [models, selectedModel, isConfigLoaded]);

  useEffect(() => {
    const savedConversations = localStorage.getItem("sythoria-conversations");
    if (savedConversations) {
      try {
        const parsed = JSON.parse(savedConversations);
        parsed.forEach((c: any) => {
          if (c.timestamp) c.timestamp = new Date(c.timestamp);
          c.messages?.forEach((m: any) => {
            if (m.timestamp) m.timestamp = new Date(m.timestamp);
          });
        });
        setConversations(parsed);
        if (parsed.length > 0) {
          setActiveId(parsed[0].id);
        }
      } catch (e) {
        console.error("Failed to load conversations", e);
      }
    }
  }, []);

  useEffect(() => {
    if (!hasStarted) return;
    try {
      localStorage.setItem("sythoria-conversations", JSON.stringify(conversations));
    } catch (e) {
      console.error("Failed to save conversations", e);
    }
  }, [conversations, hasStarted]);

  const handleStart = useCallback(() => {
    setHasStarted(true);
    setConnectionStatus("disconnected");
  }, []);

  const handleNewChat = useCallback(() => {
    const id = generateId();
    const conv: Conversation = {
      id,
      title: "New chat",
      timestamp: new Date(),
      messages: [],
      model: selectedModel,
    };
    setConversations((prev) => [conv, ...prev]);
    setActiveId(id);
    setSidebarOpen(false);
    setView("chat");
    return id;
  }, [selectedModel]);

  const handleDeleteChat = useCallback((id: string) => {
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeId === id) setActiveId(null);
  }, [activeId]);

  const handleRenameChat = useCallback((id: string, newTitle: string) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title: newTitle } : c))
    );
  }, []);

  const handleStartRename = useCallback((id: string, currentTitle: string) => {
    setRenameId(id);
    setRenameValue(currentTitle);
    setShowRenameModal(true);
  }, []);

  const handleConfirmRename = useCallback(() => {
    if (renameId && renameValue.trim()) {
      handleRenameChat(renameId, renameValue.trim());
    }
    setShowRenameModal(false);
    setRenameId(null);
    setRenameValue("");
  }, [renameId, renameValue, handleRenameChat]);

  const handleSend = useCallback(
    async (text: string) => {
      if (isStreaming) return;

      let convId = activeId;

      if (!convId) {
        const id = generateId();
        const conv: Conversation = {
          id,
          title: text.length > 40 ? text.slice(0, 40) + "…" : text,
          timestamp: new Date(),
          messages: [],
          model: selectedModel,
        };
        setConversations((prev) => [conv, ...prev]);
        setActiveId(id);
        convId = id;
      }

      const userMsg: Message = {
        id: generateId(),
        role: "user",
        content: text,
        timestamp: new Date(),
      };

      const assistantMsg: Message = {
        id: generateId(),
        role: "assistant",
        content: "",
        timestamp: new Date(),
        isStreaming: true,
      };

      const finalId = convId;
      const modelConfig = models.find((m) => m.id === selectedModel) ?? models[0];

      if (!modelConfig) {
         console.error("No model configuration selected");
         return;
      }

      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== finalId) return c;
          return {
            ...c,
            timestamp: new Date(),
            title:
              c.messages.length === 0
                ? text.length > 40
                  ? text.slice(0, 40) + "…"
                  : text
                : c.title,
            messages: [...c.messages, userMsg, assistantMsg],
          };
        })
      );

      setIsStreaming(true);

      try {
        const apiUrl = modelConfig.apiBase;
        const apiKey = modelConfig.apiKey;

        const unlistenChunk = await listen<string>("chat-stream-chunk", (event) => {
          setConversations((prev) =>
            prev.map((c) => {
              if (c.id !== finalId) return c;
              const updated = [...c.messages];
              const last = updated[updated.length - 1];
              if (last && last.role === "assistant") {
                updated[updated.length - 1] = {
                  ...last,
                  content: last.content + event.payload,
                };
              }
              return { ...c, messages: updated };
            })
          );
        });

        const unlistenDone = await listen("chat-stream-done", () => {
          setConversations((prev) =>
            prev.map((c) => {
              if (c.id !== finalId) return c;
              const updated = [...c.messages];
              const last = updated[updated.length - 1];
              if (last && last.role === "assistant") {
                updated[updated.length - 1] = {
                  ...last,
                  isStreaming: false,
                };
              }
              return { ...c, messages: updated };
            })
          );
          setIsStreaming(false);
        });

        try {
          await invoke("chat_stream", {
            apiUrl,
            apiKey,
            model: modelConfig.modelId,
            messages: [
              ...(conversations.find((c) => c.id === finalId)?.messages.map((m) => ({
                role: m.role,
                content: m.content,
              })) ?? []),
              { role: "user", content: text },
            ],
            temperature,
          });
        } finally {
          unlistenChunk();
          unlistenDone();
        }

        setConversations((prev) =>
          prev.map((c) => {
            if (c.id !== finalId) return c;
            const updated = [...c.messages];
            const last = updated[updated.length - 1];
            if (last && last.role === "assistant" && last.isStreaming) {
              updated[updated.length - 1] = { ...last, isStreaming: false };
            }
            return { ...c, messages: updated };
          })
        );
      } catch (err) {
        setConversations((prev) =>
          prev.map((c) => {
            if (c.id !== finalId) return c;
            const updated = [...c.messages];
            const last = updated[updated.length - 1];
            if (last && last.role === "assistant") {
              updated[updated.length - 1] = {
                ...last,
                content: `**Error:** ${err}`,
                isStreaming: false,
              };
            }
            return { ...c, messages: updated };
          })
        );
      } finally {
        setIsStreaming(false);
      }
    },
    [activeId, selectedModel, temperature, isStreaming, conversations, models]
  );

  useEffect(() => {
    const unlistenFns: UnlistenFn[] = [];
    let cancelled = false;

    async function setupListeners() {
      unlistenFns.push(
        await listen<string>("ws-error", (event) => {
          if (!cancelled) setConnectionStatus("error");
          console.error("WS error:", event.payload);
        })
      );
      unlistenFns.push(
        await listen("ws-closed", () => {
          if (!cancelled) setConnectionStatus("disconnected");
        })
      );
    }
    setupListeners();

    return () => {
      cancelled = true;
      unlistenFns.forEach((fn) => fn());
    };
  }, []);

  const handleSettingsClick = useCallback(() => {
    setView("settings");
    setSidebarOpen(false);
  }, []);

  const handleBackToChat = useCallback(() => {
    setView("chat");
  }, []);

  const handleSelectConversation = useCallback((id: string) => {
    setActiveId(id);
    setView("chat");
    setSidebarOpen(false);
  }, []);

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
        onRenameChat={handleStartRename}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        connectionStatus={connectionStatus}
      />

      {view === "settings" ? (
        <Settings
          models={models}
          setModels={setModels}
          selectedModel={selectedModel}
          onModelChange={setSelectedModel}
          temperature={temperature}
          onTemperatureChange={setTemperature}
          onBack={handleBackToChat}
          onCreateChat={() => {
            const newId = handleNewChat();
            setView("chat");
            return newId;
          }}
        />
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

            <div className="flex items-center gap-3">
            </div>
          </header>

          <ChatArea messages={messages} connectionStatus={connectionStatus} />

          <InputBar
            models={models}
            onSend={handleSend}
            selectedModel={selectedModel}
            onModelChange={setSelectedModel}
            disabled={isStreaming}
            connectionStatus={connectionStatus}
          />
        </main>
      )}

      <Modal
        isOpen={showRenameModal}
        onClose={() => {
          setShowRenameModal(false);
          setRenameId(null);
          setRenameValue("");
        }}
        title="Rename Chat"
      >
        <div className="space-y-4">
          <input
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-input border border-border focus:border-primary focus:outline-none text-text-primary"
            placeholder="Enter new title"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") handleConfirmRename();
              if (e.key === "Escape") {
                setShowRenameModal(false);
                setRenameId(null);
                setRenameValue("");
              }
            }}
          />
          <div className="flex gap-3 justify-end">
            <button
              onClick={() => {
                setShowRenameModal(false);
                setRenameId(null);
                setRenameValue("");
              }}
              className="px-4 py-2 rounded-lg border border-border text-text-secondary hover:bg-hover transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmRename}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Rename
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default App;
