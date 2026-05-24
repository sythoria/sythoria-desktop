import { z } from "zod";
import { invoke } from "@tauri-apps/api/core";
import { Store } from "@tauri-apps/plugin-store";
import type { Conversation } from "../types";
import { logError } from "./logger";

const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()),
});

const ToolCallResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  content: z.string(),
});

const SourceSchema = z.object({
  title: z.string(),
  url: z.string(),
});

const MessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant", "tool"]),
  content: z.string(),
  timestamp: z.coerce.date(),
  isStreaming: z.boolean().optional(),
  toolCall: ToolCallSchema.optional(),
  toolResult: ToolCallResultSchema.optional(),
  sources: z.array(SourceSchema).optional(),
  thoughtProcess: z.string().optional(),
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

const SearchConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.enum(["google", "searxng", "firecrawl"]),
  baseUrl: z.string(),
  apiKey: z.string().optional(),
  cx: z.string().optional(),
  maxResults: z.number(),
  enabled: z.boolean(),
});

const SearchConfigsArraySchema = z.array(SearchConfigSchema);

const CONVERSATIONS_KEY = "sythoria-conversations";
const THEME_KEY = "sythoria-theme";
const API_KEYS_KEY = "sythoria-api-keys";
const SEARCH_CONFIGS_KEY = "sythoria-search-configs";
const SEARCH_API_KEYS_KEY = "sythoria-search-api-keys";
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
    const raw = await invoke<unknown>("load_api_keys");
    const result = ApiKeysSchema.safeParse(raw);
    if (result.success && Object.keys(result.data).length > 0) return result.data;
  } catch (e) {
    logError("Failed to load API keys from keychain", e);
  }

  try {
    const store = await getStore();
    const legacyRaw = await store.get<unknown>(API_KEYS_KEY);
    const legacy = ApiKeysSchema.safeParse(legacyRaw);
    if (legacy.success && Object.keys(legacy.data).length > 0) {
      await saveApiKeys(legacy.data);
      await store.delete(API_KEYS_KEY);
      return legacy.data;
    }
    if (legacyRaw) logError("Stored API keys failed validation, resetting");
  } catch (e) {
    logError("Failed to migrate legacy API keys", e);
  }
  return {};
}

export async function saveApiKeys(keys: Record<string, string>): Promise<void> {
  try {
    await invoke("save_api_keys_cmd", { keys });
  } catch (e) {
    logError("Failed to save API keys to keychain", e);
  }
}

export async function loadSearchConfigs(): Promise<import("../types").SearchApiConfig[] | null> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(SEARCH_CONFIGS_KEY);
    if (raw) {
      const result = SearchConfigsArraySchema.safeParse(raw);
      if (result.success) return result.data as import("../types").SearchApiConfig[];
      logError("Stored search configs failed validation", result.error);
    }
  } catch (e) {
    logError("Failed to load search configs from secure store", e);
  }
  return null;
}

export async function saveSearchConfigs(configs: import("../types").SearchApiConfig[]): Promise<void> {
  try {
    const store = await getStore();
    await store.set(SEARCH_CONFIGS_KEY, configs);
  } catch (e) {
    logError("Failed to save search configs to secure store", e);
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

export async function loadSearchApiKeys(): Promise<Record<string, string>> {
  try {
    const raw = await invoke<unknown>("load_search_api_keys");
    const result = ApiKeysSchema.safeParse(raw);
    if (result.success && Object.keys(result.data).length > 0) return result.data;
  } catch (e) {
    logError("Failed to load search API keys from keychain", e);
  }

  try {
    const store = await getStore();
    const legacyRaw = await store.get<unknown>(SEARCH_API_KEYS_KEY);
    const legacy = ApiKeysSchema.safeParse(legacyRaw);
    if (legacy.success && Object.keys(legacy.data).length > 0) {
      await saveSearchApiKeys(legacy.data);
      await store.delete(SEARCH_API_KEYS_KEY);
      return legacy.data;
    }
    if (legacyRaw) logError("Stored search API keys failed validation, resetting");
  } catch (e) {
    logError("Failed to migrate legacy search API keys", e);
  }
  return {};
}

export async function saveSearchApiKeys(keys: Record<string, string>): Promise<void> {
  try {
    await invoke("save_search_api_keys_cmd", { keys });
  } catch (e) {
    logError("Failed to save search API keys to keychain", e);
  }
}
