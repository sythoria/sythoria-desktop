import { useState, useEffect, useRef, memo, useCallback, useMemo, useDeferredValue, isValidElement } from "react";
import { motion, AnimatePresence } from "motion/react";
import ReactMarkdown from "react-markdown";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useUIStore } from "../store/useUIStore";
import { useChatStore } from "../store/useChatStore";
import { useProjectStore } from "../store/useProjectStore";
import { useTranslation } from "../utils/i18n";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import {
  Copy,
  Check,
  Search,
  Globe,
  Wrench,
  ChevronDown,
  Loader2,
  ExternalLink,
  Sparkles,
  RotateCw,
  Terminal,
  FileText as FileTextIcon,
  File,
  FileCode,
  FileJson,
  Atom,
  Palette,
  Eye,
  GitBranch,
  Trash2,
  Ghost,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  Users,
} from "lucide-react";
import { QuestionCard } from "./ui/QuestionCard";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import type { Message, GenerationState, Attachment } from "../types";
import { highlightCode } from "../utils/highlighter";
import { springs, motionTokens } from "../lib/motion-tokens";
import { formatFileSize } from "../utils/attachments";
import { parseReasoning } from "../utils/messageParser";
import { ImagePreviewModal } from "./ui/ImagePreviewModal";

const messageVariants = {
  hidden: { opacity: 0, y: motionTokens.distance.sm },
  visible: { opacity: 1, y: 0 },
};

interface ChatAreaProps {
  messages: Message[];
  setIsAtBottom?: (v: boolean) => void;
  virtuosoRef?: React.RefObject<VirtuosoHandle | null>;
  onRetry?: () => void;
  generationState: GenerationState;
  onScroll?: (scrollTop: number, ratio: number) => void;
  conversationId?: string;
  pendingWorktree?: { path: string; branch: string };
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
  autoExpandReasoning?: boolean;
  showEmptyState?: boolean;
}

function CancelledBar({ content, onRetry }: { content: string; onRetry?: () => void }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard not available */
    }
  }, [content]);

  return (
    <div className="flex items-center gap-2 py-1.5 select-none">
      <span className="text-xs font-medium text-text-muted">Cancelled</span>
      <ActionButton
        icon={<Copy size={14} />}
        activeIcon={<Check size={14} className="text-emerald-500" />}
        active={copied}
        label={copied ? "Copied" : "Copy"}
        onClick={handleCopy}
      />
      {onRetry && <ActionButton icon={<RotateCw size={14} />} label="Regenerate" onClick={onRetry} />}
    </div>
  );
}

function SyntaxCodeBlock({ code, language, maxHeight }: { code: string; language: string; maxHeight?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [highlighted, setHighlighted] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    highlightCode(code, language).then((html) => {
      if (!cancelled && html) {
        setHighlighted(html);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [code, language]);

  const handleCopy = useCallback(async () => {
    try {
      const text = ref.current?.textContent || code;
      await navigator.clipboard.writeText(text.replace(/\n$/, ""));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard not available */
    }
  }, [code]);

  const isPreviewable = language === "html" || language === "svg" || language === "mermaid";
  const setActiveArtifact = useUIStore((s) => s.setActiveArtifact);
  const isProjectsEnabled = useProjectStore((s) => s.isProjectsEnabled);

  const handlePreview = useCallback(() => {
    setActiveArtifact({
      title: `${language.toUpperCase()} Preview`,
      content: code,
      type: language as "html" | "svg" | "mermaid",
    });
  }, [code, language, setActiveArtifact]);

  return (
    <div className="code-block group relative bg-surface border border-border rounded-xl overflow-hidden shadow-sm my-3">
      <div className="flex items-center justify-between px-4 py-1.5 text-[11px] text-text-muted border-b border-border/40 select-none">
        <span className="flex items-center gap-1.5 font-mono lowercase">
          <Terminal size={12} />
          {language}
        </span>
        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          {isProjectsEnabled && isPreviewable && (
            <motion.button
              onClick={handlePreview}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-text-muted hover:text-text-secondary hover:bg-hover transition-colors cursor-pointer"
              aria-label="Preview content"
              whileHover={{ scale: motionTokens.scale.pop }}
              whileTap={{ scale: motionTokens.scale.press }}
              transition={springs.snappy}
            >
              <Eye size={12} />
              <span>Preview</span>
            </motion.button>
          )}
          <motion.button
            onClick={handleCopy}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-text-muted hover:text-text-secondary hover:bg-hover transition-colors cursor-pointer"
            aria-label={copied ? "Copied" : "Copy code"}
            whileHover={{ scale: motionTokens.scale.pop }}
            whileTap={{ scale: motionTokens.scale.press }}
            transition={springs.snappy}
          >
            {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
            {copied ? "Copied" : "Copy"}
          </motion.button>
        </div>
      </div>
      {highlighted ? (
        <div
          ref={ref}
          className="code-block-content"
          style={maxHeight ? { maxHeight, overflowY: "auto" } : undefined}
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      ) : (
        <div ref={ref} className="code-block-content" style={maxHeight ? { maxHeight, overflowY: "auto" } : undefined}>
          <code className={`language-${language}`}>{code}</code>
        </div>
      )}
    </div>
  );
}

async function openSafeUrl(href: string): Promise<void> {
  try {
    const url = new URL(href);
    const scheme = url.protocol.toLowerCase();
    if (scheme !== "http:" && scheme !== "https:" && scheme !== "mailto:") {
      console.warn("Blocked opening disallowed scheme:", scheme);
      return;
    }
    if (scheme !== "https:") {
      const confirm = window.confirm(`Security Warning: You are about to open a non-secure link (${href}). Proceed?`);
      if (!confirm) return;
    }
    await openUrl(href);
  } catch {
    if (href.startsWith("mailto:")) {
      const confirm = window.confirm(`Proceed to open email client for (${href})?`);
      if (!confirm) return;
      await openUrl(href);
    } else {
      console.error("Invalid URL format:", href);
    }
  }
}

const markdownComponents = {
  pre({ children }: React.HTMLAttributes<HTMLPreElement> & { children?: React.ReactNode }) {
    // Return Fragment to avoid nesting <pre> inside .markdown-body pre (double border bug)
    return <>{children}</>;
  },
  code({ children, className, ...props }: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) {
    const isBlock = className?.startsWith("language-");
    if (isBlock) {
      const match = /language-(\w+)/.exec(className || "");
      const language = match ? match[1] : "text";
      const codeStr = extractText(children);
      return <SyntaxCodeBlock code={codeStr} language={language} />;
    }
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
  a({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children?: React.ReactNode }) {
    const handleLinkClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault();
      if (href) {
        const { skipExternalLinkWarning, setShowLinkWarningModal } = useUIStore.getState();
        if (skipExternalLinkWarning) {
          openSafeUrl(href);
        } else {
          setShowLinkWarningModal(true, href);
        }
      }
    };
    return (
      <a href={href} onClick={handleLinkClick} target="_blank" rel="noopener noreferrer" {...props}>
        {children}
      </a>
    );
  },
};

function extractText(children: React.ReactNode): string {
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(extractText).join("");
  if (isValidElement<{ children?: React.ReactNode }>(children)) {
    return extractText(children.props.children);
  }
  return "";
}

const StreamingMarkdown = memo(function StreamingMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={markdownComponents}
      skipHtml
    >
      {content}
    </ReactMarkdown>
  );
});

function MessageContent({
  content,
  isStreaming,
}: {
  content: string;
  isStreaming: boolean;
  conversationId?: string;
  role?: string;
}) {
  const deferredContent = useDeferredValue(content);
  const renderContent = isStreaming ? deferredContent : content;

  return (
    <>
      <StreamingMarkdown content={renderContent} />
      {isStreaming && <span className="cursor-blink" aria-label="Generating response" />}
    </>
  );
}

function ActionButton({
  icon,
  label,
  activeIcon,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  activeIcon?: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <motion.button
      onClick={onClick}
      className={`p-1 rounded-md text-text-muted hover:text-text-secondary hover:bg-hover transition-colors flex items-center justify-center ${
        active ? "text-text-primary" : ""
      }`}
      aria-label={label}
      title={label}
      whileHover={{ scale: motionTokens.scale.pop }}
      whileTap={{ scale: motionTokens.scale.press }}
      transition={springs.snappy}
    >
      {active && activeIcon ? activeIcon : icon}
    </motion.button>
  );
}

function MessageActions({
  content,
  sources,
  isUser,
  onSourceClick,
  onRetry,
}: {
  content: string;
  sources?: { title: string; url: string }[];
  isUser: boolean;
  onSourceClick?: () => void;
  onRetry?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard not available */
    }
  }, [content]);

  return (
    <div className="flex items-center gap-0.5 mt-1 -ml-1">
      <ActionButton
        icon={<Copy size={14} />}
        activeIcon={<Check size={14} className="text-emerald-500" />}
        active={copied}
        label={copied ? "Copied" : "Copy"}
        onClick={handleCopy}
      />
      {!isUser && <ActionButton icon={<RotateCw size={14} />} label="Regenerate" onClick={onRetry} />}
      {sources && sources.length > 0 && (
        <>
          <span className="w-px h-3.5 bg-border/50 mx-1" />
          <motion.button
            onClick={onSourceClick}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] text-text-muted hover:text-text-primary hover:bg-hover transition-colors"
            title={`${sources.length} source${sources.length !== 1 ? "s" : ""}`}
            whileHover={{ scale: motionTokens.scale.pop }}
            whileTap={{ scale: motionTokens.scale.press }}
            transition={springs.snappy}
          >
            <Globe size={12} />
            <span>
              {sources.length} source{sources.length !== 1 ? "s" : ""}
            </span>
          </motion.button>
        </>
      )}
    </div>
  );
}

function SourcesList({ sources }: { sources: { title: string; url: string }[] }) {
  return (
    <motion.div
      className="mt-1.5 p-2 rounded-lg bg-surface border border-border"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={springs.gentle}
    >
      <div className="flex flex-wrap gap-1.5">
        {sources.map((s, i) => (
          <motion.a
            key={i}
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] text-text-secondary hover:text-text-primary hover:bg-hover border border-border max-w-[200px] truncate transition-colors"
            title={s.title || s.url}
            whileHover={{ scale: motionTokens.scale.pop }}
            transition={springs.snappy}
          >
            <ExternalLink size={10} className="shrink-0 text-text-muted" />
            <span className="truncate">{s.title || s.url}</span>
          </motion.a>
        ))}
      </div>
    </motion.div>
  );
}

function formatToolName(name: string): string {
  if (name.includes("__")) {
    const parts = name.split("__");
    return parts.length > 1 ? parts.slice(1).join("__") : name;
  }
  if (name.startsWith("project_")) {
    const raw = name.replace("project_", "");
    return raw
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }
  return name;
}

function getNativeToolDisplayInfo(
  name: string,
  args: Record<string, string> | undefined,
  result: any,
  isCompleted: boolean,
  t: (key: string, replacements?: Record<string, string>) => string,
) {
  if (!args) return null;

  if (name === "wait_subagents") {
    return {
      type: "subagent",
      filename: "",
      IconComponent: Users,
      colorClass: "text-text-muted",
      label: isCompleted ? "Subagents Finished" : "Waiting for Subagents",
    };
  }
  if (name === "invoke_subagent") {
    return null;
  }

  // Strictly only target native project tools (start with project_ and must not be MCP tools containing __)
  if (!name.startsWith("project_") || name.includes("__")) return null;

  const cleanName = name.replace("project_", "");
  const lowerName = cleanName.toLowerCase();

  // Helper to determine icon & color
  const getFileIcon = (filename: string) => {
    const ext = filename.split(".").pop()?.toLowerCase();
    let IconComponent = File;
    let colorClass = "text-text-muted";
    if (ext === "tsx" || ext === "jsx") {
      IconComponent = Atom;
      colorClass = "text-cyan-500 dark:text-cyan-400";
    } else if (ext === "ts") {
      IconComponent = FileCode;
      colorClass = "text-blue-500 dark:text-blue-400";
    } else if (ext === "js") {
      IconComponent = FileCode;
      colorClass = "text-amber-500 dark:text-amber-400";
    } else if (ext === "css") {
      IconComponent = Palette;
      colorClass = "text-pink-500 dark:text-pink-400";
    } else if (ext === "json") {
      IconComponent = FileJson;
      colorClass = "text-amber-500 dark:text-amber-400";
    } else if (ext === "md" || ext === "txt") {
      IconComponent = FileTextIcon;
      colorClass = "text-emerald-500 dark:text-emerald-400";
    } else if (ext === "rs") {
      IconComponent = FileCode;
      colorClass = "text-orange-600 dark:text-orange-500";
    } else if (ext === "py") {
      IconComponent = FileCode;
      colorClass = "text-green-600 dark:text-green-500";
    } else if (ext === "html") {
      IconComponent = FileCode;
      colorClass = "text-orange-500 dark:text-orange-400";
    }
    return { IconComponent, colorClass };
  };

  // 1. Bash / Commands
  if (lowerName === "bash" || lowerName === "git_status" || lowerName === "git_diff" || lowerName === "git_commit") {
    let commandStr =
      lowerName === "git_status"
        ? "git status"
        : lowerName === "git_diff"
          ? "git diff"
          : lowerName === "git_commit"
            ? "git commit"
            : args.command;
    if (commandStr && commandStr.length > 40) commandStr = commandStr.substring(0, 40) + "...";
    return {
      type: "bash",
      IconComponent: Terminal,
      colorClass: "text-text-muted",
      label: isCompleted
        ? t("chat.tools.ranCommand", { command: commandStr })
        : t("chat.tools.runningCommand", { command: commandStr }),
    };
  }

  // 2. Read / Explore (grep, glob, read, list_dir)
  const isRead = lowerName === "read";
  const isGrep = lowerName === "grep";
  const isGlob = lowerName === "glob";
  const isList = lowerName === "list_dir";

  if (isRead || isGrep || isGlob || isList) {
    const target = args.file_path || args.pattern || args.dir_path || args.path || "files";
    const filename = target.split(/[/\\]/).pop() || target;
    const { IconComponent, colorClass } = getFileIcon(filename);

    let extraInfo = "";
    if (isRead && args.offset) {
      const start = args.offset;
      const limit = args.limit || 2000;
      extraInfo = ` #L${start}-${Number(start) + Number(limit)}`;
    } else if (isCompleted && result && result.content) {
      try {
        const parsed = JSON.parse(result.content);
        if (isList && Array.isArray(parsed)) {
          extraInfo = " " + t("chat.tools.itemsCount", { count: String(parsed.length) });
        } else if (isGlob && Array.isArray(parsed)) {
          extraInfo = " " + t("chat.tools.matchesCount", { count: String(parsed.length) });
        } else if (isGrep) {
          if (parsed.FilesWithMatches) {
            extraInfo = " " + t("chat.tools.filesCount", { count: String(parsed.FilesWithMatches.length) });
          } else if (parsed.Content) {
            extraInfo = " " + t("chat.tools.linesCount", { count: String(parsed.Content.length) });
          } else if (typeof parsed.Count === "number") {
            extraInfo = " " + t("chat.tools.matchesCount", { count: String(parsed.Count) });
          }
        }
      } catch {
        // ignore
      }
    }

    let label = isCompleted ? t("chat.tools.explored") : t("chat.tools.exploring");
    if (isRead) label = isCompleted ? t("chat.tools.analyzed") : t("chat.tools.analyzing");
    else if (isGrep) label = isCompleted ? t("chat.tools.searchedLabel") : t("chat.tools.searchingLabel");
    else if (isList) label = isCompleted ? t("chat.tools.listed") : t("chat.tools.listing");

    return {
      type: "explore",
      filename,
      IconComponent,
      colorClass,
      label,
      extraInfo,
    };
  }

  // 3. Write / Edit
  const isWriteName = lowerName === "write" || lowerName === "edit";

  if (isWriteName) {
    const pathKeys = ["file_path"];
    for (const key of pathKeys) {
      if (typeof args[key] === "string") {
        const fullPath = args[key];
        const filename = fullPath.split(/[/\\]/).pop() || fullPath;
        const { IconComponent, colorClass } = getFileIcon(filename);

        const isTodo = filename.toLowerCase().includes("todo");

        return {
          type: isTodo ? "todo" : "edit",
          filename,
          IconComponent,
          colorClass,
          label: isCompleted
            ? result?.diffSummary?.isNew
              ? t("chat.tools.created")
              : t("chat.tools.edited")
            : t("chat.tools.editing"),
          isTodo,
        };
      }
    }
  }

  return null;
}

function useSubagentConversationIds(message: Message): string[] {
  return useMemo(() => {
    if (message.toolResult?.subagentIds) {
      return message.toolResult.subagentIds;
    }
    if (message.toolCall?.name === "wait_subagents") {
      try {
        const args =
          typeof message.toolCall.arguments === "string"
            ? JSON.parse(message.toolCall.arguments)
            : message.toolCall.arguments;
        if (Array.isArray(args.conversationIds)) return args.conversationIds as string[];
      } catch {
        // ignore parsing error
      }
    }
    const content = message.toolResult?.content || "";
    const match = content.match(/conversation IDs?:\s*([a-zA-Z0-9-, ]+)/);
    return match
      ? match[1]
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean)
      : [];
  }, [message]);
}

function SubagentEmbeddedChat({ conversationId }: { conversationId: string }) {
  const generationState = useChatStore((s) => s.generationByConversation[conversationId]);
  const conv = useChatStore((s) => s.conversations.find((c) => c.id === conversationId));
  const isProjectsEnabled = useProjectStore((s) => s.isProjectsEnabled);

  if (!conv) {
    return (
      <div className="bg-input/20 border border-border/40 rounded-xl p-3 text-sm text-text-muted">
        No subagent chat found.
      </div>
    );
  }

  const roleLabel = conv.role || conv.title || "Subagent";

  return (
    <div className="border border-border/40 rounded-xl overflow-hidden bg-input/20 flex flex-col">
      <div className="w-full flex items-center justify-between p-3 border-b border-border/40 bg-input/10">
        <div className="flex items-center gap-2 overflow-hidden">
          <span className="font-medium text-text-primary text-sm truncate">{roleLabel}</span>
          {conv.status === "running" ? (
            <span className="flex items-center gap-1 text-[10px] text-accent/80 font-medium px-1.5 py-0.5 bg-accent/10 rounded-full shrink-0">
              <Loader2 size={10} className="animate-spin" />
              RUNNING
            </span>
          ) : conv.status === "error" ? (
            <span className="text-[10px] text-red-500 font-medium px-1.5 py-0.5 bg-red-500/10 rounded-full shrink-0">
              ERROR
            </span>
          ) : (
            <span className="text-[10px] text-emerald-500 font-medium px-1.5 py-0.5 bg-emerald-500/10 rounded-full shrink-0">
              DONE
            </span>
          )}
        </div>
        {isProjectsEnabled && (
          <div className="flex items-center gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                useUIStore.getState().setActiveSubagentId(conv.id);
              }}
              className="px-2 py-1 text-[11px] rounded bg-accent/10 hover:bg-accent/15 text-accent font-medium border border-accent/10 transition-colors flex items-center gap-1 cursor-pointer"
              title="Inspect subagent chat in panel drawer"
            >
              <ExternalLink size={10} />
              Open Drawer
            </button>
          </div>
        )}
      </div>
      <div className="h-[400px] flex flex-col relative w-full overflow-hidden">
        <ChatAreaBase
          messages={conv.messages || []}
          onRetry={() => {}}
          generationState={generationState?.state || "idle"}
          conversationId={conv.id}
        />
      </div>
    </div>
  );
}

function SubagentEmbeddedChats({ message }: { message: Message }) {
  const ids = useSubagentConversationIds(message);
  if (ids.length === 0) {
    return (
      <div className="bg-input/20 border border-border/40 rounded-xl p-3 text-sm text-text-muted">
        No subagent chats found.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 w-full">
      {ids.map((id) => (
        <SubagentEmbeddedChat key={id} conversationId={id} />
      ))}
    </div>
  );
}

function SubagentToolCard({
  message,
  subagentIndex,
  subagentCount,
}: {
  message: Message;
  subagentIndex: number;
  subagentCount: number;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [dots, setDots] = useState(".");
  const isCompleted = !!message.toolResult;
  const ids = useSubagentConversationIds(message);
  const conversationId = ids[subagentIndex];
  const conv = useChatStore((s) => (conversationId ? s.conversations.find((c) => c.id === conversationId) : undefined));
  const roleLabel = conv?.role || conv?.title || `Subagent ${subagentIndex + 1}`;

  const isRunning = !isCompleted || conv?.status === "running";

  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => {
      setDots((prev) => {
        if (prev === "...") return ".";
        if (prev === "..") return "...";
        return "..";
      });
    }, 500);
    return () => clearInterval(interval);
  }, [isRunning]);

  const label = isCompleted ? "Invoked Subagent" : "Invoking Subagent";
  const numbered = subagentCount > 1 ? ` #${subagentIndex + 1}` : "";

  return (
    <div className="flex flex-col max-w-full">
      <div className="flex items-center gap-1.5 text-text-muted select-none">
        <Users size={14} className="shrink-0" aria-hidden="true" />
        <span className="text-sm">
          {label}
          {numbered}
          {roleLabel && <span className="font-medium text-text-primary ml-1.5">— {roleLabel}</span>}
          {isRunning && <span className="ml-1">{dots}</span>}
        </span>

        <motion.button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center justify-center p-0.5 hover:bg-hover rounded text-text-muted hover:text-text-primary transition-colors cursor-pointer"
          aria-label={expanded ? t("chat.tools.collapseTooltip") : t("chat.tools.expandTooltip")}
          whileHover={{ scale: 1.15 }}
          whileTap={{ scale: 0.9 }}
        >
          <ChevronDown size={13} className={`transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
        </motion.button>
      </div>

      <AnimatePresence initial={false}>
        {expanded && conversationId && (
          <motion.div
            key={`subagent-${conversationId}`}
            initial={{ height: 0, opacity: 0, marginTop: 0 }}
            animate={{ height: "auto", opacity: 1, marginTop: 6 }}
            exit={{ height: 0, opacity: 0, marginTop: 0 }}
            transition={{
              type: "tween",
              ease: motionTokens.easing.smooth,
              duration: motionTokens.duration.normal,
            }}
            className="w-full overflow-hidden pl-5"
          >
            <SubagentEmbeddedChat conversationId={conversationId} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ToolCallDisplay({ message }: { message: Message }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [dots, setDots] = useState(".");
  const [previewImageIndex, setPreviewImageIndex] = useState<number | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const { name } = message.toolCall!;
  const isSearch = name === "search_query";
  const isFetch = name === "fetch_url";
  const isProject = name.startsWith("project_");
  const isMcp = name.includes("__");
  const isWaitSubagents = name === "wait_subagents";
  const isCompleted = !!message.toolResult;
  const isCollapsible = isMcp || isProject || isWaitSubagents;

  useEffect(() => {
    if (!isWaitSubagents || isCompleted) return;
    const interval = setInterval(() => {
      setDots((prev) => {
        if (prev === "...") return ".";
        if (prev === "..") return "...";
        return "..";
      });
    }, 500);
    return () => clearInterval(interval);
  }, [isWaitSubagents, isCompleted]);

  if (name === "invoke_subagent") {
    const args = message.toolCall?.arguments || {};
    let subagentCount = 1;
    try {
      const raw = args.subagents;
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (Array.isArray(parsed)) subagentCount = parsed.length;
    } catch {
      // ignore parse error
    }
    if (!isCompleted) subagentCount = Math.max(subagentCount, 1);

    return (
      <div className="flex flex-col gap-0.5">
        {Array.from({ length: subagentCount }).map((_, i) => (
          <SubagentToolCard key={i} message={message} subagentIndex={i} subagentCount={subagentCount} />
        ))}
      </div>
    );
  }

  if (isCollapsible) {
    const formattedArgs = JSON.stringify(message.toolCall?.arguments || {}, null, 2);

    let formattedResult = message.toolResult?.content || "";
    let resultLanguage = "plaintext";
    if (formattedResult) {
      try {
        const parsed = JSON.parse(formattedResult);
        formattedResult = JSON.stringify(parsed, null, 2);
        resultLanguage = "json";
      } catch {
        // keep as is
      }
    }

    const mcpImages = message.toolResult?.images || [];
    const previewImages = mcpImages.map((img, idx) => {
      const ext = img.mimeType.split("/")[1] || "png";
      return {
        url: `data:${img.mimeType};base64,${img.data}`,
        name: `mcp_image_${idx + 1}.${ext}`,
      };
    });

    const displayName = formatToolName(name);
    const nativeInfo = getNativeToolDisplayInfo(name, message.toolCall?.arguments, message.toolResult, isCompleted, t);

    return (
      <div ref={cardRef} className="flex flex-col max-w-full">
        {/* Simple inline text with chevron */}
        <div className="flex items-center gap-1.5 text-text-muted select-none">
          {!nativeInfo && <Wrench size={14} className="shrink-0" aria-hidden="true" />}

          {nativeInfo ? (
            <span className="text-sm flex items-center gap-1.5">
              {nativeInfo.type === "todo" ? (
                <span>{isCompleted ? t("chat.tools.updatedTodo") : t("chat.tools.updatingTodo")}</span>
              ) : nativeInfo.type === "bash" ? (
                <>
                  <nativeInfo.IconComponent
                    size={14}
                    className={`${nativeInfo.colorClass} shrink-0`}
                    aria-hidden="true"
                  />
                  <span className="font-mono text-xs text-text-primary">{nativeInfo.label}</span>
                </>
              ) : (
                <>
                  <span>{nativeInfo.label}</span>
                  <nativeInfo.IconComponent
                    size={14}
                    className={`${nativeInfo.colorClass} shrink-0`}
                    aria-hidden="true"
                  />
                  <span className="font-medium text-text-primary">
                    {message.toolResult?.diffSummary?.filename || nativeInfo.filename}
                    {nativeInfo.extraInfo && (
                      <span className="text-text-muted font-normal">{nativeInfo.extraInfo}</span>
                    )}
                  </span>
                </>
              )}

              {isWaitSubagents && !isCompleted && <span>{dots}</span>}
              {!isWaitSubagents && !isCompleted && <span>...</span>}
              {isCompleted && message.toolResult?.diffSummary && nativeInfo.type === "edit" && (
                <span className="flex items-center gap-1.5 ml-1 font-mono text-xs select-none">
                  <span className="text-emerald-600 dark:text-emerald-500 font-medium">
                    +{message.toolResult.diffSummary.added}
                  </span>
                  <span className="text-rose-500 dark:text-rose-400 font-medium">
                    -{message.toolResult.diffSummary.deleted}
                  </span>
                </span>
              )}
            </span>
          ) : (
            <span className="text-sm">
              {isCompleted
                ? t("chat.tools.runMcp", { name: displayName })
                : t("chat.tools.runningMcp", { name: displayName })}
            </span>
          )}

          {!isWaitSubagents && (
            <motion.button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center justify-center p-0.5 hover:bg-hover rounded text-text-muted hover:text-text-primary transition-colors cursor-pointer"
              aria-label={expanded ? t("chat.tools.collapseTooltip") : t("chat.tools.expandTooltip")}
              whileHover={{ scale: 1.15 }}
              whileTap={{ scale: 0.9 }}
            >
              <ChevronDown size={13} className={`transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
            </motion.button>
          )}
        </div>

        {/* Collapsible Content */}
        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              key="mcp-details"
              initial={{ height: 0, opacity: 0, marginTop: 0 }}
              animate={{ height: "auto", opacity: 1, marginTop: 6 }}
              exit={{ height: 0, opacity: 0, marginTop: 0 }}
              transition={{
                type: "tween",
                ease: motionTokens.easing.smooth,
                duration: motionTokens.duration.normal,
              }}
              className="w-full overflow-hidden pl-5"
            >
              {isWaitSubagents ? (
                <SubagentEmbeddedChats message={message} />
              ) : (
                <div className="bg-input/20 border border-border/40 rounded-xl p-3 flex flex-col gap-3">
                  {/* Arguments */}
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-medium text-text-muted font-mono">
                      {t("chat.tools.arguments")}
                    </span>
                    <SyntaxCodeBlock code={formattedArgs} language="json" maxHeight="200px" />
                  </div>

                  {/* Result */}
                  {isCompleted && nativeInfo?.type === "todo" ? (
                    <div className="flex flex-col gap-1 text-sm text-text-secondary">
                      {/* Try to parse standard markdown checkboxes if we updated a TODO */}
                      {formattedResult
                        .split("\\n")
                        .filter((line) => line.trim().startsWith("- [") || line.trim().startsWith("* ["))
                        .map((line, i) => {
                          const isChecked = line.includes("[x]") || line.includes("[X]");
                          const text = line.replace(/^[-*]\s*\[.\]\s*/, "");
                          return (
                            <div key={i} className="flex items-start gap-2">
                              {isChecked ? (
                                <Check size={14} className="mt-0.5 text-emerald-500" />
                              ) : (
                                <div className="mt-0.5 w-[14px] h-[14px] border border-border rounded-sm" />
                              )}
                              <span className={isChecked ? "line-through opacity-70" : ""}>{text}</span>
                            </div>
                          );
                        })}
                      {!formattedResult.includes("[ ]") && !formattedResult.includes("[x]") && (
                        <SyntaxCodeBlock code={formattedResult} language={resultLanguage} maxHeight="400px" />
                      )}
                    </div>
                  ) : (
                    isCompleted && (
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-medium text-text-muted font-mono">
                          {t("chat.tools.result")}
                        </span>
                        <SyntaxCodeBlock code={formattedResult} language={resultLanguage} maxHeight="400px" />
                      </div>
                    )
                  )}

                  {/* Images */}
                  {isCompleted && mcpImages.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-medium text-text-muted font-mono">
                        {t("chat.tools.images")}
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {mcpImages.map((img, idx) => {
                          const dataUrl = `data:${img.mimeType};base64,${img.data}`;
                          return (
                            <div
                              key={idx}
                              onClick={() => setPreviewImageIndex(idx)}
                              className="relative w-16 h-16 rounded-lg overflow-hidden border border-border bg-surface cursor-pointer hover:border-active transition-colors shrink-0"
                              title={t("chat.tools.viewImageTitle", { index: String(idx + 1) })}
                            >
                              <img
                                src={dataUrl}
                                alt={`MCP Output ${idx + 1}`}
                                className="w-full h-full object-cover select-none"
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {previewImageIndex !== null && previewImages.length > 0 && !isWaitSubagents && (
                <ImagePreviewModal
                  isOpen={previewImageIndex !== null}
                  onClose={() => setPreviewImageIndex(null)}
                  images={previewImages}
                  activeIndex={previewImageIndex}
                  onChangeActiveIndex={(idx) => setPreviewImageIndex(idx)}
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // Non-MCP Tools (Search, Fetch)
  const NativeIcon = isSearch ? Search : isFetch ? Globe : Wrench;
  return (
    <div className="flex items-center gap-1.5 text-text-muted">
      <NativeIcon size={13} className="shrink-0" aria-hidden="true" />
      <span className="text-sm">
        {isCompleted
          ? isSearch
            ? t("chat.tools.searched", { query: message.toolCall?.arguments?.query || "" })
            : isFetch
              ? t("chat.tools.fetched", { url: message.toolCall?.arguments?.url || "" })
              : t("chat.tools.resultLabel")
          : isSearch
            ? t("chat.tools.searching")
            : isFetch
              ? t("chat.tools.fetching")
              : t("chat.tools.executing")}
      </span>
    </div>
  );
}

function ToolCallBubble({ message }: { message: Message }) {
  if (message.toolCall) return <ToolCallDisplay message={message} />;
  return null;
}

function LoadingText() {
  const [dots, setDots] = useState(".");

  useEffect(() => {
    const interval = setInterval(() => {
      setDots((prev) => {
        if (prev === "...") return ".";
        if (prev === "..") return "...";
        return "..";
      });
    }, 500);
    return () => clearInterval(interval);
  }, []);

  return <span className="text-xs text-text-muted font-medium font-mono">Loading{dots}</span>;
}

function ReasoningBubble({
  content,
  isStreaming,
  isReasoningComplete,
  thinkingDuration,
  conversationId,
  autoExpandReasoning,
}: {
  content: string;
  isStreaming?: boolean;
  isReasoningComplete?: boolean;
  thinkingDuration?: number;
  conversationId?: string;
  autoExpandReasoning?: boolean;
}) {
  const [prevAutoExpand, setPrevAutoExpand] = useState(autoExpandReasoning);
  const [expanded, setExpanded] = useState(!!autoExpandReasoning);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [dots, setDots] = useState(".");

  if (autoExpandReasoning !== prevAutoExpand) {
    setPrevAutoExpand(autoExpandReasoning);
    if (autoExpandReasoning !== undefined) {
      setExpanded(autoExpandReasoning);
    }
  }

  const startTimestamp = useChatStore((s) =>
    conversationId && s.activeStreamThinkingStart ? s.activeStreamThinkingStart[conversationId] : undefined,
  );

  const thinkingActive = isStreaming && !isReasoningComplete;

  useEffect(() => {
    if (!thinkingActive) {
      return;
    }

    const updateElapsed = () => {
      const start = startTimestamp || Date.now();
      const diff = Math.max(0, Math.round((Date.now() - start) / 1000));
      setElapsed(diff);
    };

    updateElapsed();

    const interval = setInterval(updateElapsed, 1000);
    return () => clearInterval(interval);
  }, [thinkingActive, startTimestamp]);

  useEffect(() => {
    if (!thinkingActive) {
      return;
    }
    const interval = setInterval(() => {
      setDots((prev) => {
        if (prev === "...") return ".";
        if (prev === "..") return "...";
        return "..";
      });
    }, 500);
    return () => clearInterval(interval);
  }, [thinkingActive]);

  return (
    <motion.div
      className="flex items-start gap-1.5 text-text-muted"
      variants={messageVariants}
      initial="hidden"
      animate="visible"
      transition={springs.gentle}
    >
      <Sparkles size={14} className="mt-1 shrink-0" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <motion.button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1.5 text-sm hover:text-text-primary transition-colors"
            aria-label={expanded ? "Collapse reasoning" : "Expand reasoning"}
            whileHover={{ x: 2 }}
            transition={springs.snappy}
          >
            <span>
              {thinkingActive
                ? elapsed !== null
                  ? `Thinking for ${elapsed}s${dots}`
                  : `Thinking${dots}`
                : thinkingDuration !== undefined
                  ? `Thought for ${thinkingDuration}s`
                  : "Thought"}
            </span>
            <ChevronDown size={13} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
          </motion.button>
        </div>
        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              key="reasoning-content"
              className="overflow-hidden bg-input/20 border border-border/40 rounded-xl"
              initial={{ opacity: 0, height: 0, marginTop: 0 }}
              animate={{ opacity: 1, height: "auto", marginTop: 6 }}
              exit={{ opacity: 0, height: 0, marginTop: 0 }}
              transition={{
                type: "tween",
                ease: motionTokens.easing.smooth,
                duration: motionTokens.duration.normal,
              }}
            >
              <div className="p-3 text-sm text-text-secondary overflow-x-auto max-h-48 overflow-y-auto">
                <p className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
                  {content || "Thinking..."}
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

function AttachmentList({
  attachments,
  onImageClick,
}: {
  attachments: Attachment[];
  onImageClick: (index: number) => void;
}) {
  const imageAttachments = attachments.filter((a) => a.kind === "image" && a.dataUrl);

  return (
    <div className="flex flex-wrap gap-2 mb-2 justify-end">
      {attachments.map((a) => {
        if (a.kind === "image" && a.dataUrl) {
          const imgIdx = imageAttachments.findIndex((img) => img.id === a.id);
          return (
            <div
              key={a.id}
              onClick={() => onImageClick(imgIdx)}
              className="relative w-16 h-16 rounded-lg overflow-hidden border border-border bg-surface cursor-pointer hover:border-active transition-colors shrink-0"
              title={`View ${a.name}`}
            >
              <img src={a.dataUrl} alt={a.name} className="w-full h-full object-cover select-none" />
            </div>
          );
        } else {
          return (
            <div
              key={a.id}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-surface text-text-secondary text-xs shrink-0 max-w-[200px]"
              title={`${a.name} (${formatFileSize(a.size)})`}
            >
              <FileTextIcon size={14} className="text-text-muted shrink-0" />
              <span className="truncate select-none font-medium">{a.name}</span>
            </div>
          );
        }
      })}
    </div>
  );
}

interface ParsedQuestion {
  id: string;
  title: string;
  options: { value: string; label: string }[];
  cleanedContent: string;
}

function parseQuestionBlock(content: string): ParsedQuestion | null {
  const match = content.match(/<question\s+id="([^"]+)"\s+title="([^"]+)">([\s\S]+?)<\/question>/);
  if (!match) return null;

  const [fullMatch, id, title, optionsRaw] = match;

  const options: { value: string; label: string }[] = [];
  const optionMatches = optionsRaw.matchAll(/<option\s+value="([^"]+)">([\s\S]+?)<\/option>/g);
  for (const optMatch of optionMatches) {
    options.push({ value: optMatch[1], label: optMatch[2].trim() });
  }

  const cleanedContent = content.replace(fullMatch, "").trim();

  return { id, title, options, cleanedContent };
}

function SystemNotificationBubble({ message }: { message: Message }) {
  const content = message.content;
  const isProjectsEnabled = useProjectStore((s) => s.isProjectsEnabled);

  const matchSuccess = content.match(
    /Subagent\s+'([^']+)'\s+\(ID:\s*([a-zA-Z0-9]+)\)\s+has finished its task\.\s*Final response:([\s\S]*)/i,
  );
  const matchFailure = content.match(/Subagent\s+'([^']+)'\s+\(ID:\s*([a-zA-Z0-9]+)\)\s+failed with error:([\s\S]*)/i);

  if (!matchSuccess && !matchFailure) {
    return (
      <div className="flex flex-col gap-2 my-4 w-full">
        <div className="flex items-center gap-1.5 text-text-muted select-none text-xs font-semibold uppercase tracking-wider">
          <Terminal size={14} className="shrink-0" />
          <span>System Notification</span>
        </div>
        <div className="border border-border/40 rounded-2xl bg-surface/50 p-4 text-sm text-text-primary leading-relaxed whitespace-pre-wrap break-words">
          {content}
        </div>
      </div>
    );
  }

  const isSuccess = !!matchSuccess;
  const role = isSuccess ? matchSuccess[1] : matchFailure![1];
  const subagentId = isSuccess ? matchSuccess[2] : matchFailure![2];
  const bodyContent = (isSuccess ? matchSuccess[3] : matchFailure![3]).trim();

  const handleOpenChat = () => {
    useUIStore.getState().setActiveSubagentId(subagentId);
  };

  return (
    <div className="flex flex-col gap-3 my-5 w-full">
      <div className="flex items-center justify-between gap-4 text-xs text-text-muted select-none">
        <div className="flex items-center gap-1.5 font-semibold uppercase tracking-wider">
          {isSuccess ? (
            <CheckCircle2 size={14} className="shrink-0 text-emerald-500" />
          ) : (
            <AlertTriangle size={14} className="shrink-0 text-red-500" />
          )}
          <span>{isSuccess ? "Subagent Completed" : "Subagent Failed"}</span>
        </div>
        {isProjectsEnabled && (
          <button
            onClick={handleOpenChat}
            className="flex items-center gap-1 text-accent hover:text-accent/80 hover:underline transition-colors font-medium cursor-pointer"
          >
            <span>Inspect Subagent</span>
            <ArrowRight size={12} />
          </button>
        )}
      </div>

      <div
        className={`border rounded-2xl p-5 shadow-sm ${
          isSuccess ? "border-border/50 bg-surface/40" : "border-red-500/20 bg-red-500/5"
        }`}
      >
        <div className="text-xs font-semibold text-text-secondary mb-3 pb-2 border-b border-border/30 flex justify-between items-center">
          <span>
            {role} ({subagentId})
          </span>
          {isSuccess ? (
            <span className="text-[10px] text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded-full font-medium">
              DONE
            </span>
          ) : (
            <span className="text-[10px] text-red-600 bg-red-500/10 px-2 py-0.5 rounded-full font-medium">ERROR</span>
          )}
        </div>

        <div
          className={
            isSuccess
              ? "markdown-body text-sm text-text-primary"
              : "text-sm text-red-600 dark:text-red-400 whitespace-pre-wrap"
          }
        >
          {isSuccess ? <MessageContent content={bodyContent} isStreaming={false} /> : bodyContent}
        </div>
      </div>
    </div>
  );
}

const MessageBubble = memo(function MessageBubble({
  message,
  onRetry,
  conversationId,
  autoExpandReasoning,
}: {
  message: Message;
  onRetry?: () => void;
  conversationId?: string;
  autoExpandReasoning?: boolean;
}) {
  const allConversations = useChatStore((s) => s.conversations);
  const isAnySubagentRunning = useMemo(() => {
    return allConversations.some((c) => c.parentId === conversationId && c.status === "running");
  }, [allConversations, conversationId]);

  const isGenerating = useChatStore((s) => {
    if (!conversationId) return false;
    const gen = s.generationByConversation[conversationId];
    return gen && gen.state !== "idle";
  });

  const isCancelled = useChatStore((s) => s.generationState === "cancelled");

  const isLastInSequence = useMemo(() => {
    if (message.role !== "assistant") return false;
    const conv = conversationId ? allConversations.find((c) => c.id === conversationId) : undefined;
    if (!conv) return false;
    const idx = conv.messages.findIndex((m) => m.id === message.id);
    if (idx === -1) return false;
    const next = conv.messages[idx + 1];
    return !next || next.role === "user";
  }, [message.id, message.role, conversationId, allConversations]);

  const isSystem = message.isSystem;
  const isUser = message.role === "user" && !isSystem;
  const isTool = message.role === "tool";
  const isStreaming = !!message.isStreaming;

  const streamContent = useChatStore((s) =>
    isStreaming && message.role === "assistant" && conversationId ? s.activeStreamContent[conversationId] : undefined,
  );
  const combinedContent = streamContent !== undefined ? message.content + streamContent : message.content;

  const { reasoningContent, displayContent, hasOpenReasoning } = parseReasoning(combinedContent, message.role);
  const [sourcesExpanded, setSourcesExpanded] = useState(false);
  const imageAttachments = message.attachments?.filter((a) => a.kind === "image" && a.dataUrl) || [];
  const [previewImageIndex, setPreviewImageIndex] = useState<number | null>(null);

  const baseTextSize = useUIStore((s) => s.baseTextSize);
  const textSizeClass =
    {
      small: "text-xs",
      medium: "text-sm",
      large: "text-base",
      xlarge: "text-lg",
    }[baseTextSize] || "text-sm";

  if (isSystem) {
    const match = message.content.match(/Subagent '([^']+)'/);
    const subagentName = match ? match[1] : "Agent";
    return (
      <div className="flex items-center my-4 select-none">
        <div className="flex-grow border-t border-border/40"></div>
        <span className="mx-4 text-text-muted text-xs font-medium">Subagent &ldquo;{subagentName}&rdquo; Finished</span>
        <div className="flex-grow border-t border-border/40"></div>
      </div>
    );
  }

  if (isTool) {
    return (
      <motion.div
        className="flex justify-start group"
        variants={messageVariants}
        initial="hidden"
        animate="visible"
        transition={springs.gentle}
      >
        <div className="min-w-0">
          <ToolCallBubble message={message} />
        </div>
      </motion.div>
    );
  }

  if (isUser) {
    if (message.content.startsWith("[System Notification]")) {
      return <SystemNotificationBubble message={message} />;
    }
    const hasAttachments = message.attachments && message.attachments.length > 0;
    return (
      <motion.div
        className="flex justify-end group"
        role="article"
        aria-label={`User message: ${message.content.slice(0, 80)}`}
        variants={messageVariants}
        initial="hidden"
        animate="visible"
        transition={springs.gentle}
      >
        <div className="max-w-[75%] flex flex-col items-end min-w-0">
          {hasAttachments && (
            <AttachmentList attachments={message.attachments!} onImageClick={(idx) => setPreviewImageIndex(idx)} />
          )}
          {message.content.trim().length > 0 && (
            <div
              className={`bg-input rounded-[28px] rounded-br-md px-5 py-3 ${textSizeClass} text-text-primary leading-relaxed whitespace-pre-wrap break-words w-full`}
            >
              {message.content}
            </div>
          )}
          {!isGenerating && !isAnySubagentRunning && (
            <div className="flex justify-end">
              <MessageActions content={message.content} isUser />
            </div>
          )}
          {previewImageIndex !== null && imageAttachments.length > 0 && (
            <ImagePreviewModal
              isOpen={previewImageIndex !== null}
              onClose={() => setPreviewImageIndex(null)}
              images={imageAttachments.map((a) => ({ url: a.dataUrl!, name: a.name, size: a.size }))}
              activeIndex={previewImageIndex}
              onChangeActiveIndex={(idx) => setPreviewImageIndex(idx)}
            />
          )}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      className="flex justify-start group"
      role="article"
      aria-label={`Assistant message${isStreaming ? " (generating)" : ""}: ${message.content.slice(0, 80)}`}
      variants={messageVariants}
      initial="hidden"
      animate="visible"
      transition={springs.gentle}
    >
      <div className={`max-w-[85%] ${textSizeClass} text-text-primary leading-relaxed w-full min-w-0`}>
        {hasOpenReasoning && (
          <ReasoningBubble
            content={reasoningContent}
            isStreaming={isStreaming}
            isReasoningComplete={
              combinedContent.includes("</reasoning>") ||
              combinedContent.includes("</thinking>") ||
              combinedContent.includes("</thought>")
            }
            thinkingDuration={message.thinkingDuration}
            conversationId={conversationId}
            autoExpandReasoning={autoExpandReasoning}
          />
        )}
        {!hasOpenReasoning && isStreaming && displayContent.length === 0 && (
          <motion.div
            className="flex items-center gap-2 py-1"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={springs.gentle}
          >
            <LoadingText />
          </motion.div>
        )}
        {(() => {
          const parsedQuestion = parseQuestionBlock(displayContent);
          const contentToRender = parsedQuestion ? parsedQuestion.cleanedContent : displayContent;
          const isAlreadyAnswered = !isLastInSequence;
          return (
            <>
              <div className={`markdown-body ${textSizeClass}`}>
                {contentToRender.length > 0 ? (
                  contentToRender === "Cancelled agent execution." ? (
                    <div className="text-text-muted italic text-[13px] my-1 flex items-center gap-1.5 select-none font-medium">
                      Cancelled agent execution.
                    </div>
                  ) : (
                    <MessageContent
                      content={contentToRender}
                      isStreaming={isStreaming}
                      conversationId={conversationId}
                      role={message.role}
                    />
                  )
                ) : null}
              </div>
              {parsedQuestion && !isStreaming && (
                <QuestionCard
                  id={parsedQuestion.id}
                  title={parsedQuestion.title}
                  options={parsedQuestion.options}
                  disabled={isAlreadyAnswered}
                  onSubmit={(_val, label) => {
                    useChatStore.getState().sendMessage(label);
                  }}
                />
              )}
            </>
          );
        })()}
        {!isStreaming &&
          !isGenerating &&
          !isAnySubagentRunning &&
          isLastInSequence &&
          (displayContent.length > 0 || isCancelled) && (
            <MessageActions
              content={displayContent}
              sources={message.sources}
              isUser={false}
              onSourceClick={
                message.sources && message.sources.length > 0 ? () => setSourcesExpanded(!sourcesExpanded) : undefined
              }
              onRetry={onRetry}
            />
          )}
        <AnimatePresence>
          {sourcesExpanded && message.sources && message.sources.length > 0 && (
            <SourcesList sources={message.sources} />
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
});

const VIRTUALIZED_THRESHOLD = 50;

function ChatAreaBase({
  messages,
  setIsAtBottom,
  virtuosoRef,
  onRetry,
  generationState,
  onScroll,
  conversationId,
  pendingWorktree,
  scrollContainerRef,
  autoExpandReasoning,
  showEmptyState = true,
}: ChatAreaProps) {
  const applyPendingWorktree = useChatStore((s) => s.applyPendingWorktree);
  const discardPendingWorktree = useChatStore((s) => s.discardPendingWorktree);
  const conversation = useChatStore((s) => s.conversations.find((c) => c.id === conversationId));
  if (messages.length === 0) {
    if (!showEmptyState) {
      return (
        <div ref={scrollContainerRef} className="flex-1 min-h-0 bg-chat" role="region" aria-label="No messages yet" />
      );
    }
    const isTemporary = conversation?.isTemporary === true;
    return (
      <motion.div
        className="flex-1 flex flex-col items-center justify-end select-none relative pb-2 translate-y-[-7vh]"
        role="region"
        aria-label="Empty chat — type a message to begin"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: motionTokens.duration.slow }}
      >
        <div className="flex flex-col items-center gap-4 px-4">
          <motion.div
            className="text-center"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...springs.gentle, delay: 0.2 }}
          >
            {isTemporary ? (
              <div className="flex flex-col items-center gap-2 text-center">
                <div className="flex items-center gap-2 text-2xl font-bold tracking-tight text-text-primary">
                  <Ghost size={22} className="text-accent" aria-hidden="true" />
                  <h1>Temporary chat</h1>
                </div>
                <p className="text-sm text-text-muted">This chat won&apos;t be saved to your history.</p>
              </div>
            ) : (
              <h1 className="text-2xl font-bold tracking-tight text-text-primary">What should we work on?</h1>
            )}
          </motion.div>
        </div>
      </motion.div>
    );
  }

  if (messages.length >= VIRTUALIZED_THRESHOLD) {
    return (
      <div className="flex-1 min-h-0 min-w-0 relative" role="log" aria-label="Chat messages" aria-live="polite">
        <Virtuoso
          ref={virtuosoRef}
          data={messages}
          atBottomStateChange={setIsAtBottom}
          atBottomThreshold={100}
          scrollerRef={(el) => {
            if (el && el instanceof HTMLElement) {
              el.addEventListener(
                "scroll",
                () => {
                  const ratio = el.scrollTop / (el.scrollHeight - el.clientHeight);
                  onScroll?.(el.scrollTop, isNaN(ratio) ? 0 : ratio);
                },
                { passive: true },
              );
            }
          }}
          itemContent={(index, msg) => (
            <div className={index > 0 ? "mt-0.5" : ""}>
              <MessageBubble
                message={msg}
                onRetry={onRetry}
                conversationId={conversationId}
                autoExpandReasoning={autoExpandReasoning}
              />
            </div>
          )}
          components={{
            Header: () =>
              conversation?.isTemporary ? (
                <div className="max-w-3xl mx-auto w-full px-6 pt-8 pb-2">
                  <div className="flex items-start gap-2.5 p-3.5 bg-accent/5 rounded-xl border border-accent/20 text-accent-soft text-xs leading-relaxed select-none">
                    <Ghost size={16} className="shrink-0 text-accent animate-pulse" />
                    <div>
                      <span className="font-semibold text-text-primary block mb-0.5">Temporary Chat</span>
                      This conversation won't be saved to history or used for training/persistence. It will be discarded
                      once you close the app or switch chats.
                    </div>
                  </div>
                </div>
              ) : (
                <div className="h-4" />
              ),
            Footer: () => (
              <>
                {generationState === "cancelled" && (
                  <div className="max-w-3xl mx-auto w-full px-6">
                    <CancelledBar
                      content={messages.filter((m) => m.role === "assistant").pop()?.content ?? ""}
                      onRetry={onRetry}
                    />
                  </div>
                )}
                {pendingWorktree && conversationId && (
                  <div className="py-6">
                    <PendingWorktreeCard
                      conversationId={conversationId}
                      pendingWorktree={pendingWorktree}
                      onApply={applyPendingWorktree}
                      onDiscard={discardPendingWorktree}
                    />
                  </div>
                )}
              </>
            ),
          }}
          followOutput="smooth"
        />
      </div>
    );
  }

  return (
    <NonVirtualizedChatArea
      messages={messages}
      setIsAtBottom={setIsAtBottom}
      onRetry={onRetry}
      generationState={generationState}
      pendingWorktree={pendingWorktree}
      conversationId={conversationId}
      onApply={applyPendingWorktree}
      onDiscard={discardPendingWorktree}
      scrollContainerRef={scrollContainerRef}
      onScroll={onScroll}
      autoExpandReasoning={autoExpandReasoning}
    />
  );
}

function NonVirtualizedChatArea({
  messages,
  setIsAtBottom,
  onRetry,
  generationState,
  pendingWorktree,
  conversationId,
  onApply,
  onDiscard,
  scrollContainerRef,
  onScroll,
  autoExpandReasoning,
}: {
  messages: Message[];
  setIsAtBottom?: (v: boolean) => void;
  onRetry?: () => void;
  generationState: GenerationState;
  pendingWorktree?: { path: string; branch: string };
  conversationId?: string;
  onApply: (id: string) => Promise<void>;
  onDiscard: (id: string) => Promise<void>;
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
  onScroll?: (scrollTop: number, ratio: number) => void;
  autoExpandReasoning?: boolean;
}) {
  const conversation = useChatStore((s) => s.conversations.find((c) => c.id === conversationId));
  const fallbackRef = useRef<HTMLDivElement | null>(null);
  const activeRef = scrollContainerRef || fallbackRef;
  const contentRef = useRef<HTMLDivElement>(null);

  const lastHeightRef = useRef(0);
  const wasAtBottomRef = useRef(true);

  useEffect(() => {
    const el = activeRef.current;
    if (!el) return;

    const checkAtBottom = () => {
      const target = activeRef.current;
      if (!target) return;
      const atBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 100;
      wasAtBottomRef.current = atBottom;
      setIsAtBottom?.(atBottom);
    };

    const handleResize = () => {
      const target = activeRef.current;
      if (!target) return;

      // If we were at the bottom and the height increased, scroll to bottom
      if (wasAtBottomRef.current && target.scrollHeight > lastHeightRef.current) {
        target.scrollTop = target.scrollHeight;
      }
      lastHeightRef.current = target.scrollHeight;
      checkAtBottom();
    };

    const handleScroll = () => {
      checkAtBottom();
      const ratio = el.scrollTop / (el.scrollHeight - el.clientHeight);
      onScroll?.(el.scrollTop, isNaN(ratio) ? 0 : ratio);
    };

    el.addEventListener("scroll", handleScroll, { passive: true });

    let observer: ResizeObserver | null = null;
    if (contentRef.current && window.ResizeObserver) {
      observer = new ResizeObserver(() => handleResize());
      observer.observe(contentRef.current);
      observer.observe(el);
    }

    lastHeightRef.current = el.scrollHeight;
    checkAtBottom();

    return () => {
      el.removeEventListener("scroll", handleScroll);
      observer?.disconnect();
    };
  }, [setIsAtBottom, onScroll, activeRef]);

  return (
    <div
      ref={activeRef}
      data-chat-scroll
      className="flex-1 min-h-0 min-w-0 overflow-y-auto relative"
      role="log"
      aria-label="Chat messages"
      aria-live="polite"
    >
      <div ref={contentRef} className="max-w-3xl mx-auto w-full px-6 py-8 space-y-0.5">
        {conversation?.isTemporary && (
          <div className="flex items-start gap-2.5 p-3.5 bg-accent/5 rounded-xl border border-accent/20 text-accent-soft text-xs leading-relaxed select-none mb-4 animate-fade-in">
            <Ghost size={16} className="shrink-0 text-accent animate-pulse" />
            <div>
              <span className="font-semibold text-text-primary block mb-0.5">Temporary Chat</span>
              This conversation won't be saved to history or used for training/persistence. It will be discarded once
              you close the app or switch chats.
            </div>
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            onRetry={onRetry}
            conversationId={conversationId}
            autoExpandReasoning={autoExpandReasoning}
          />
        ))}
        {generationState === "cancelled" && (
          <CancelledBar
            content={messages.filter((m) => m.role === "assistant").pop()?.content ?? ""}
            onRetry={onRetry}
          />
        )}
        {pendingWorktree && conversationId && (
          <PendingWorktreeCard
            conversationId={conversationId}
            pendingWorktree={pendingWorktree}
            onApply={onApply}
            onDiscard={onDiscard}
          />
        )}
        <div aria-hidden="true" className="h-1" />
      </div>
    </div>
  );
}

function PendingWorktreeCard({
  conversationId,
  pendingWorktree,
  onApply,
  onDiscard,
}: {
  conversationId: string;
  pendingWorktree: { path: string; branch: string };
  onApply: (id: string) => void;
  onDiscard: (id: string) => void;
}) {
  const [diffFiles, setDiffFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const loadStatus = async () => {
      if (!pendingWorktree?.path) return;
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const status = await invoke<{ unstagedFiles: string[]; stagedFiles: string[] }>("git_get_status", {
          projectId: useProjectStore.getState().activeProjectId || "",
          worktreePath: pendingWorktree.path,
        });
        const files = [...(status.unstagedFiles || []), ...(status.stagedFiles || [])];
        setDiffFiles(files);
      } catch (e) {
        console.error("Failed to load worktree git status:", e);
      }
    };
    loadStatus();
  }, [conversationId, pendingWorktree?.path, pendingWorktree?.branch]);

  if (diffFiles.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.98 }}
      className="p-4 rounded-xl border border-border bg-surface/60 backdrop-blur-md flex flex-col gap-3 shadow-md mx-auto max-w-3xl w-full"
    >
      <div className="flex items-center justify-between border-b border-border/50 pb-2">
        <div className="flex items-center gap-2 text-text-primary font-semibold text-xs">
          <GitBranch size={14} className="text-accent shrink-0" />
          <span>Agent Workspace Sandboxed Changes</span>
        </div>
        <span className="text-[10px] text-text-muted bg-hover px-2 py-0.5 rounded-full font-mono shrink-0">
          {pendingWorktree.branch}
        </span>
      </div>
      <p className="text-xs text-text-muted">
        The agent has completed changes inside an isolated Git worktree. Review the modified files below:
      </p>
      <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto bg-chat/30 p-2 rounded-lg border border-border/30">
        {diffFiles.map((file) => (
          <div key={file} className="flex items-center gap-2 text-xs text-text-secondary font-mono truncate">
            <FileTextIcon size={12} className="text-text-muted shrink-0" />
            <span className="truncate">{file}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 justify-end pt-2">
        <button
          onClick={async () => {
            setLoading(true);
            await onDiscard(conversationId);
            setLoading(false);
          }}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-secondary bg-hover hover:bg-hover-active border border-border hover:border-text-muted rounded-lg transition-colors cursor-pointer"
        >
          <Trash2 size={12} className="text-red-500 shrink-0" />
          <span>Discard Changes</span>
        </button>
        <button
          onClick={async () => {
            setLoading(true);
            await onApply(conversationId);
            setLoading(false);
          }}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-accent hover:bg-accent-active border border-accent rounded-lg transition-all shadow-sm cursor-pointer hover:shadow"
        >
          <Check size={12} className="shrink-0" />
          <span>Apply to Workspace</span>
        </button>
      </div>
    </motion.div>
  );
}

export default memo(ChatAreaBase);
