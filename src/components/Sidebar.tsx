import { MessageSquarePlus, Settings, MessageSquare, X, Pencil, Trash2, Search } from "lucide-react";
import { useMemo, useState, useCallback } from "react";
import type { Conversation } from "../types";
import { STATUS_COLORS } from "../types";
import type { ModelStatuses, ConnectionStatus } from "../types";
import { ConfirmModal } from "./ui/Modal";
import { useDebounce } from "../hooks/useDebounce";
import { SIDEBAR_WIDTH } from "../config/constants";

interface SidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onSettingsClick: () => void;
  onDeleteChat: (id: string) => void;
  onRenameChat: (id: string, newTitle: string) => void;
  isOpen: boolean;
  onClose: () => void;
  modelStatuses: ModelStatuses;
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
  onDeleteChat,
  onRenameChat,
  isOpen,
  onClose,
  modelStatuses,
}: SidebarProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [chatToDelete, setChatToDelete] = useState<string | null>(null);
  const debouncedQuery = useDebounce(searchQuery);

  const nonEmptyConversations = useMemo(() => conversations.filter((c) => c.messages.length > 0), [conversations]);

  const filteredConversations = useMemo(() => {
    if (!debouncedQuery.trim()) return nonEmptyConversations;
    const query = debouncedQuery.toLowerCase();
    return nonEmptyConversations.filter(
      (conv) =>
        conv.title.toLowerCase().includes(query) || conv.messages.some((m) => m.content.toLowerCase().includes(query)),
    );
  }, [nonEmptyConversations, debouncedQuery]);

  const groups = useMemo(() => groupConversations(filteredConversations), [filteredConversations]);

  const handleDeleteConfirm = useCallback(() => {
    if (chatToDelete) {
      onDeleteChat(chatToDelete);
      setChatToDelete(null);
    }
  }, [chatToDelete, onDeleteChat]);

  const aggregateStatus: ConnectionStatus = useMemo(() => {
    const statuses = Object.values(modelStatuses);
    if (statuses.length === 0) return "disconnected";
    if (statuses.some((s) => s === "error")) return "error";
    if (statuses.some((s) => s === "connecting")) return "connecting";
    if (statuses.every((s) => s === "connected")) return "connected";
    return "disconnected";
  }, [modelStatuses]);

  return (
    <>
      {isOpen && <div className="fixed inset-0 bg-black/50 z-20 md:hidden" onClick={onClose} />}

      <aside
        className={`
          fixed md:relative z-30 h-full flex flex-col
          glass-sidebar border-r border-border
          transition-transform duration-200 ease-out
          ${isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
        `}
        style={{ width: SIDEBAR_WIDTH }}
      >
        <div className="flex items-center justify-between px-4 py-4">
          <h1 className="text-lg font-semibold tracking-tight text-text-primary">Sythoria</h1>
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

        <div className="px-3 mb-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search conversations..."
              className="w-full pl-8 pr-3 py-2 rounded-lg bg-input border border-input-border text-sm text-text-primary placeholder-text-muted focus:border-accent/50 focus:outline-none transition-colors"
            />
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-1">
          {groups.map((group) => (
            <div key={group.label} className="mb-3">
              <p className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider text-text-muted">
                {group.label}
              </p>
              {group.items.map((conv) => (
                <div key={conv.id} className="relative group">
                  <button
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
                    <span className="truncate group-hover:pr-12 transition-[padding] duration-100">{conv.title}</span>
                  </button>
                  <div className="absolute right-0 top-0 mt-2 mr-2 flex space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onRenameChat(conv.id, conv.title);
                      }}
                      className="p-1 rounded hover:text-text-secondary hover:bg-hover/50 transition-colors"
                      title="Rename chat"
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setChatToDelete(conv.id);
                      }}
                      className="p-1 rounded hover:text-red-500 hover:bg-red-500/20 transition-colors"
                      title="Delete chat"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ))}

          {nonEmptyConversations.length === 0 && (
            <p className="px-2 py-4 text-sm text-text-muted text-center">No conversations yet</p>
          )}
        </nav>

        <div className="px-3 py-3 border-t border-border flex flex-col gap-2">
          <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-[11px] text-text-muted">
            <div className={`w-2 h-2 rounded-full ${STATUS_COLORS[aggregateStatus]}`} />
            <span className="capitalize">{aggregateStatus}</span>
          </div>
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

      <ConfirmModal
        isOpen={chatToDelete !== null}
        title="Delete Chat"
        message="Are you sure you want to delete this chat? This action cannot be undone."
        confirmText="Delete"
        variant="danger"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setChatToDelete(null)}
      />
    </>
  );
}
