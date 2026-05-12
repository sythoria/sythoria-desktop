import { createContext, useContext, useCallback, useState, useEffect, ReactNode } from "react";
import type { Conversation } from "../types";

const STORAGE_KEY = "sythoria-conversations";

interface ChatContextType {
  conversations: Conversation[];
  activeId: string | null;
  isLoading: boolean;
  error: string | null;
  setActiveId: (id: string | null) => void;
  createChat: (title?: string) => string;
  deleteChat: (id: string) => void;
  renameChat: (id: string, title: string) => void;
  addMessage: (chatId: string, message: any) => void;
  updateMessage: (chatId: string, messageId: string, updates: Partial<any>) => void;
  clearChats: () => void;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

function generateId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID().slice(0, 8);
  }
  return Math.random().toString(36).substring(2, 11);
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveIdState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        parsed.forEach((c: Conversation) => {
          if (c.timestamp) {
            c.timestamp = new Date(c.timestamp);
          }
          c.messages?.forEach((m: any) => {
            if (m.timestamp) {
              m.timestamp = new Date(m.timestamp);
            }
          });
        });
        setConversations(parsed);
        if (parsed.length > 0) {
          setActiveIdState(parsed[0].id);
        }
      }
    } catch (e) {
      console.error("Failed to load conversations:", e);
      setError("Failed to load conversations");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isLoading) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
      } catch (e) {
        console.error("Failed to save conversations:", e);
      }
    }
  }, [conversations, isLoading]);

  const setActiveId = useCallback((id: string | null) => {
    setActiveIdState(id);
  }, []);

  const createChat = useCallback((title = "New chat") => {
    const id = generateId();
    const conv: Conversation = {
      id,
      title,
      timestamp: new Date(),
      messages: [],
      model: "gpt-4o",
    };
    setConversations((prev) => [conv, ...prev]);
    setActiveIdState(id);
    return id;
  }, []);

  const deleteChat = useCallback((id: string) => {
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeId === id) {
      setActiveIdState(null);
    }
  }, [activeId]);

  const renameChat = useCallback((id: string, title: string) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title } : c))
    );
  }, []);

  const addMessage = useCallback((chatId: string, message: any) => {
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== chatId) return c;
        const updatedMessages = [...c.messages, message];
        return {
          ...c,
          messages: updatedMessages,
          title: c.messages.length === 1 ? message.content.slice(0, 40) : c.title,
          timestamp: new Date(),
        };
      })
    );
  }, []);

  const updateMessage = useCallback((chatId: string, messageId: string, updates: Partial<any>) => {
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== chatId) return c;
        const updatedMessages = c.messages.map((m) =>
          m.id === messageId ? { ...m, ...updates } : m
        );
        return { ...c, messages: updatedMessages };
      })
    );
  }, []);

  const clearChats = useCallback(() => {
    setConversations([]);
    setActiveIdState(null);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return (
    <ChatContext.Provider
      value={{
        conversations,
        activeId,
        isLoading,
        error,
        setActiveId,
        createChat,
        deleteChat,
        renameChat,
        addMessage,
        updateMessage,
        clearChats,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const context = useContext(ChatContext);
  if (context === undefined) {
    throw new Error("useChat must be used within a ChatProvider");
  }
  return context;
}
