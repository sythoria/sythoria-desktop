import { invoke } from "@tauri-apps/api/core";
import { logError } from "../utils/logger";

export type MessageRole = "user" | "assistant" | "tool";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface UrlContent {
  url: string;
  title: string;
  content: string;
  status: string;
  error?: string;
}

export interface ToolCall {
  id: string;
  name: "search_query" | "fetch_url";
  arguments: Record<string, string>;
}

export interface ToolCallResult {
  id: string;
  name: string;
  content: string;
}

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  toolCall?: ToolCall;
  toolResult?: ToolCallResult;
  sources?: { title: string; url: string }[];
  thoughtProcess?: string;
}

export interface Conversation {
  id: string;
  title: string;
  timestamp: Date;
  messages: Message[];
  model: string;
}

export interface ModelConfig {
  id: string;
  name: string;
  apiBase: string;
  apiKey: string;
  modelId: string;
  provider?: string;
}

export type SearchProvider = "google" | "searxng" | "firecrawl" | "custom";

export interface SearchApiConfig {
  id: string;
  name: string;
  provider: SearchProvider;
  baseUrl: string;
  apiKey?: string;
  cx?: string;
  maxResults: number;
  enabled: boolean;
}

export type AuthState = {
  isAuthenticated: boolean;
  username: string;
  serverUrl: string;
  token: string;
};

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

export const STATUS_COLORS: Record<ConnectionStatus, string> = {
  disconnected: "bg-gray-400",
  connecting: "bg-yellow-400 animate-pulse",
  connected: "bg-green-500",
  error: "bg-red-500",
};

export type ModelStatuses = Record<string, ConnectionStatus>;

export async function loadModelConfigs(): Promise<ModelConfig[] | null> {
  try {
    const raw = await invoke<string>("load_config");
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed as ModelConfig[];
      }
    }
  } catch (e) {
    logError("Failed to load config from system", e);
  }
  return null;
}

export async function saveModelConfigs(configs: ModelConfig[]) {
  try {
    await invoke("save_config", { config: JSON.stringify(configs) });
  } catch (e) {
    logError("Failed to save config to system", e);
  }
}

export async function getModelConfig(id: string): Promise<ModelConfig | undefined> {
  const configs = (await loadModelConfigs()) || [];
  return configs.find((c) => c.id === id);
}

export async function loadSearchConfigs(): Promise<SearchApiConfig[] | null> {
  try {
    const raw = await invoke<string>("load_search_config");
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed as SearchApiConfig[];
      }
    }
  } catch (e) {
    logError("Failed to load search config from system", e);
  }
  return null;
}

export async function saveSearchConfigs(configs: SearchApiConfig[]) {
  try {
    await invoke("save_search_config", { config: JSON.stringify(configs) });
  } catch (e) {
    logError("Failed to save search config to system", e);
  }
}
