import {
  Settings as SettingsIcon,
  Sun,
  Sliders,
  MessageSquareText,
  Terminal,
  Image,
  Cpu,
  Search,
  Plug,
  GitBranch,
  FileText,
} from "lucide-react";

export type SectionId =
  | "general"
  | "appearance"
  | "configuration"
  | "personalization"
  | "shortcuts"
  | "appshots"
  | "mcp"
  | "browser"
  | "computer"
  | "hooks"
  | "models"
  | "git"
  | "environments"
  | "worktrees"
  | "search"
  | "logs";

export const SECTION_GROUPS = [
  {
    category: "Personal",
    items: [
      { id: "general", label: "General", icon: SettingsIcon },
      { id: "appearance", label: "Appearance", icon: Sun },
      { id: "configuration", label: "Configuration", icon: Sliders },
      { id: "personalization", label: "Personalization", icon: MessageSquareText },
      { id: "shortcuts", label: "Keyboard shortcuts", icon: Terminal },
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
      { id: "git", label: "Git", icon: GitBranch },
      { id: "logs", label: "Activity Log", icon: FileText },
    ],
  },
];
