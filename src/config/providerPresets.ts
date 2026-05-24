export const PROVIDER_PRESETS = [
  { label: "OpenAI", apiBase: "https://api.openai.com/v1/chat/completions", defaultModel: "gpt-4o" },
  {
    label: "Google Gemini",
    apiBase: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    defaultModel: "gemini-2.5-pro",
  },
  { label: "Ollama (Local)", apiBase: "http://localhost:11434/v1/chat/completions", defaultModel: "llama3.1" },
  {
    label: "NVIDIA NIM",
    apiBase: "https://integrate.api.nvidia.com/v1/chat/completions",
    defaultModel: "meta/llama-3.3-70b-instruct",
  },
  {
    label: "OpenRouter",
    apiBase: "https://openrouter.ai/api/v1/chat/completions",
    defaultModel: "anthropic/claude-3.5-sonnet",
  },
  { label: "Custom", apiBase: "", defaultModel: "" },
] as const;
