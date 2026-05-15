import { useEffect, useRef, memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Bot, Sparkles, Code, BookOpen, Lightbulb } from "lucide-react";
import type { Message, ConnectionStatus } from "../types";
import { STATUS_COLORS } from "../types";

interface ChatAreaProps {
  messages: Message[];
  connectionStatus: ConnectionStatus;
  onSuggestionClick: (prompt: string) => void;
}

function MessageContent({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  const markdown = useMemo(() => <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>, [content]);

  return (
    <>
      {markdown}
      {isStreaming && <span className="cursor-blink" />}
    </>
  );
}

const MessageBubble = memo(function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end animate-fade-in">
        <div className="max-w-[75%] glass-panel rounded-2xl rounded-br-md px-4 py-3 text-sm text-text-primary leading-relaxed shadow-sm whitespace-pre-wrap break-words">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start gap-3 animate-fade-in">
      <div className="shrink-0 w-7 h-7 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center mt-0.5">
        <Bot size={14} className="text-accent" />
      </div>
      <div className="max-w-[80%] text-sm text-text-primary leading-relaxed markdown-body">
        <MessageContent content={message.content} isStreaming={!!message.isStreaming} />
      </div>
    </div>
  );
});

const SUGGESTIONS = [
  { icon: <Sparkles size={16} />, label: "Creative writing", prompt: "Help me write a short story" },
  { icon: <Code size={16} />, label: "Code help", prompt: "Explain this code snippet" },
  { icon: <BookOpen size={16} />, label: "Research", prompt: "Summarize a topic for me" },
  { icon: <Lightbulb size={16} />, label: "Brainstorm", prompt: "Help me brainstorm ideas" },
];

export default function ChatArea({ messages, connectionStatus, onSuggestionClick }: ChatAreaProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const showStatus = connectionStatus !== "connected";

  const statusBadge = (
    <div className="flex items-center gap-2 px-2 py-1 rounded-full bg-white/50 dark:bg-white/10 border border-border text-[10px] font-medium text-text-secondary">
      <div className={`w-2 h-2 rounded-full ${STATUS_COLORS[connectionStatus]}`} />
      {connectionStatus === "error" && <span>Connection error</span>}
      {connectionStatus === "connecting" && <span>Connecting...</span>}
      {connectionStatus === "disconnected" && <span>Disconnected</span>}
    </div>
  );

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center select-none animate-slide-up relative">
        <div className="absolute top-4 right-4 flex items-center gap-2">{showStatus && statusBadge}</div>
        <div className="flex flex-col items-center gap-4 px-4">
          <div className="w-14 h-14 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center">
            <Bot size={28} className="text-accent" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight text-text-primary">Sythoria</h1>
            <p className="text-text-muted text-sm mt-1">Your intelligent AI assistant</p>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 w-full max-w-sm">
            {SUGGESTIONS.map((s) => (
              <button
                key={s.label}
                onClick={() => onSuggestionClick(s.prompt)}
                className="flex items-center gap-2.5 px-3.5 py-3 rounded-xl border border-border bg-surface/50 hover:bg-hover text-text-secondary hover:text-text-primary text-xs font-medium transition-all duration-150 text-left"
              >
                <span className="text-accent shrink-0">{s.icon}</span>
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 md:px-0 relative">
      {showStatus && <div className="absolute top-4 right-4 z-10 flex items-center gap-2">{statusBadge}</div>}
      <div className="max-w-3xl mx-auto py-8 space-y-6">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
