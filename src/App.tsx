import { useState, useCallback, useRef } from "react";
import { Menu } from "lucide-react";
import Sidebar from "./components/Sidebar";
import ChatArea from "./components/ChatArea";
import InputBar from "./components/InputBar";
import Settings from "./components/Settings";
import type { Conversation, Message } from "./types";
import { MODELS } from "./types";
import "./index.css";

function generateId() {
  return Math.random().toString(36).substring(2, 11);
}

const DEMO_RESPONSE = `Here's a quick overview of what I can help you with:

## Capabilities

- **Code generation** — Write, review, and debug code in any language
- **Analysis** — Break down complex problems step by step
- **Creative writing** — Drafts, summaries, and rewrites
- **Research** — Synthesize information and explain concepts

### Example code

\`\`\`python
def fibonacci(n: int) -> list[int]:
    fib = [0, 1]
    for i in range(2, n):
        fib.append(fib[-1] + fib[-2])
    return fib[:n]
\`\`\`

> "The best way to predict the future is to invent it." — Alan Kay

Feel free to ask me anything. I'm here to help.`;

function App() {
  const [conversations, setConversations] = useState<Conversation[]>([
    {
      id: "demo-1",
      title: "Getting started with Sythoria",
      timestamp: new Date(),
      messages: [],
      model: "claude-4-sonnet",
    },
    {
      id: "demo-2",
      title: "Code review for auth module",
      timestamp: new Date(Date.now() - 3600000),
      messages: [],
      model: "gpt-4o",
    },
    {
      id: "demo-3",
      title: "Explain transformer architecture",
      timestamp: new Date(Date.now() - 86400000),
      messages: [],
      model: "gemini-2.5-pro",
    },
    {
      id: "demo-4",
      title: "Draft project proposal",
      timestamp: new Date(Date.now() - 86400000 * 3),
      messages: [],
      model: "claude-4-sonnet",
    },
    {
      id: "demo-5",
      title: "Debug React useEffect hook",
      timestamp: new Date(Date.now() - 86400000 * 5),
      messages: [],
      model: "gpt-4o",
    },
    {
      id: "demo-6",
      title: "Plan database migration strategy",
      timestamp: new Date(Date.now() - 86400000 * 10),
      messages: [],
      model: "llama3.1",
    },
  ]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState(MODELS[0].id);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const streamingRef = useRef(false);

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

  const simulateStreaming = useCallback(
    (convId: string, fullText: string) => {
      streamingRef.current = true;
      const words = fullText.split(" ");
      let idx = 0;

      const interval = setInterval(() => {
        idx++;
        if (idx > words.length) {
          clearInterval(interval);
          streamingRef.current = false;
          setConversations((prev) =>
            prev.map((c) => {
              if (c.id !== convId) return c;
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
          return;
        }

        const partial = words.slice(0, idx).join(" ");
        setConversations((prev) =>
          prev.map((c) => {
            if (c.id !== convId) return c;
            const updated = [...c.messages];
            const last = updated[updated.length - 1];
            if (last && last.role === "assistant") {
              updated[updated.length - 1] = {
                ...last,
                content: partial,
              };
            }
            return { ...c, messages: updated };
          })
        );
      }, 30);
    },
    []
  );

  const handleSend = useCallback(
    (text: string) => {
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

      setTimeout(() => simulateStreaming(finalId, DEMO_RESPONSE), 500);
    },
    [activeId, selectedModel, simulateStreaming]
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
            disabled={streamingRef.current}
          />
        </main>
      )}
    </div>
  );
}

export default App;
