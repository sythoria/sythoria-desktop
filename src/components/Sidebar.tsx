import {
  MessageSquarePlus,
  Settings,
  MessageSquare,
  X,
} from "lucide-react";
import type { Conversation } from "../types";

interface SidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onSettingsClick: () => void;
  isOpen: boolean;
  onClose: () => void;
}

function groupConversations(conversations: Conversation[]) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const lastWeek = new Date(today.getTime() - 7 * 86400000);

  const groups: { label: string; items: Conversation[] }[] = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Last 7 days", items: [] },
    { label: "Older", items: [] },
  ];

  for (const conv of conversations) {
    const d = new Date(conv.timestamp);
    if (d >= today) groups[0].items.push(conv);
    else if (d >= yesterday) groups[1].items.push(conv);
    else if (d >= lastWeek) groups[2].items.push(conv);
    else groups[3].items.push(conv);
  }

  return groups.filter((g) => g.items.length > 0);
}

export default function Sidebar({
  conversations,
  activeId,
  onSelect,
  onNewChat,
  onSettingsClick,
  isOpen,
  onClose,
}: SidebarProps) {
  const groups = groupConversations(conversations);

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-20 md:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`
          fixed md:relative z-30 h-full flex flex-col
          bg-sidebar border-r border-border
          transition-transform duration-200 ease-out
          ${isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
        `}
        style={{ width: 260 }}
      >
        <div className="flex items-center justify-between px-4 py-4">
          <h1 className="text-lg font-semibold tracking-tight text-text-primary">
            Sythoria
          </h1>
          <button
            onClick={onClose}
            className="md:hidden p-1 rounded-md hover:bg-hover text-text-muted transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-3 mb-2">
          <button
            onClick={onNewChat}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg
              bg-accent hover:bg-accent-hover text-white
              text-sm font-medium transition-colors duration-150"
          >
            <MessageSquarePlus size={16} />
            New Chat
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-1">
          {groups.map((group) => (
            <div key={group.label} className="mb-3">
              <p className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider text-text-muted">
                {group.label}
              </p>
              {group.items.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => onSelect(conv.id)}
                  className={`
                    w-full flex items-center gap-2 px-2.5 py-2 rounded-lg
                    text-sm text-left transition-colors duration-100
                    ${
                      activeId === conv.id
                        ? "bg-accent-soft text-accent"
                        : "text-text-secondary hover:bg-hover hover:text-text-primary"
                    }
                  `}
                >
                  <MessageSquare size={14} className="shrink-0" />
                  <span className="truncate">{conv.title}</span>
                </button>
              ))}
            </div>
          ))}

          {conversations.length === 0 && (
            <p className="px-2 py-4 text-sm text-text-muted text-center">
              No conversations yet
            </p>
          )}
        </nav>

        <div className="px-3 py-3 border-t border-border">
          <button
            onClick={onSettingsClick}
            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg
              text-sm text-text-secondary hover:bg-hover hover:text-text-primary
              transition-colors duration-100"
          >
            <Settings size={14} />
            Settings
          </button>
        </div>
      </aside>
    </>
  );
}
