import { useState, useCallback, useEffect, useMemo } from "react";
import { Menu, LogOut } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import Sidebar from "./components/Sidebar";
import ChatArea from "./components/ChatArea";
import InputBar from "./components/InputBar";
import Settings from "./components/Settings";
import AuthScreen from "./components/AuthScreen";
import type { Conversation, Message, ConnectionStatus } from "./types";
import { MODELS, getProviderConfig } from "./types";
import "./index.css";

function generateId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID().slice(0, 8);
  }
  return Math.random().toString(36).substring(2, 11);
}

function toErrorString(err: unknown): string {
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const obj = err as Record<string, unknown>;
    if (typeof obj.message === "string") return obj.message;
    if (typeof obj.toString === "function") return obj.toString();
  }
  return "Authentication failed";
}

function App() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState(MODELS[0].id);
  const [temperature, setTemperature] = useState(0.7);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("disconnected");
  const [providerConfigs, setProviderConfigs] = useState<Record<string, string>>({});
  const [providerConfigs, setProviderConfigs] = useState<Record<string, string>>({});

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId]
  );
  const messages = activeConversation?.messages ?? [];

  // Initialize provider configs from localStorage
  useEffect(() => {
    const savedConfigs = localStorage.getItem("provider-api-keys");
    if (savedConfigs) {
      try {
        setProviderConfigs(JSON.parse(savedConfigs));
      } catch (e) {
        console.error("Failed to parse provider configs", e);
      }
    }
  }, []);

  // Save provider configs to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem("provider-api-keys", JSON.stringify(providerConfigs));
  }, [providerConfigs]);

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
  }, [selectedModel]);

  const handleSend = useCallback(
    async (text: string) => {
      if (isStreaming) return;

      let convId = activeId;

      if (!convId) {
        const id = generateId();
        const conv: Conversation = {
          id,
          title: text.length > 40 ? text.slice(0, 40) + "\u2026" : text,
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
      const model = MODELS.find((m) => m.id === selectedModel) ?? MODELS[0];
      const providerConfig = getProviderConfig(model.provider);

      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== finalId) return c;
          return {
            ...c,
            timestamp: new Date(),
            title:
              c.messages.length === 0
                ? text.length > 40
                  ? text.slice(0, 40) + "\u2026"
                  : text
                : c.title,
            messages: [...c.messages, userMsg, assistantMsg],
          };
        })
      );

      setIsStreaming(true);

      try {
        const apiUrl = providerConfig?.apiBase || model.apiBase;
        const apiKey = providerConfigs[model.provider] || "";

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
            model: providerConfig?.customModel || model.id,
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
    [activeId, selectedModel, temperature, isStreaming, conversations, providerConfigs]
  );

  useEffect(() => {
    const unlistenFns: UnlistenFn[] = [];
    let cancelled = false;

    async function setupListeners() {
      unlistenFns.push(await listen<string>("ws-error", (event) => {
        if (!cancelled) setConnectionStatus("error");
        console.error("WS error:", event.payload);
      }));
      unlistenFns.push(await listen("ws-closed", () => {
        if (!cancelled) setConnectionStatus("disconnected");
      }));
    }
    setupListeners();

    return () => {
      cancelled = true;
      unlistenFns.forEach((fn) => fn());
    };
  }, []);

  const [view, setView] = useState<"chat" | "settings">("chat");

  const handleSettingsClick = useCallback(() => {
    setView("settings");
    setSidebarOpen(false);
  }, []);

  const handleSelectConversation = useCallback((id: string) => {
    setActiveId(id);
    setView("chat");
    setSidebarOpen(false);
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-chat">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={handleSelectConversation}
        onNewChat={handleNewChat}
        onSettingsClick={handleSettingsClick}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        connectionStatus={connectionStatus}
      />

      {view === "settings" ? (
        <Settings
          selectedModel={selectedModel}
          onModelChange={setSelectedModel}
          temperature={temperature}
          onTemperatureChange={setTemperature}
        />
      ) : (
        <main className="flex-1 flex flex-col min-w-0 bg-chat">
          <header className="shrink-0 flex items-center justify-between px-4 py-3 md:px-6 border-b border-border/50">
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
              <div className="hidden sm:flex flex-col items-end">
                <span className="text-[10px] font-medium text-text-muted uppercase tracking-wider">User</span>
                <span className="text-xs font-semibold text-text-primary">Anonymous</span>
              </div>
              <button
                onClick={() => setConnectionStatus("disconnected")}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-border text-xs font-medium text-text-secondary hover:text-red-500 hover:border-red-500/50 hover:bg-red-500/5 transition-all"
              >
                <LogOut size={14} />
                <span className="hidden xs:inline">Disconnect</span>
              </button>
            </div>
          </header>

          <ChatArea
            messages={messages}
            connectionStatus={connectionStatus}
          />

          <InputBar
            onSend={handleSend}
            selectedModel={selectedModel}
            onModelChange={setSelectedModel}
            disabled={isStreaming}
            connectionStatus={connectionStatus}
          />
        </main>
      )}
    </div>
  );
}
    }
  }, []);

  // Save provider configs to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem("provider-api-keys", JSON.stringify(providerConfigs));
  }, [providerConfigs]);

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
  }, [selectedModel]);

  // ... rest of the function remains the same until the return statement

  // Remove the authentication check - always show the chat interface
  // if (!isAuthenticated) {
  //   return <AuthScreen onAuth={handleAuth} />;
  // }

  // ... rest of the function remains the same
}
  };

  const handleDisconnect = useCallback(() => {
    setIsAuthenticated(false);
    setConnectionStatus("disconnected");
    setUsername("");
    setServerUrl("");
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
  }, [selectedModel]);

  const handleSend = useCallback(
    async (text: string) => {
      if (isStreaming) return;

      let convId = activeId;

      if (!convId) {
        const id = generateId();
        const conv: Conversation = {
          id,
          title: text.length > 40 ? text.slice(0, 40) + "\u2026" : text,
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
      const model = MODELS.find((m) => m.id === selectedModel) ?? MODELS[0];
      const providerConfig = getProviderConfig(model.provider);

      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== finalId) return c;
          return {
            ...c,
            timestamp: new Date(),
            title:
              c.messages.length === 0
                ? text.length > 40
                  ? text.slice(0, 40) + "\u2026"
                  : text
                : c.title,
            messages: [...c.messages, userMsg, assistantMsg],
          };
        })
      );

      setIsStreaming(true);

      try {
        const apiUrl = providerConfig?.apiBase || model.apiBase;
        const apiKey = providerConfig?.apiKey || "";

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
            model: providerConfig?.customModel || model.id,
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
    [activeId, selectedModel, temperature, isStreaming, conversations]
  );

  useEffect(() => {
    const unlistenFns: UnlistenFn[] = [];
    let cancelled = false;

    async function setupListeners() {
      unlistenFns.push(await listen<string>("ws-error", (event) => {
        if (!cancelled) setConnectionStatus("error");
        console.error("WS error:", event.payload);
      }));
      unlistenFns.push(await listen("ws-closed", () => {
        if (!cancelled) setConnectionStatus("disconnected");
      }));
    }
    setupListeners();

    return () => {
      cancelled = true;
      unlistenFns.forEach((fn) => fn());
    };
  }, []);

  const [view, setView] = useState<"chat" | "settings">("chat");

  const handleSettingsClick = useCallback(() => {
    setView("settings");
    setSidebarOpen(false);
  }, []);

  const handleSelectConversation = useCallback((id: string) => {
    setActiveId(id);
    setView("chat");
    setSidebarOpen(false);
  }, []);

  if (!isAuthenticated) {
    return <AuthScreen onAuth={handleAuth} />;
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-chat">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={handleSelectConversation}
        onNewChat={handleNewChat}
        onSettingsClick={handleSettingsClick}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        connectionStatus={connectionStatus}
      />

      {view === "settings" ? (
        <Settings
          selectedModel={selectedModel}
          onModelChange={setSelectedModel}
          temperature={temperature}
          onTemperatureChange={setTemperature}
        />
      ) : (
        <main className="flex-1 flex flex-col min-w-0 bg-chat">
          <header className="shrink-0 flex items-center justify-between px-4 py-3 md:px-6 border-b border-border/50">
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
              <div className="hidden sm:flex flex-col items-end">
                <span className="text-[10px] font-medium text-text-muted uppercase tracking-wider">User</span>
                <span className="text-xs font-semibold text-text-primary">{username}</span>
              </div>
              <button
                onClick={handleDisconnect}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-border text-xs font-medium text-text-secondary hover:text-red-500 hover:border-red-500/50 hover:bg-red-500/5 transition-all"
              >
                <LogOut size={14} />
                <span className="hidden xs:inline">Disconnect</span>
              </button>
            </div>
          </header>

          <ChatArea
            messages={messages}
            connectionStatus={connectionStatus}
          />

          <InputBar
            onSend={handleSend}
            selectedModel={selectedModel}
            onModelChange={setSelectedModel}
            disabled={isStreaming}
            connectionStatus={connectionStatus}
          />
        </main>
      )}
    </div>
  );
}

export default App;