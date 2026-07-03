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
  | "logs";

export const SECTION_GROUPS = [
  {
    category: "Application",
    items: [
      { id: "general", label: "General", icon: SettingsIcon },
      { id: "appearance", label: "Appearance", icon: Sun },
      { id: "marketplace", label: "Theme Marketplace", icon: Store },
      { id: "keybinds", label: "Keyboard Shortcuts", icon: Keyboard },
      { id: "privacy", label: "Privacy & Security", icon: Shield },
    ],
  },
  {
    category: "AI & Models",
    items: [
      { id: "models", label: "Model Providers", icon: Plug },
      { id: "configuration", label: "Chat Settings", icon: Sliders },
      { id: "personalization", label: "System Prompts", icon: MessageSquareText },
      { id: "whisper", label: "Voice Input", icon: Mic },
    ],
  },
  {
    category: "Integrations",
    items: [
      { id: "mcp", label: "MCP Servers", icon: Cpu },
      { id: "browser", label: "Web Search", icon: Search },
      { id: "appshots", label: "Appshots", icon: Camera },
    ],
  },
  {
    category: "Developer",
    items: [
      { id: "projects", label: "Workspace Projects", icon: Folder },
      { id: "logs", label: "Activity Log", icon: FileText },
    ],
  },
];
