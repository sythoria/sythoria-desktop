import { useState, useEffect, useRef, memo, useCallback, useDeferredValue, isValidElement } from "react";
import { motion, AnimatePresence } from "motion/react";
import ReactMarkdown from "react-markdown";
import { useUIStore } from "../store/useUIStore";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import {
  Bot,
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
  AtSign,
} from "lucide-react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import type { Message, GenerationState, Attachment } from "../types";
import { highlightCode } from "../utils/highlighter";
import { springs, motionTokens } from "../lib/motion-tokens";
import { formatFileSize } from "../utils/attachments";
import { parseReasoning } from "../utils/messageParser";
import { Modal } from "./ui/Modal";

const GENERATION_STATE_CONFIG: Record<
  Exclude<GenerationState, "idle">,
  { icon: React.ElementType; colorClass: string; label: string }
> = {
  thinking: { icon: Sparkles, colorClass: "text-text-muted", label: "Thinking" },
  searching: { icon: Search, colorClass: "text-text-muted", label: "Searching" },
  fetching: { icon: Globe, colorClass: "text-text-muted", label: "Fetching" },
  responding: { icon: Bot, colorClass: "text-text-muted", label: "Responding" },
  mcp_executing: { icon: Wrench, colorClass: "text-text-muted", label: "Running MCP tool" },
  error: { icon: Loader2, colorClass: "text-red-500", label: "Error" },
};

const messageVariants = {
  hidden: { opacity: 0, y: motionTokens.distance.sm },
  visible: { opacity: 1, y: 0 },
};

interface ChatAreaProps {
  messages: Message[];
  setIsAtBottom: (v: boolean) => void;
  virtuosoRef: React.RefObject<VirtuosoHandle | null>;
  onRetry: () => void;
  generationState: GenerationState;
  generationLabel: string;
}

function GenerationIndicator({ state, label }: { state: GenerationState; label: string }) {
  if (state === "idle") return null;
  const config = GENERATION_STATE_CONFIG[state];
  if (!config) return null;
  const Icon = config.icon;
  const displayLabel = label || config.label;

  return (
    <motion.div
      className="flex items-center gap-2 py-1.5"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={springs.gentle}
    >
      <div
        className={`shrink-0 w-5 h-5 rounded-md flex items-center justify-center ${state === "error" ? "bg-red-500/10" : "bg-active"}`}
      >
        {state !== "error" ? (
          <Loader2 size={12} className={`animate-spin ${config.colorClass}`} />
        ) : (
          <Icon size={12} className={config.colorClass} />
        )}
      </div>
      <span
        className={`text-xs font-medium ${state === "error" ? "text-red-600 dark:text-red-400" : "text-text-muted"}`}
      >
        {displayLabel}
      </span>
      {state !== "error" && (
        <span className="generating-dots">
          <span />
          <span />
          <span />
        </span>
      )}
    </motion.div>
  );
}

function SyntaxCodeBlock({ code, language }: { code: string; language: string }) {
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

  return (
    <div className="code-block group relative">
      <div className="flex items-center justify-between px-4 py-1.5 text-[11px] text-text-muted border-b border-border/40 select-none">
        <span className="flex items-center gap-1.5 font-mono lowercase">
          <Terminal size={12} />
          {language}
        </span>
        <motion.button
          onClick={handleCopy}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-text-muted hover:text-text-secondary hover:bg-hover transition-colors opacity-0 group-hover:opacity-100"
          aria-label={copied ? "Copied" : "Copy code"}
          whileHover={{ scale: motionTokens.scale.pop }}
          whileTap={{ scale: motionTokens.scale.press }}
          transition={springs.snappy}
        >
          {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
          {copied ? "Copied" : "Copy"}
        </motion.button>
      </div>
      {highlighted ? (
        <div ref={ref} className="code-block-content" dangerouslySetInnerHTML={{ __html: highlighted }} />
      ) : (
        <div ref={ref} className="code-block-content">
          <code className={`language-${language}`}>{code}</code>
        </div>
      )}
    </div>
  );
}

const markdownComponents = {
  pre({ children, ...props }: React.HTMLAttributes<HTMLPreElement> & { children?: React.ReactNode }) {
    return <pre {...props}>{children}</pre>;
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

function MessageContent({ content, isStreaming }: { content: string; isStreaming: boolean }) {
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

function ToolCallDisplay({ message }: { message: Message }) {
  const { name } = message.toolCall!;
  const isSearch = name === "search_query";
  const isFetch = name === "fetch_url";
  const isMcp = name.includes("__");
  const isCompleted = !!message.toolResult;

  const mcpParts = isMcp ? name.split("__") : [];
  const mcpToolName = mcpParts.length > 1 ? mcpParts.slice(1).join("__") : name;

  return (
    <motion.div
      className="flex items-center gap-2 mb-1.5 text-text-muted"
      variants={messageVariants}
      initial="hidden"
      animate="visible"
      transition={springs.gentle}
    >
      <AtSign size={14} className="shrink-0" aria-hidden="true" />
      <span className="text-sm">
        {isCompleted
          ? isSearch
            ? "Search results"
            : isFetch
              ? "Page content"
              : isMcp
                ? `Run: ${mcpToolName}`
                : "Tool result"
          : isSearch
            ? "Searching..."
            : isFetch
              ? "Fetching..."
              : isMcp
                ? `Running: ${mcpToolName}...`
                : "Calling tool..."}
      </span>
      {!isCompleted && <Loader2 size={12} className="animate-spin ml-1" />}
    </motion.div>
  );
}

function ToolCallBubble({ message }: { message: Message }) {
  if (message.toolCall) return <ToolCallDisplay message={message} />;
  return null;
}

function ReasoningBubble({ content, isStreaming }: { content: string; isStreaming?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const hasContent = content.length > 0;

  return (
    <motion.div
      className="flex items-start gap-2 mb-2 text-text-muted"
      variants={messageVariants}
      initial="hidden"
      animate="visible"
      transition={springs.gentle}
    >
      <Sparkles size={14} className="mt-1 shrink-0" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <motion.button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 text-sm hover:text-text-primary transition-colors"
          aria-label={expanded ? "Collapse reasoning" : "Expand reasoning"}
          whileHover={{ x: 2 }}
          transition={springs.snappy}
        >
          <span>Thinking</span>
          <ChevronDown size={12} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
        </motion.button>
        {expanded ? (
          <motion.div
            className="mt-1.5 p-2.5 rounded-xl bg-input text-sm text-text-secondary overflow-x-auto max-h-48 overflow-y-auto"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            transition={springs.gentle}
          >
            <p className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
              {content || "Thinking..."}
            </p>
          </motion.div>
        ) : isStreaming && !hasContent ? (
          <span className="generating-dots mt-0.5">
            <span />
            <span />
            <span />
          </span>
        ) : null}
      </div>
    </motion.div>
  );
}

function AttachmentList({
  attachments,
  onImageClick,
}: {
  attachments: Attachment[];
  onImageClick: (url: string, name: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2 mb-2 justify-end">
      {attachments.map((a) => {
        if (a.kind === "image" && a.dataUrl) {
          return (
            <div
              key={a.id}
              onClick={() => onImageClick(a.dataUrl!, a.name)}
              className="relative w-16 h-16 rounded-lg overflow-hidden border border-border bg-surface cursor-pointer hover:border-active transition-all group shrink-0"
              title={`View ${a.name}`}
            >
              <img
                src={a.dataUrl}
                alt={a.name}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200 select-none"
              />
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

const MessageBubble = memo(function MessageBubble({
  message,
  onRetry,
  generationState,
  generationLabel,
  isLastAssistant,
}: {
  message: Message;
  onRetry?: () => void;
  generationState?: GenerationState;
  generationLabel?: string;
  isLastAssistant?: boolean;
}) {
  const isUser = message.role === "user";
  const isTool = message.role === "tool";
  const { reasoningContent, displayContent, hasOpenReasoning } = parseReasoning(message.content, message.role);
  const [sourcesExpanded, setSourcesExpanded] = useState(false);
  const [previewImage, setPreviewImage] = useState<{ url: string; name: string } | null>(null);

  const baseTextSize = useUIStore((s) => s.baseTextSize);
  const textSizeClass =
    {
      small: "text-xs",
      medium: "text-sm",
      large: "text-base",
      xlarge: "text-lg",
    }[baseTextSize] || "text-sm";

  if (isTool) {
    return <ToolCallBubble message={message} />;
  }

  if (isUser) {
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
        <div className="max-w-[75%] flex flex-col items-end">
          {hasAttachments && (
            <AttachmentList
              attachments={message.attachments!}
              onImageClick={(url, name) => setPreviewImage({ url, name })}
            />
          )}
          {message.content.trim().length > 0 && (
            <div
              className={`bg-input rounded-[28px] rounded-br-md px-5 py-3 ${textSizeClass} text-text-primary leading-relaxed whitespace-pre-wrap break-words w-full`}
            >
              {message.content}
            </div>
          )}
          <div className="flex justify-end">
            <MessageActions content={message.content} isUser />
          </div>
          {previewImage && (
            <Modal isOpen={!!previewImage} onClose={() => setPreviewImage(null)} title={previewImage.name}>
              <div className="flex justify-center items-center max-h-[80vh] p-2 overflow-auto">
                <img
                  src={previewImage.url}
                  alt={previewImage.name}
                  className="max-w-full max-h-[70vh] object-contain rounded-md select-none"
                />
              </div>
            </Modal>
          )}
        </div>
      </motion.div>
    );
  }

  const isStreaming = !!message.isStreaming;
  const showGenerationIndicator = isLastAssistant && isStreaming && generationState && generationState !== "idle";

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
      <div className={`max-w-[85%] ${textSizeClass} text-text-primary leading-relaxed w-full`}>
        {hasOpenReasoning && <ReasoningBubble content={reasoningContent} isStreaming={isStreaming} />}
        {!hasOpenReasoning && isStreaming && displayContent.length === 0 && !showGenerationIndicator && (
          <motion.div
            className="flex items-center gap-2 py-1"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={springs.gentle}
          >
            <Loader2 size={14} className="text-text-secondary animate-spin" />
            <span className="text-xs text-text-muted font-medium">Thinking</span>
            <span className="generating-dots">
              <span />
              <span />
              <span />
            </span>
          </motion.div>
        )}
        {showGenerationIndicator && !hasOpenReasoning && displayContent.length === 0 && (
          <GenerationIndicator state={generationState!} label={generationLabel!} />
        )}
        <div className={`markdown-body ${textSizeClass}`}>
          {displayContent.length > 0 ? <MessageContent content={displayContent} isStreaming={isStreaming} /> : null}
        </div>
        {!isStreaming && displayContent.length > 0 && (
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

export default function ChatArea({
  messages,
  setIsAtBottom,
  virtuosoRef,
  onRetry,
  generationState,
  generationLabel,
}: ChatAreaProps) {
  if (messages.length === 0) {
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
            <h1 className="text-2xl font-bold tracking-tight text-text-primary">What should we work on?</h1>
          </motion.div>
        </div>
      </motion.div>
    );
  }

  const lastAssistantIdx = [...messages].reverse().findIndex((m) => m.role === "assistant");
  const lastAssistantMessageId =
    lastAssistantIdx >= 0 ? messages[messages.length - 1 - lastAssistantIdx]?.id : undefined;

  if (messages.length >= VIRTUALIZED_THRESHOLD) {
    return (
      <div className="flex-1 relative" role="log" aria-label="Chat messages" aria-live="polite">
        <Virtuoso
          ref={virtuosoRef}
          data={messages}
          atBottomStateChange={setIsAtBottom}
          atBottomThreshold={100}
          itemContent={(index, msg) => (
            <div className={index > 0 ? "mt-6" : ""}>
              <MessageBubble
                message={msg}
                onRetry={onRetry}
                generationState={generationState}
                generationLabel={generationLabel}
                isLastAssistant={msg.id === lastAssistantMessageId}
              />
            </div>
          )}
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
      generationLabel={generationLabel}
      lastAssistantMessageId={lastAssistantMessageId}
    />
  );
}

function NonVirtualizedChatArea({
  messages,
  setIsAtBottom,
  onRetry,
  generationState,
  generationLabel,
  lastAssistantMessageId,
}: {
  messages: Message[];
  setIsAtBottom: (v: boolean) => void;
  onRetry?: () => void;
  generationState: GenerationState;
  generationLabel: string;
  lastAssistantMessageId: string | undefined;
}) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const onScroll = () => {
      const target = scrollContainerRef.current;
      if (!target) return;
      const atBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 100;
      setIsAtBottom(atBottom);
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [setIsAtBottom]);

  return (
    <div
      ref={scrollContainerRef}
      data-chat-scroll
      className="flex-1 overflow-y-auto px-8 md:px-12 relative"
      role="log"
      aria-label="Chat messages"
      aria-live="polite"
    >
      <div className="max-w-4xl mx-auto w-full px-8 md:px-12 py-8 space-y-6">
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            onRetry={onRetry}
            generationState={generationState}
            generationLabel={generationLabel}
            isLastAssistant={msg.id === lastAssistantMessageId}
          />
        ))}
        <div aria-hidden="true" className="h-1" />
      </div>
    </div>
  );
}
