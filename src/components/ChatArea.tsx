import { useState, useEffect, useRef, memo, useCallback, useDeferredValue } from "react";
import ReactMarkdown from "react-markdown";
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
} from "lucide-react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import type { Message, GenerationState } from "../types";
import { highlightCode } from "../utils/highlighter";

const GENERATION_STATE_CONFIG: Record<
  Exclude<GenerationState, "idle">,
  { icon: React.ElementType; colorClass: string; label: string }
> = {
  thinking: { icon: Sparkles, colorClass: "text-purple-500", label: "Thinking" },
  searching: { icon: Search, colorClass: "text-blue-500", label: "Searching" },
  fetching: { icon: Globe, colorClass: "text-cyan-500", label: "Fetching" },
  responding: { icon: Bot, colorClass: "text-accent", label: "Responding" },
  mcp_executing: { icon: Wrench, colorClass: "text-orange-500", label: "Running MCP tool" },
  error: { icon: Loader2, colorClass: "text-red-500", label: "Error" },
};

interface ChatAreaProps {
  messages: Message[];
  isAtBottom: boolean;
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
    <div className="flex items-center gap-2 py-1.5 animate-fade-in">
      <div
        className={`shrink-0 w-5 h-5 rounded-md flex items-center justify-center ${state === "error" ? "bg-red-500/10" : "bg-accent/10"}`}
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
    </div>
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
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-text-muted hover:text-text-secondary hover:bg-hover transition-colors opacity-0 group-hover:opacity-100"
          aria-label={copied ? "Copied" : "Copy code"}
        >
          {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
          {copied ? "Copied" : "Copy"}
        </button>
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
  if (children && typeof children === "object" && "props" in children) {
    return extractText((children as any).props?.children);
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
    <button
      onClick={onClick}
      className={`p-1 rounded-md text-text-muted hover:text-text-secondary hover:bg-hover transition-colors flex items-center justify-center ${
        active ? "text-accent" : ""
      }`}
      aria-label={label}
      title={label}
    >
      {active && activeIcon ? activeIcon : icon}
    </button>
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
        activeIcon={<Check size={14} className="text-green-500" />}
        active={copied}
        label={copied ? "Copied" : "Copy"}
        onClick={handleCopy}
      />
      {!isUser && <ActionButton icon={<RotateCw size={14} />} label="Regenerate" onClick={onRetry} />}
      {sources && sources.length > 0 && (
        <>
          <span className="w-px h-3.5 bg-border/50 mx-1" />
          <button
            onClick={onSourceClick}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] text-text-muted hover:text-accent hover:bg-accent-soft transition-colors"
            title={`${sources.length} source${sources.length !== 1 ? "s" : ""}`}
          >
            <Globe size={12} />
            <span>
              {sources.length} source{sources.length !== 1 ? "s" : ""}
            </span>
          </button>
        </>
      )}
    </div>
  );
}

function SourcesList({ sources }: { sources: { title: string; url: string }[] }) {
  return (
    <div className="mt-1.5 p-2 rounded-lg bg-surface/50 border border-border/40">
      <div className="flex flex-wrap gap-1.5">
        {sources.map((s, i) => (
          <a
            key={i}
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] text-text-secondary hover:text-accent hover:bg-accent-soft border border-border/30 max-w-[200px] truncate transition-colors"
            title={s.title || s.url}
          >
            <ExternalLink size={10} className="shrink-0 text-text-muted" />
            <span className="truncate">{s.title || s.url}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

function ToolCallDisplay({ message }: { message: Message }) {
  const { name, arguments: args } = message.toolCall!;
  const isSearch = name === "search_query";
  const isFetch = name === "fetch_url";
  const isMcp = name.includes("__");
  const isCompleted = !!message.toolResult;

  const mcpParts = isMcp ? name.split("__") : [];
  const mcpToolName = mcpParts.length > 1 ? mcpParts.slice(1).join("__") : name;
  const mcpServerName = mcpParts[0] ?? "";

  return (
    <div className="flex items-start gap-2 animate-fade-in">
      <div
        className={`shrink-0 w-7 h-7 rounded-lg border flex items-center justify-center mt-0.5 ${
          isCompleted ? "bg-green-500/10 border-green-500/20" : "bg-yellow-500/10 border-yellow-500/20"
        }`}
        aria-hidden="true"
      >
        {isSearch ? (
          <Search size={14} className={isCompleted ? "text-green-500" : "text-yellow-500"} />
        ) : isFetch ? (
          <Globe size={14} className={isCompleted ? "text-green-500" : "text-yellow-500"} />
        ) : (
          <Wrench size={14} className={isCompleted ? "text-green-500" : "text-yellow-500"} />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div
          className={`flex items-center gap-1.5 text-xs font-medium ${
            isCompleted ? "text-green-600 dark:text-green-400" : "text-yellow-600 dark:text-yellow-400"
          }`}
        >
          <span>
            {isCompleted
              ? isSearch
                ? "Search results"
                : isFetch
                  ? "Page content"
                  : isMcp
                    ? `Tool result: ${mcpToolName}`
                    : "Tool result"
              : isSearch
                ? "Searching"
                : isFetch
                  ? "Fetching"
                  : isMcp
                    ? `Running: ${mcpToolName} via ${mcpServerName}`
                    : "Calling tool"}
          </span>
          {!isCompleted && <Loader2 size={12} className="animate-spin" />}
        </div>
        {isCompleted ? (
          <ToolResultContent message={message} />
        ) : (
          <p className="text-xs text-text-muted mt-0.5 font-mono truncate">
            {isSearch && args.query
              ? `"${args.query}"`
              : isFetch && args.url
                ? args.url
                : isMcp
                  ? `${mcpToolName}(${Object.values(args).join(", ")})`
                  : JSON.stringify(args)}
          </p>
        )}
      </div>
    </div>
  );
}

function ToolResultContent({ message }: { message: Message }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-text-muted hover:text-text-secondary text-xs flex items-center gap-1 mt-0.5"
        aria-label={expanded ? "Collapse" : "Expand"}
      >
        <ChevronDown size={12} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
        {expanded ? "Hide details" : "Show details"}
      </button>
      {expanded && (
        <div className="mt-1 p-2 rounded-lg bg-input border border-input-border text-xs text-text-muted overflow-x-auto max-h-48 overflow-y-auto">
          <pre className="whitespace-pre-wrap break-words font-mono text-[10px]">{message.content.slice(0, 2000)}</pre>
        </div>
      )}
    </div>
  );
}

function ToolCallBubble({ message }: { message: Message }) {
  if (message.toolCall) return <ToolCallDisplay message={message} />;
  if (message.toolResult) return <LegacyToolResultDisplay message={message} />;
  return null;
}

function LegacyToolResultDisplay({ message }: { message: Message }) {
  const { name } = message.toolResult!;
  const isSearch = name === "search_query";
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="flex items-start gap-2 animate-fade-in">
      <div
        className="shrink-0 w-7 h-7 rounded-lg bg-green-500/10 border border-green-500/20 flex items-center justify-center mt-0.5"
        aria-hidden="true"
      >
        {isSearch ? <Search size={14} className="text-green-500" /> : <Globe size={14} className="text-green-500" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 text-xs font-medium text-green-600 dark:text-green-400">
          <span>{isSearch ? "Search results" : "Page content"}</span>
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-text-muted hover:text-text-secondary"
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            <ChevronDown size={12} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
          </button>
        </div>
        {expanded ? (
          <div className="mt-1 p-2 rounded-lg bg-input border border-input-border text-xs text-text-muted overflow-x-auto max-h-48 overflow-y-auto">
            <pre className="whitespace-pre-wrap break-words font-mono text-[10px]">
              {message.content.slice(0, 2000)}
            </pre>
          </div>
        ) : (
          <p className="text-[10px] text-text-muted mt-0.5 truncate">{message.content.slice(0, 120)}...</p>
        )}
      </div>
    </div>
  );
}

function ReasoningBubble({ content, isStreaming }: { content: string; isStreaming?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const hasContent = content.length > 0;

  return (
    <div className="flex items-start gap-2 animate-fade-in mb-2">
      <div
        className="shrink-0 w-7 h-7 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mt-0.5"
        aria-hidden="true"
      >
        {isStreaming ? (
          <Loader2 size={14} className="animate-spin text-purple-500" />
        ) : (
          <Sparkles size={14} className="text-purple-500" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 text-xs font-medium text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 transition-colors"
          aria-label={expanded ? "Collapse reasoning" : "Expand reasoning"}
        >
          <span>Thinking</span>
          <ChevronDown size={12} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
        {expanded ? (
          <div className="mt-1.5 p-2.5 rounded-lg bg-purple-500/5 border border-purple-500/15 text-xs text-text-secondary overflow-x-auto max-h-48 overflow-y-auto">
            <p className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">
              {content || "Thinking..."}
            </p>
          </div>
        ) : isStreaming && !hasContent ? (
          <span className="generating-dots mt-0.5">
            <span />
            <span />
            <span />
          </span>
        ) : hasContent ? (
          <p className="text-[10px] text-text-muted mt-0.5 truncate italic">
            {content.slice(0, 120)}
            {content.length > 120 && "..."}
          </p>
        ) : null}
      </div>
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
  const hasOpenReasoning =
    message.role === "assistant" &&
    (message.content.includes("<reasoning>") ||
      message.content.includes("<thinking>") ||
      message.content.includes("<thought>"));
  const [sourcesExpanded, setSourcesExpanded] = useState(false);

  if (isTool) {
    return <ToolCallBubble message={message} />;
  }

  if (isUser) {
    return (
      <div
        className="flex justify-end animate-fade-in group"
        role="article"
        aria-label={`User message: ${message.content.slice(0, 80)}`}
      >
        <div className="max-w-[75%]">
          <div className="glass-panel rounded-2xl rounded-br-md px-4 py-3 text-sm text-text-primary leading-relaxed shadow-sm whitespace-pre-wrap break-words">
            {message.content}
          </div>
          <div className="flex justify-end">
            <MessageActions content={message.content} isUser />
          </div>
        </div>
      </div>
    );
  }

  // Parse reasoning content (supports <reasoning>, <thinking>, <thought> tags from different LLMs)
  let reasoningContent = "";
  let displayContent = message.content;
  if (hasOpenReasoning) {
    const reasoningMatch =
      message.content.match(/<reasoning>([\s\S]*?)<\/reasoning>/) ||
      message.content.match(/<thinking>([\s\S]*?)<\/thinking>/) ||
      message.content.match(/<thought>([\s\S]*?)<\/thought>/);
    if (reasoningMatch) {
      reasoningContent = reasoningMatch[1].trim();
      displayContent = message.content
        .replace(/<(?:reasoning|thinking|thought)>[\s\S]*?<\/(?:reasoning|thinking|thought)>/, "")
        .trim();
    } else {
      // Stream in progress — extract content between opening tag and end of string
      const openMatch =
        message.content.match(/<reasoning>([\s\S]*)/) ||
        message.content.match(/<thinking>([\s\S]*)/) ||
        message.content.match(/<thought>([\s\S]*)/);
      if (openMatch) {
        reasoningContent = openMatch[1].trim();
        displayContent = message.content.replace(/<(?:reasoning|thinking|thought)>[\s\S]*/, "").trim();
      }
    }
  }

  const isStreaming = !!message.isStreaming;
  const showGenerationIndicator = isLastAssistant && isStreaming && generationState && generationState !== "idle";

  return (
    <div
      className="flex justify-start gap-3 animate-fade-in group"
      role="article"
      aria-label={`Assistant message${isStreaming ? " (generating)" : ""}: ${message.content.slice(0, 80)}`}
    >
      <div
        className="shrink-0 w-7 h-7 rounded-lg border bg-accent/10 border-accent/20 flex items-center justify-center mt-0.5"
        aria-hidden="true"
      >
        <Bot size={14} className="text-accent" />
      </div>
      <div className="max-w-[80%] text-sm text-text-primary leading-relaxed">
        {hasOpenReasoning && <ReasoningBubble content={reasoningContent} isStreaming={isStreaming} />}
        {!hasOpenReasoning && isStreaming && displayContent.length === 0 && !showGenerationIndicator && (
          <div className="flex items-center gap-2 py-1">
            <Loader2 size={14} className="text-accent animate-spin" />
            <span className="text-xs text-text-muted font-medium">Thinking</span>
            <span className="generating-dots">
              <span />
              <span />
              <span />
            </span>
          </div>
        )}
        {showGenerationIndicator && !hasOpenReasoning && displayContent.length === 0 && (
          <GenerationIndicator state={generationState!} label={generationLabel!} />
        )}
        <div className="markdown-body">
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
        {sourcesExpanded && message.sources && message.sources.length > 0 && <SourcesList sources={message.sources} />}
      </div>
    </div>
  );
});

const VIRTUALIZED_THRESHOLD = 50;

export default function ChatArea({
  messages,
  isAtBottom,
  setIsAtBottom,
  virtuosoRef,
  onRetry,
  generationState,
  generationLabel,
}: ChatAreaProps) {
  if (messages.length === 0) {
    return (
      <div
        className="flex-1 flex flex-col items-center justify-end select-none relative pb-2 translate-y-[-7vh]"
        role="region"
        aria-label="Empty chat — type a message to begin"
      >
        <div className="flex flex-col items-center gap-4 px-4 transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]">
          <div
            className="w-14 h-14 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center"
            aria-hidden="true"
          >
            <Bot size={28} className="text-accent" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight text-text-primary">Sythoria</h1>
            <p className="text-text-muted text-sm mt-1">Your intelligent AI assistant</p>
          </div>
        </div>
      </div>
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
      isAtBottom={isAtBottom}
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
  isAtBottom: boolean;
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
      className="flex-1 overflow-y-auto px-4 md:px-0 relative"
      role="log"
      aria-label="Chat messages"
      aria-live="polite"
    >
      <div className="max-w-3xl mx-auto py-8 space-y-6">
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
