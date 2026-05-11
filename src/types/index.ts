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
];

export type ProviderConfig = {
  provider: string;
  apiKey: string;
  apiBase: string;
  customModel?: string;
};

const STORAGE_KEY = "sythoria-provider-configs";

export function loadProviderConfigs(): ProviderConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

export function saveProviderConfigs(configs: ProviderConfig[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
}

export function getProviderConfig(provider: string): ProviderConfig | undefined {
  return loadProviderConfigs().find((c) => c.provider === provider);
}
