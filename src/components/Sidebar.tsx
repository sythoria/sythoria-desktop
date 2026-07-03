import {
  MessageSquarePlus,
  Settings,
  MessageSquare,
  X,
  Pencil,
  Trash2,
  Search,
  Download,
  MoreVertical,
  Folder,
  FolderPlus,
  ChevronDown,
  ChevronRight,
  ArrowLeft,
  Pin,
} from "lucide-react";
import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import type { Conversation } from "../types";
import { STATUS_COLORS } from "../types";
import type { ModelStatuses, ConnectionStatus } from "../types";
import { ConfirmModal } from "./ui/Modal";
import { useDebounce } from "../hooks/useDebounce";
import { COLLAPSED_SIDEBAR_WIDTH } from "../config/constants";
import { useUIStore } from "../store/useUIStore";
import { useKeybindStore } from "../store/useKeybindStore";
import { useProjectStore } from "../store/useProjectStore";
import { SECTION_GROUPS, SectionId } from "./settings/types";
import { springs, motionTokens } from "../lib/motion-tokens";

const STATUS_LABELS: Record<ConnectionStatus, string> = {
  disconnected: "Disconnected",
  connecting: "Connecting\u2026",
  connected: "Connected",
  error: "Connection error",
};

interface SidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onSettingsClick: () => void;
  onDeleteChat: (id: string) => void;
  onRenameChat: (id: string, newTitle: string) => void;
  onExportChat: (id: string) => void;
  onPinChat: (id: string) => void;
  isOpen: boolean;
  onClose: () => void;
  modelStatuses: ModelStatuses;
  isCollapsed: boolean;
}

function groupConversations(conversations: Conversation[]) {
  const pinned: Conversation[] = [];
  const recents: Conversation[] = [];

  for (const conv of conversations) {
    if (conv.isPinned) {
      pinned.push(conv);
    } else {
      recents.push(conv);
    }
  }

  const groups: { label: string; items: Conversation[] }[] = [];
  if (pinned.length > 0) {
    groups.push({ label: "Pinned", items: pinned });
  }

  const hasAnyConversations = conversations.length > 0;
  if (recents.length > 0 || (pinned.length > 0 && hasAnyConversations)) {
    groups.push({ label: "Recents", items: recents });
  }
  return groups;
}

export default function Sidebar({
  conversations,
  activeId,
  onSelect,
  onNewChat,
  onSettingsClick,
  onDeleteChat,
  onRenameChat,
  onExportChat,
  onPinChat,
  isOpen,
  onClose,
  modelStatuses,
  isCollapsed,
}: SidebarProps) {
  const view = useUIStore((s) => s.view);
  const setView = useUIStore((s) => s.setView);
  const activeSection = useUIStore((s) => s.activeSection) as SectionId;
  const setActiveSection = useUIStore((s) => s.setActiveSection);
  const openProjectConfigModal = useUIStore((s) => s.openProjectConfigModal);
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth);
  const disableBgActivity = useUIStore((s) => s.disableBgActivity);

  const { projects, deleteProject, activeProjectId, setActiveProject, isProjectsEnabled } = useProjectStore();
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [showProjectMenu, setShowProjectMenu] = useState(false);
  const projectMenuRef = useRef<HTMLDivElement>(null);

  const toggleProject = (id: string) => {
    setExpandedProjects((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const zoomLevel = useKeybindStore((s) => s.zoomLevel);
  const [showZoom, setShowZoom] = useState(false);
  const prevZoom = useRef(zoomLevel);

  useEffect(() => {
    if (zoomLevel !== prevZoom.current) {
      prevZoom.current = zoomLevel;
      setShowZoom(true);
      const timer = setTimeout(() => {
        setShowZoom(false);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [zoomLevel]);

  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const isSidebarCollapsed = isMobile && isOpen ? false : isCollapsed;

  const isDragging = useRef(false);

  const resize = useCallback(
    (e: MouseEvent) => {
      if (!isDragging.current) return;
      const newWidth = Math.max(180, Math.min(480, e.clientX));
      setSidebarWidth(newWidth);
    },
    [setSidebarWidth],
  );

  const stopResize = useCallback(
    function stopResizeFn() {
      isDragging.current = false;
      document.removeEventListener("mousemove", resize);
      document.removeEventListener("mouseup", stopResizeFn);
    },
    [resize],
  );

  const startResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      document.addEventListener("mousemove", resize);
      document.addEventListener("mouseup", stopResize);
    },
    [resize, stopResize],
  );

  useEffect(() => {
    return () => {
      document.removeEventListener("mousemove", resize);
      document.removeEventListener("mouseup", stopResize);
    };
  }, [resize, stopResize]);

  const [searchQuery, setSearchQuery] = useState("");
  const [chatToDelete, setChatToDelete] = useState<string | null>(null);
  const [projectToDelete, setProjectToDelete] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const debouncedQuery = useDebounce(searchQuery);
  const searchRef = useRef<HTMLInputElement>(null);

  const nonEmptyConversations = useMemo(
    () => conversations.filter((c) => c.messages.length > 0 && !c.id.startsWith("compare-")),
    [conversations],
  );

  const filteredConversations = useMemo(() => {
    if (!debouncedQuery.trim()) return nonEmptyConversations;
    const query = debouncedQuery.toLowerCase();
    return nonEmptyConversations.filter(
      (conv) =>
        conv.title.toLowerCase().includes(query) || conv.messages.some((m) => m.content.toLowerCase().includes(query)),
    );
  }, [nonEmptyConversations, debouncedQuery]);

  const globalConversations = useMemo(() => filteredConversations.filter((c) => !c.projectId), [filteredConversations]);

  const groups = useMemo(() => groupConversations(globalConversations), [globalConversations]);

  const projectConversations = useMemo(() => {
    const map: Record<string, typeof filteredConversations> = {};
    for (const conv of filteredConversations) {
      if (conv.projectId) {
        if (!map[conv.projectId]) map[conv.projectId] = [];
        map[conv.projectId].push(conv);
      }
    }
    return map;
  }, [filteredConversations]);

  const handleDeleteConfirm = useCallback(() => {
    if (chatToDelete) {
      onDeleteChat(chatToDelete);
      setChatToDelete(null);
    }
  }, [chatToDelete, onDeleteChat]);

  const handleDeleteProjectConfirm = useCallback(() => {
    if (projectToDelete) {
      deleteProject(projectToDelete);
      setProjectToDelete(null);
    }
  }, [projectToDelete, deleteProject]);

  useEffect(() => {
    if (openMenuId === null && !showProjectMenu) return;
    const handleOutsideAction = (e: Event) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
      if (projectMenuRef.current && !projectMenuRef.current.contains(e.target as Node)) {
        setShowProjectMenu(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideAction);
    window.addEventListener("scroll", handleOutsideAction, true);
    return () => {
      document.removeEventListener("mousedown", handleOutsideAction);
      window.removeEventListener("scroll", handleOutsideAction, true);
    };
  }, [openMenuId, showProjectMenu]);

  const aggregateStatus: ConnectionStatus = useMemo(() => {
    const statuses = Object.values(modelStatuses);
    if (statuses.length === 0) return "disconnected";
    if (statuses.some((s) => s === "error")) return "error";
    if (statuses.some((s) => s === "connecting")) return "connecting";
    if (statuses.every((s) => s === "connected")) return "connected";
    return "disconnected";
  }, [modelStatuses]);

  const sidebarVariants = {
    expanded: {
      width: sidebarWidth,
      opacity: 1,
      borderRightWidth: 1,
      display: "flex" as const,
      transition: springs.snappy,
    },
    collapsed: {
      width: COLLAPSED_SIDEBAR_WIDTH,
      opacity: 0,
      borderRightWidth: 0,
      transitionEnd: {
        display: "none",
      },
      transition: springs.snappy,
    },
  };

  const contentVariants = {
    expanded: { opacity: 1, x: 0, display: "flex" as const, flexDirection: "column" as const },
    collapsed: { opacity: 0, x: -8, display: "none" as const, flexDirection: "column" as const },
  };

  return (
    <>
      {isOpen && (
        <div
          className="absolute inset-0 z-20 md:hidden backdrop-blur-sm"
          style={{ backgroundColor: "var(--theme-overlay)" }}
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <motion.aside
        className={`
          absolute inset-y-0 left-0 md:relative z-40 h-full flex flex-col overflow-hidden
          glass-sidebar border-r border-border
          ${isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
        `}
        initial={isSidebarCollapsed ? "collapsed" : "expanded"}
        animate={isSidebarCollapsed ? "collapsed" : "expanded"}
        variants={sidebarVariants}
        style={{ width: isSidebarCollapsed ? undefined : sidebarWidth }}
        role="navigation"
        aria-label="Sidebar navigation"
      >
        {/* Header */}
        {view === "settings" ? (
          <div className="flex flex-col justify-start h-14 shrink-0 border-b border-border/30" data-tauri-drag-region>
            <div className="flex items-center h-[32px] pl-[80px] pr-3 gap-2.5">
              <button
                onClick={() => setView("chat")}
                className="p-1 rounded-md text-text-secondary hover:bg-hover hover:text-text-primary transition-colors flex items-center justify-center cursor-pointer"
                aria-label="Back to chat"
                title="Back"
              >
                <ArrowLeft size={16} />
              </button>
              <Settings size={16} className="text-text-muted" />
              <span className="text-sm font-medium text-text-primary">Settings</span>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-end px-3 h-14 shrink-0" data-tauri-drag-region>
            <div className="flex items-center gap-1">
              <button
                onClick={onClose}
                className="md:hidden p-2 rounded-lg hover:bg-hover text-text-muted hover:text-text-secondary transition-colors flex items-center justify-center"
                aria-label="Close sidebar"
              >
                <X size={18} />
              </button>
            </div>
          </div>
        )}{" "}
        {view === "settings" ? (
          <nav className="flex-1 overflow-y-auto p-3 space-y-4" aria-label="Settings sections">
            {SECTION_GROUPS.map((group) => (
              <div key={group.category} className="mb-4">
                <h3 className="text-[11px] font-medium text-text-muted mb-1 px-3">{group.category}</h3>
                <div className="space-y-0.5">
                  {group.items.map((section) => {
                    const Icon = section.icon;
                    const isActive = activeSection === section.id;
                    return (
                      <button
                        key={section.id}
                        onClick={() => setActiveSection(section.id as SectionId)}
                        className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm transition-colors text-left ${
                          isActive
                            ? "bg-active text-text-primary font-medium"
                            : "text-text-secondary hover:bg-hover hover:text-text-primary"
                        }`}
                        aria-current={isActive ? "page" : undefined}
                      >
                        <Icon size={15} className="shrink-0" />
                        <span className="truncate">{section.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        ) : (
          <>
            {/* New Chat Button */}
            <div className="px-3 mb-2">
              <button
                onClick={onNewChat}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-hover text-text-primary text-sm font-medium transition-colors"
                aria-label="Start new chat"
              >
                <MessageSquarePlus size={16} />
                New Chat
              </button>
            </div>

            {/* Search */}
            <div className="px-3 mb-2">
              <div className="relative">
                <Search
                  size={16}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted"
                  aria-hidden="true"
                />
                <label htmlFor="sidebar-search" className="sr-only">
                  Search conversations
                </label>
                <input
                  id="sidebar-search"
                  ref={searchRef}
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search conversations…"
                  className="w-full pl-8 pr-8 py-2 rounded-lg bg-input border border-input-border text-sm text-text-primary placeholder-text-muted focus:border-text-muted focus:outline-none transition-colors"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-hover transition-colors"
                    aria-label="Clear search"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>

            {/* Projects Section */}
            {isProjectsEnabled && (
              <>
                <div className="px-3 mb-2 flex items-center justify-between">
                  <h3 className="text-[11px] font-medium text-text-muted pl-1">Projects</h3>
                  <button
                    className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-hover transition-colors"
                    onClick={() => openProjectConfigModal("create")}
                    aria-label="New Project Workspace"
                    title="Add Project Workspace"
                  >
                    <FolderPlus size={14} />
                  </button>
                </div>

                {projects.length > 0 && (
                  <div className="px-2 mb-4 space-y-0.5">
                    {projects.map((project) => {
                      const isExpanded = expandedProjects[project.id];
                      const pChats = projectConversations[project.id] || [];
                      const isActive = activeProjectId === project.id;

                      return (
                        <div key={project.id} className="flex flex-col">
                          <div className="relative group flex items-center">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleProject(project.id);
                              }}
                              className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-hover transition-colors shrink-0"
                              aria-label={isExpanded ? "Collapse project" : "Expand project"}
                            >
                              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </button>
                            <button
                              onClick={() => {
                                setActiveProject(project.id);
                                toggleProject(project.id);
                              }}
                              className={`flex-1 flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                                isActive
                                  ? "bg-active text-text-primary"
                                  : "text-text-secondary hover:bg-hover hover:text-text-primary"
                              }`}
                            >
                              <Folder size={14} className="shrink-0" />
                              <span className="truncate flex-1 text-left">{project.name}</span>
                            </button>
                            <div className="absolute right-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openProjectConfigModal("edit", project.id);
                                }}
                                className="p-1 rounded bg-black/5 dark:bg-white/5 hover:bg-hover text-text-secondary hover:text-text-primary transition-colors"
                                title="Project Settings"
                              >
                                <Settings size={12} />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setProjectToDelete(project.id);
                                }}
                                className="p-1 rounded bg-black/5 dark:bg-white/5 hover:bg-red-500/10 text-red-500 hover:text-red-500 transition-colors"
                                title="Remove project"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </div>

                          <AnimatePresence initial={false}>
                            {isExpanded && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: "auto", opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="overflow-hidden pl-6 pr-1 space-y-0.5 mt-0.5"
                              >
                                {pChats.length === 0 ? (
                                  <div className="py-1 px-2 text-[11px] text-text-muted">No chats</div>
                                ) : (
                                  pChats.map((conv) => (
                                    <div key={conv.id} className="relative group">
                                      <button
                                        onClick={() => onSelect(conv.id)}
                                        className={`
                                          w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg
                                          text-sm text-left transition-colors duration-100
                                          ${
                                            activeId === conv.id
                                              ? "bg-active text-text-primary font-medium"
                                              : "text-text-secondary hover:bg-hover hover:text-text-primary"
                                          }
                                        `}
                                      >
                                        <MessageSquare size={13} className="shrink-0 opacity-50" />
                                        <span className="truncate flex-1">{conv.title}</span>
                                      </button>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const rect = e.currentTarget.getBoundingClientRect();
                                          setMenuPosition({ top: rect.bottom + 4, left: rect.left - 8 });
                                          setOpenMenuId(openMenuId === conv.id ? null : conv.id);
                                        }}
                                        className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded-md text-text-muted hover:text-text-secondary hover:bg-hover transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 shrink-0"
                                        aria-label="Conversation actions"
                                      >
                                        <MoreVertical size={13} />
                                      </button>
                                      {openMenuId === conv.id &&
                                        menuPosition &&
                                        createPortal(
                                          <div
                                            ref={menuRef}
                                            className="fixed z-50 min-w-[160px] p-1 rounded-xl glass-dropdown border border-border"
                                            style={{
                                              top: `${menuPosition.top}px`,
                                              left: `${menuPosition.left}px`,
                                              boxShadow: "var(--shadow-lg)",
                                            }}
                                            role="menu"
                                          >
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setOpenMenuId(null);
                                                onExportChat(conv.id);
                                              }}
                                              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-text-secondary hover:bg-hover hover:text-text-primary transition-colors"
                                              role="menuitem"
                                            >
                                              <Download size={14} className="text-text-muted" />
                                              Export
                                            </button>
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setOpenMenuId(null);
                                                onRenameChat(conv.id, conv.title);
                                              }}
                                              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-text-secondary hover:bg-hover hover:text-text-primary transition-colors"
                                              role="menuitem"
                                            >
                                              <Pencil size={14} className="text-text-muted" />
                                              Rename
                                            </button>
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setOpenMenuId(null);
                                                setChatToDelete(conv.id);
                                              }}
                                              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-red-500 hover:bg-red-500/10 transition-colors"
                                              role="menuitem"
                                            >
                                              <Trash2 size={14} />
                                              Delete
                                            </button>
                                          </div>,
                                          document.body,
                                        )}
                                    </div>
                                  ))
                                )}
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            {/* Global Conversation List */}
            <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-1 min-h-0" aria-label="Conversation list">
              {isProjectsEnabled && projects.length > 0 && (
                <h3 className="px-2 py-1.5 text-[11px] font-medium text-text-muted">Global chats</h3>
              )}
              <AnimatePresence mode="popLayout">
                {groups.map((group) => (
                  <motion.div
                    key={group.label}
                    variants={contentVariants}
                    initial="collapsed"
                    animate="expanded"
                    exit="collapsed"
                    transition={{ duration: motionTokens.duration.fast }}
                    className="mb-2"
                  >
                    <p className="px-2 py-1.5 text-[11px] font-medium text-text-muted">{group.label}</p>
                    {group.items.length === 0 ? (
                      <p className="px-2.5 py-1.5 text-xs text-text-muted italic">No recent chats</p>
                    ) : (
                      group.items.map((conv) => (
                        <div key={conv.id} className="relative group">
                          <button
                            onClick={() => onSelect(conv.id)}
                            className={`
                              w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg
                              text-sm text-left transition-colors duration-100 pr-14
                              ${
                                activeId === conv.id
                                  ? "bg-active text-text-primary font-medium"
                                  : "text-text-secondary hover:bg-hover hover:text-text-primary"
                              }
                            `}
                            aria-label={`Open conversation: ${conv.title}`}
                            aria-current={activeId === conv.id ? "page" : undefined}
                          >
                            {group.label === "Pinned" && (
                              <MessageSquare size={14} className="shrink-0" aria-hidden="true" />
                            )}
                            <span className="truncate flex-1">{conv.title}</span>
                          </button>
                          <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onPinChat(conv.id);
                              }}
                              className="p-1 rounded-md text-text-muted hover:text-text-secondary hover:bg-hover transition-colors"
                              title={conv.isPinned ? "Unpin conversation" : "Pin conversation"}
                              aria-label={conv.isPinned ? "Unpin conversation" : "Pin conversation"}
                            >
                              <Pin size={13} className={conv.isPinned ? "text-accent fill-accent" : ""} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                const rect = e.currentTarget.getBoundingClientRect();
                                setMenuPosition({
                                  top: rect.bottom + 4,
                                  left: rect.left - 8,
                                });
                                setOpenMenuId(openMenuId === conv.id ? null : conv.id);
                              }}
                              className="p-1 rounded-md text-text-muted hover:text-text-secondary hover:bg-hover transition-colors"
                              aria-label="Conversation actions"
                            >
                              <MoreVertical size={14} />
                            </button>
                          </div>
                          {openMenuId === conv.id &&
                            menuPosition &&
                            createPortal(
                              <div
                                ref={menuRef}
                                className="fixed z-50 min-w-[160px] p-1 rounded-xl glass-dropdown border border-border"
                                style={{
                                  top: `${menuPosition.top}px`,
                                  left: `${menuPosition.left}px`,
                                  boxShadow: "var(--shadow-lg)",
                                }}
                                role="menu"
                              >
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setOpenMenuId(null);
                                    onPinChat(conv.id);
                                  }}
                                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-text-secondary hover:bg-hover hover:text-text-primary transition-colors"
                                  role="menuitem"
                                >
                                  <Pin size={14} className="text-text-muted" />
                                  {conv.isPinned ? "Unpin" : "Pin"}
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setOpenMenuId(null);
                                    onExportChat(conv.id);
                                  }}
                                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-text-secondary hover:bg-hover hover:text-text-primary transition-colors"
                                  role="menuitem"
                                >
                                  <Download size={14} className="text-text-muted" />
                                  Export
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setOpenMenuId(null);
                                    onRenameChat(conv.id, conv.title);
                                  }}
                                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-text-secondary hover:bg-hover hover:text-text-primary transition-colors"
                                  role="menuitem"
                                >
                                  <Pencil size={14} className="text-text-muted" />
                                  Rename
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setOpenMenuId(null);
                                    setChatToDelete(conv.id);
                                  }}
                                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-red-500 hover:bg-red-500/10 transition-colors"
                                  role="menuitem"
                                >
                                  <Trash2 size={14} />
                                  Delete
                                </button>
                              </div>,
                              document.body,
                            )}
                        </div>
                      ))
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>

              {nonEmptyConversations.length === 0 && (
                <p className="px-2 py-4 text-sm text-text-muted text-center">No conversations yet</p>
              )}
            </nav>

            {/* Bottom Section */}
            <div className="px-3 py-3 border-t border-border flex flex-col gap-1 shrink-0">
              {/* Connection Status */}
              {!disableBgActivity && (
                <div
                  className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm text-text-muted"
                  role="status"
                  aria-label={`Connection status: ${STATUS_LABELS[aggregateStatus]}`}
                >
                  <div
                    className={`w-2 h-2 rounded-full shrink-0 ${STATUS_COLORS[aggregateStatus]}`}
                    aria-hidden="true"
                  />
                  <span>{STATUS_LABELS[aggregateStatus]}</span>
                </div>
              )}

              {/* Settings */}
              <button
                onClick={onSettingsClick}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm text-text-secondary hover:bg-hover hover:text-text-primary transition-colors"
                aria-label="Open settings"
              >
                <Settings size={16} aria-hidden="true" />
                Settings
              </button>
            </div>
          </>
        )}
        <AnimatePresence>
          {showZoom && (
            <motion.div
              initial={{ opacity: 0, height: 0, scale: 0.95 }}
              animate={{ opacity: 1, height: "auto", scale: 1 }}
              exit={{ opacity: 0, height: 0, scale: 0.95 }}
              transition={springs.snappy}
              className="px-6 py-3 border-t border-border bg-accent-soft text-accent flex items-center justify-between text-xs font-semibold shrink-0"
            >
              <span>Scale / Zoom</span>
              <span>{Math.round(zoomLevel * 100)}%</span>
            </motion.div>
          )}
        </AnimatePresence>
        {/* Resize Handle */}
        {!isSidebarCollapsed && (
          <div
            className="absolute top-0 right-0 w-1 h-full cursor-col-resize select-none z-50 hover:bg-accent/20 active:bg-accent/40 transition-colors"
            onMouseDown={startResize}
          />
        )}
      </motion.aside>

      <ConfirmModal
        isOpen={chatToDelete !== null}
        title="Delete Chat"
        message="Are you sure you want to delete this chat? This action cannot be undone."
        confirmText="Delete"
        variant="danger"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setChatToDelete(null)}
      />

      <ConfirmModal
        isOpen={projectToDelete !== null}
        title="Delete Project"
        message="Are you sure you want to remove this project? This will not delete the folder on your disk, but it will remove the project configuration and history from Sythoria."
        confirmText="Remove"
        variant="danger"
        onConfirm={handleDeleteProjectConfirm}
        onCancel={() => setProjectToDelete(null)}
      />
    </>
  );
}
