import { Store } from "@tauri-apps/plugin-store";
import type { Conversation, ModelConfig } from "../types";
import { logError, logInfo } from "./logger";

const CONVERSATIONS_KEY = "sythoria-conversations";
const THEME_KEY = "sythoria-theme";
const API_KEYS_KEY = "sythoria-api-keys";
const STORE_FILE = "sythoria-store.json";

let storeInstance: Store | null = null;

async function getStore(): Promise<Store> {
  if (!storeInstance) {
    storeInstance = await Store.load(STORE_FILE, { autoSave: true });
  }
  return storeInstance;
}

export async function loadConversations(): Promise<Conversation[]> {
  try {
    const store = await getStore();
    const raw = await store.get<Conversation[]>(CONVERSATIONS_KEY);
    if (raw && Array.isArray(raw)) {
      raw.forEach((c: Conversation) => {
        if (c.timestamp) c.timestamp = new Date(c.timestamp);
        c.messages?.forEach((m: any) => {
          if (m.timestamp) m.timestamp = new Date(m.timestamp);
        });
      });
      return raw;
    }
  } catch (e) {
    logError("Failed to load conversations from secure store", e);
    const fallback = localStorage.getItem(CONVERSATIONS_KEY);
    if (fallback) {
      try {
        const parsed = JSON.parse(fallback);
        parsed.forEach((c: Conversation) => {
          if (c.timestamp) c.timestamp = new Date(c.timestamp);
          c.messages?.forEach((m: any) => {
            if (m.timestamp) m.timestamp = new Date(m.timestamp);
          });
        });
        return parsed;
      } catch {
        logError("Failed to parse conversations from localStorage", e);
      }
    }
  }
  return [];
}

export async function saveConversations(conversations: Conversation[]): Promise<void> {
  try {
    const store = await getStore();
    await store.set(CONVERSATIONS_KEY, conversations);
  } catch (e) {
    logError("Failed to save conversations to secure store", e);
    try {
      localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(conversations));
    } catch (e2) {
      logError("Failed to save conversations to localStorage", e2);
    }
  }
}

export async function loadTheme(): Promise<"light" | "dark"> {
  try {
    const store = await getStore();
    const theme = await store.get<string>(THEME_KEY);
    if (theme === "light" || theme === "dark") return theme;
  } catch (e) {
    logError("Failed to load theme from secure store", e);
  }
  const fallback = localStorage.getItem(THEME_KEY);
  if (fallback === "light" || fallback === "dark") return fallback;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export async function saveTheme(theme: "light" | "dark"): Promise<void> {
  try {
    const store = await getStore();
    await store.set(THEME_KEY, theme);
  } catch (e) {
    logError("Failed to save theme to secure store", e);
    localStorage.setItem(THEME_KEY, theme);
  }
}

export async function loadApiKeys(): Promise<Record<string, string>> {
  try {
    const store = await getStore();
    const keys = await store.get<Record<string, string>>(API_KEYS_KEY);
    if (keys && typeof keys === "object") return keys;
  } catch (e) {
    logError("Failed to load API keys from secure store", e);
  }
  return {};
}

export async function saveApiKeys(keys: Record<string, string>): Promise<void> {
  try {
    const store = await getStore();
    await store.set(API_KEYS_KEY, keys);
  } catch (e) {
    logError("Failed to save API keys to secure store", e);
  }
}

export async function clearConversations(): Promise<void> {
  try {
    const store = await getStore();
    await store.delete(CONVERSATIONS_KEY);
  } catch (e) {
    logError("Failed to clear conversations from secure store", e);
  }
  localStorage.removeItem(CONVERSATIONS_KEY);
}
