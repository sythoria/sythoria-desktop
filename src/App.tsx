import { useState, useCallback } from "react";
import { Menu } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import Sidebar from "./components/Sidebar";
import ChatArea from "./components/ChatArea";
import InputBar from "./components/InputBar";
import Settings from "./components/Settings";
import type { Conversation, Message } from "./types";
import { MODELS, getProviderConfig } from "./types";
import "./index.css";

function generateId() {
  return Math.random().toString(36).substring(2, 11);
}

function App() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState(MODELS[0].id);
  const [temperature, setTemperature] = useState(0.7);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);

  const activeConversation = conversations.find((c) => c.id === activeId) ?? null;
  const messages = activeConversation?.messages ?? [];

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

        const chatMessages = [
          ...conversations
            .find((c) => c.id === finalId)
            ?.messages.map((m) => ({ role: m.role, content: m.content })) ?? [],
          { role: "user", content: text },
        ];

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

        await invoke("chat_stream", {
          apiUrl,
          apiKey,
          model: providerConfig?.customModel || model.id,
          messages: chatMessages,
          temperature,
        });

        unlistenChunk();
        unlistenDone();

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
          <header className="shrink-0 flex items-center gap-3 px-4 py-3 md:px-6 border-b border-border/50">
            <button
              onClick={() => setSidebarOpen(true)}
              className="md:hidden p-1.5 rounded-lg text-text-muted hover:text-text-secondary hover:bg-hover transition-colors"
            >
              <Menu size={18} />
            </button>
            <h2 className="text-sm font-medium text-text-secondary truncate">
              {activeConversation?.title ?? "Sythoria"}
            </h2>
          </header>

          <ChatArea messages={messages} />

          <InputBar
            onSend={handleSend}
            selectedModel={selectedModel}
            onModelChange={setSelectedModel}
            disabled={isStreaming}
          />
        </main>
      )}
    </div>
  );
}

export default App;
