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
};

export const MODELS: Model[] = [
  { id: "claude-4-sonnet", name: "Claude 4 Sonnet", provider: "Anthropic" },
  { id: "gpt-4o", name: "GPT-4o", provider: "OpenAI" },
  { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", provider: "Google" },
  { id: "llama3.1", name: "Llama 3.1", provider: "Ollama" },
];
