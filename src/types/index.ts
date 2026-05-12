export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  timestamp: Date;
  messages: Message[];
  model: string; // The ID of the ModelConfig
}

export interface ModelConfig {
  id: string;
  name: string;
  apiBase: string;
  apiKey: string;
  modelId: string;
  provider?: string;
}

export const DEFAULT_MODELS: ModelConfig[] = [
  {
    id: "default-gpt-4o",
    name: "GPT-4o (OpenAI)",
    apiBase: "https://api.openai.com/v1/chat/completions",
    apiKey: "",
    modelId: "gpt-4o",
    provider: "OpenAI",
  },
  {
    id: "default-claude-3-5-sonnet",
    name: "Claude 3.5 Sonnet",
    apiBase: "https://api.anthropic.com/v1/messages",
    apiKey: "",
    modelId: "claude-3-5-sonnet-20240620",
    provider: "Anthropic",
  },
  {
    id: "default-gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    apiBase: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    apiKey: "",
    modelId: "gemini-2.5-pro",
    provider: "Google Gemini",
  },
  {
    id: "default-llama3.1",
    name: "Llama 3.1 (Ollama)",
    apiBase: "http://localhost:11434/v1/chat/completions",
    apiKey: "",
    modelId: "llama3.1",
    provider: "Ollama (Local)",
  },
];

export type AuthState = {
  isAuthenticated: boolean;
  username: string;
  serverUrl: string;
  token: string;
};

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export const STATUS_COLORS: Record<ConnectionStatus, string> = {
  disconnected: "bg-gray-400",
  connecting: "bg-yellow-400 animate-pulse",
  connected: "bg-green-500",
  error: "bg-red-500",
};

const STORAGE_KEY = "sythoria-model-configs";

export function loadModelConfigs(): ModelConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {}
  return DEFAULT_MODELS;
}

export function saveModelConfigs(configs: ModelConfig[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
}

export function getModelConfig(id: string): ModelConfig | undefined {
  return loadModelConfigs().find((c) => c.id === id);
}

