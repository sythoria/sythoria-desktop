export const PROVIDER_PRESETS = [
  {
    providerId: "openai",
    label: "OpenAI",
    apiBase: "https://api.openai.com/v1/chat/completions",
    defaultModel: "gpt-4o",
  },
  {
    providerId: "gemini",
    label: "Google Gemini",
    apiBase: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    defaultModel: "gemini-2.5-pro",
  },
  {
    providerId: "anthropic",
    label: "Anthropic",
    apiBase: "https://api.anthropic.com/v1/messages",
    defaultModel: "claude-opus-4-8",
  },
  {
    providerId: "ollama",
    label: "Ollama (Local)",
    apiBase: "http://localhost:11434/v1/chat/completions",
    defaultModel: "llama3.1",
  },
  {
    providerId: "nim",
    label: "NVIDIA NIM",
    apiBase: "https://integrate.api.nvidia.com/v1/chat/completions",
    defaultModel: "meta/llama-3.3-70b-instruct",
  },
  {
    providerId: "openrouter",
    label: "OpenRouter",
    apiBase: "https://openrouter.ai/api/v1/chat/completions",
    defaultModel: "anthropic/claude-3.5-sonnet",
  },
  { providerId: "custom", label: "Custom", apiBase: "", defaultModel: "" },
] as const;
