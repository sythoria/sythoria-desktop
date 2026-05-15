import { z } from "zod";
import { Store } from "@tauri-apps/plugin-store";
import type { Conversation } from "../types";
import { logError } from "./logger";

const MessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  timestamp: z.coerce.date(),
  isStreaming: z.boolean().optional(),
});

const ConversationSchema = z.object({
  id: z.string(),
  title: z.string(),
  timestamp: z.coerce.date(),
  messages: z.array(MessageSchema),
  model: z.string(),
});

const ConversationsArraySchema = z.array(ConversationSchema);

const ThemeSchema = z.enum(["light", "dark"]);

const ApiKeysSchema = z.record(z.string(), z.string());

const CONVERSATIONS_KEY = "sythoria-conversations";
const THEME_KEY = "sythoria-theme";
const API_KEYS_KEY = "sythoria-api-keys";
const STORE_FILE = "sythoria-store.json";

let storeInstance: Store | null = null;

async function getStore(): Promise<Store> {
  if (!storeInstance) {
    storeInstance = await Store.load(STORE_FILE);
  }
  return storeInstance;
}

function parseConversations(raw: unknown): Conversation[] {
  const result = ConversationsArraySchema.safeParse(raw);
  if (result.success) return result.data as Conversation[];
  logError("Stored conversations failed validation, resetting", result.error);
  return [];
}

export async function loadConversations(): Promise<Conversation[]> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(CONVERSATIONS_KEY);
    if (raw) return parseConversations(raw);
  } catch (e) {
    logError("Failed to load conversations from secure store", e);
    const fallback = localStorage.getItem(CONVERSATIONS_KEY);
    if (fallback) {
      try {
        return parseConversations(JSON.parse(fallback));
      } catch (e2) {
        logError("Failed to parse conversations from localStorage", e2);
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
    const raw = await store.get<unknown>(THEME_KEY);
    const result = ThemeSchema.safeParse(raw);
    if (result.success) return result.data;
  } catch (e) {
    logError("Failed to load theme from secure store", e);
  }
  const fallback = localStorage.getItem(THEME_KEY);
  const result = ThemeSchema.safeParse(fallback);
  if (result.success) return result.data;
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
    const raw = await store.get<unknown>(API_KEYS_KEY);
    const result = ApiKeysSchema.safeParse(raw);
    if (result.success) return result.data;
    if (raw) logError("Stored API keys failed validation, resetting");
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
