import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Message, ConnectionStatus } from "../types";
import { STATUS_COLORS } from "../types";

interface ChatAreaProps {
  messages: Message[];
  connectionStatus: ConnectionStatus;
}

function StreamingText({ content }: { content: string }) {
  return (
    <span>
      {content}
      <span className="cursor-blink" />
    </span>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end animate-fade-in">
        <div className="max-w-[75%] glass-panel rounded-2xl rounded-br-md px-4 py-3 text-sm text-text-primary leading-relaxed shadow-sm">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start animate-fade-in">
      <div className="max-w-[80%] text-sm text-text-primary leading-relaxed markdown-body">
        {message.isStreaming ? (
          <StreamingText content={message.content} />
        ) : (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {message.content}
          </ReactMarkdown>
        )}
      </div>
    </div>
  );
}

export default function ChatArea({ messages, connectionStatus }: ChatAreaProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const showStatus = connectionStatus !== 'connected';

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center select-none animate-slide-up relative">
        <div className="absolute top-4 right-4 flex items-center gap-2">
          {showStatus && (
            <div className="flex items-center gap-2 px-2 py-1 rounded-full bg-white/50 dark:bg-white/10 border border-border text-[10px] font-medium text-text-secondary">
              <div className={`w-2 h-2 rounded-full ${STATUS_COLORS[connectionStatus]}`} />
              {connectionStatus === 'error' && <span>Connection error</span>}
              {connectionStatus === 'connecting' && <span>Connecting...</span>}
              {connectionStatus === 'disconnected' && <span>Disconnected</span>}
            </div>
          )}
        </div>
        <div className="flex flex-col items-center gap-3">
          <h1 className="text-4xl font-bold tracking-tight text-text-primary">
            Sythoria
          </h1>
          <p className="text-text-muted text-base">
            Your intelligent AI assistant
          </p>
          <div className="mt-4 flex gap-2">
            <span className="w-2 h-2 rounded-full bg-accent animate-pulse-soft" />
            <span
              className="w-2 h-2 rounded-full bg-accent animate-pulse-soft"
              style={{ animationDelay: "0.4s" }}
            />
            <span
              className="w-2 h-2 rounded-full bg-accent animate-pulse-soft"
              style={{ animationDelay: "0.8s" }}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 md:px-0 relative">
      {showStatus && (
        <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
          <div className="flex items-center gap-2 px-2 py-1 rounded-full bg-white/50 dark:bg-white/10 border border-border text-[10px] font-medium text-text-secondary">
            <div className={`w-2 h-2 rounded-full ${STATUS_COLORS[connectionStatus]}`} />
            {connectionStatus === 'error' && <span>Connection error</span>}
            {connectionStatus === 'connecting' && <span>Connecting...</span>}
            {connectionStatus === 'disconnected' && <span>Disconnected</span>}
          </div>
        </div>
      )}
      <div className="max-w-3xl mx-auto py-8 space-y-6">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
