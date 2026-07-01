import {
  Settings as SettingsIcon,
  Sun,
  Sliders,
  MessageSquareText,
  Keyboard,
  Image,
  Cpu,
  Search,
  Plug,
  Folder,
  FileText,
  Store,
  Shield,
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
  | "logs";

export const SECTION_GROUPS = [
  {
    category: "Personal",
    items: [
      { id: "general", label: "General", icon: SettingsIcon },
      { id: "appearance", label: "Appearance", icon: Sun },
      { id: "privacy", label: "Privacy & Security", icon: Shield },
      { id: "configuration", label: "Configuration", icon: Sliders },
      { id: "personalization", label: "Personalization", icon: MessageSquareText },
      { id: "marketplace", label: "Theme Marketplace", icon: Store },
      { id: "keybinds", label: "Keybinds", icon: Keyboard },
    ],
  },
  {
    category: "Integrations",
    items: [
      { id: "appshots", label: "Appshots", icon: Image },
      { id: "mcp", label: "MCP servers", icon: Cpu },
      { id: "browser", label: "Browser", icon: Search },
    ],
  },
  {
    category: "Coding",
    items: [
      { id: "models", label: "Connections", icon: Plug },
      { id: "projects", label: "Projects", icon: Folder },
      { id: "logs", label: "Activity Log", icon: FileText },
    ],
  },
];
