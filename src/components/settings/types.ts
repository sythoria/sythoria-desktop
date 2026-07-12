import {
  Settings as SettingsIcon,
  Sun,
  Sliders,
  MessageSquareText,
  Keyboard,
  Camera,
  Cpu,
  Search,
  Plug,
  Folder,
  FileText,
  Store,
  Shield,
  Mic,
  BookOpen,
} from "lucide-react";

export type SectionId =
  | "general"
  | "appearance"
  | "privacy"
  | "configuration"
  | "personalization"
  | "keybinds"
  | "appshots"
  | "mcp"
  | "browser"
  | "computer"
  | "hooks"
  | "models"
  | "projects"
  | "environments"
  | "worktrees"
  | "search"
  | "marketplace"
  | "whisper"
  | "skills"
  | "logs";

export interface SettingSectionItem {
  id: SectionId;
  label: string;
  icon: any;
  keywords: string[];
}

export interface SettingSectionGroup {
  category: string;
  items: SettingSectionItem[];
}

export const SECTION_GROUPS: SettingSectionGroup[] = [
  {
    category: "Application",
    items: [
      {
        id: "general",
        label: "General",
        icon: SettingsIcon,
        keywords: ["language", "startup", "autostart", "close to tray", "system tray", "reset"],
      },
      {
        id: "appearance",
        label: "Appearance",
        icon: Sun,
        keywords: ["theme", "dark", "light", "colors", "accent", "animations", "custom theme", "presets"],
      },
      {
        id: "marketplace",
        label: "Theme Marketplace",
        icon: Store,
        keywords: ["themes", "vs code", "download", "community", "styles", "install"],
      },
      {
        id: "keybinds",
        label: "Keyboard Shortcuts",
        icon: Keyboard,
        keywords: ["shortcuts", "keys", "hotkeys", "keyboard", "zoom", "map"],
      },
      {
        id: "privacy",
        label: "Privacy & Security",
        icon: Shield,
        keywords: ["network", "proxy", "offline", "strict ssl", "blocked hosts", "ip address", "security"],
      },
    ],
  },
  {
    category: "AI & Models",
    items: [
      {
        id: "models",
        label: "Model Providers",
        icon: Plug,
        keywords: [
          "providers",
          "openai",
          "anthropic",
          "gemini",
          "ollama",
          "openrouter",
          "api keys",
          "endpoints",
          "connection",
        ],
      },
      {
        id: "configuration",
        label: "Chat Settings",
        icon: Sliders,
        keywords: ["chat settings", "temperature", "max tools", "steps", "defaults", "model selector"],
      },
      {
        id: "personalization",
        label: "System Prompts",
        icon: MessageSquareText,
        keywords: ["system prompts", "instructions", "title generation", "custom prompts"],
      },
      {
        id: "whisper",
        label: "Voice Input",
        icon: Mic,
        keywords: ["voice input", "speech to text", "transcribe", "stt", "audio", "recording", "gguf", "whisper"],
      },
    ],
  },
  {
    category: "Integrations",
    items: [
      {
        id: "mcp",
        label: "MCP Servers",
        icon: Cpu,
        keywords: ["mcp", "servers", "tools", "model context protocol", "stdio", "sse", "env", "secrets"],
      },
      {
        id: "browser",
        label: "Web Search",
        icon: Search,
        keywords: ["web search", "google", "firecrawl", "jina", "fetch url", "searxng", "jina reader", "search preset"],
      },
      {
        id: "appshots",
        label: "Appshots",
        icon: Camera,
        keywords: ["screen capture", "screenshots", "gallery", "auto-clean", "quality", "format", "images"],
      },
    ],
  },
  {
    category: "Developer",
    items: [
      {
        id: "projects",
        label: "Workspace Projects",
        icon: Folder,
        keywords: ["workspace", "directories", "git repo", "worktree", "permissions", "auto commit"],
      },
      {
        id: "skills",
        label: "Agent Skills",
        icon: BookOpen,
        keywords: ["agents", "customizations", "slash commands", "SKILL.md", "tools"],
      },
      {
        id: "logs",
        label: "Activity Log",
        icon: FileText,
        keywords: ["activity log", "debug", "warn", "error", "console", "Tauri", "logs", "view logs"],
      },
    ],
  },
];
