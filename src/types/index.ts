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
  model: string;
}

export type Model = {
  id: string;
  name: string;
  provider: string;
  apiBase: string;
};

export const MODELS: Model[] = [
  {
    id: "gpt-4o",
    name: "GPT-4o",
    provider: "OpenAI",
    apiBase: "https://api.openai.com/v1/chat/completions",
  },
  {
    id: "claude-4-sonnet",
    name: "Claude 4 Sonnet",
    provider: "Anthropic",
    apiBase: "https://api.anthropic.com/v1/messages",
  },
  {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    provider: "Google",
    apiBase: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
  },
  {
    id: "llama3.1",
    name: "Llama 3.1",
    provider: "Ollama",
    apiBase: "http://localhost:11434/v1/chat/completions",
  },
  {
    id: "nvidia-nim",
    name: "NVIDIA NIM",
    provider: "NVIDIA",
    apiBase: "https://integrate.api.nvidia.com/v1/chat/completions",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    provider: "OpenRouter",
    apiBase: "https://openrouter.ai/api/v1/chat/completions",
  },
];

export type ProviderConfig = {
  provider: string;
  apiKey: string;
  apiBase: string;
  customModel?: string;
};

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

const STORAGE_KEY = "provider-api-keys";

export function loadProviderConfigs(): ProviderConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed === "object" && !Array.isArray(parsed)) {
        return DEFAULT_PROVIDER_CONFIGS.map((cfg) => ({
          ...cfg,
          apiKey: parsed[cfg.provider] || "",
        }));
      }
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return DEFAULT_PROVIDER_CONFIGS;
}

export function saveProviderConfigs(configs: ProviderConfig[]) {
  const record: Record<string, string> = {};
  configs.forEach((cfg) => {
    record[cfg.provider] = cfg.apiKey;
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
}

export function getProviderConfig(provider: string): ProviderConfig | undefined {
  return loadProviderConfigs().find((c) => c.provider === provider);
}

export const DEFAULT_PROVIDER_CONFIGS: ProviderConfig[] = [
  { provider: "OpenAI", apiKey: "", apiBase: "https://api.openai.com/v1/chat/completions" },
  { provider: "Anthropic", apiKey: "", apiBase: "https://api.anthropic.com/v1/messages" },
  { provider: "Google", apiKey: "", apiBase: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions" },
  { provider: "NVIDIA", apiKey: "", apiBase: "https://integrate.api.nvidia.com/v1/chat/completions", customModel: "meta/llama-3.3-70b-instruct" },
  { provider: "Ollama", apiKey: "", apiBase: "http://localhost:11434/v1/chat/completions" },
  { provider: "OpenRouter", apiKey: "", apiBase: "https://openrouter.ai/api/v1/chat/completions" },
];
