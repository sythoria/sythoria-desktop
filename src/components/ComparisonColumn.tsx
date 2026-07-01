import React, { useEffect } from "react";
import { X } from "lucide-react";
import ChatArea from "./ChatArea";
import { useScrollButton } from "../hooks/useScrollPosition";
import { useScrollTracking } from "../hooks/useScrollTracking";
import type { Conversation, ModelConfig, GenerationState } from "../types";

interface ComparisonColumnProps {
  conversation: Conversation;
  isPrimary?: boolean;
  models: ModelConfig[];
  onModelChange: (modelId: string) => void;
  onClose?: () => void;
  generationState: GenerationState;
  generationLabel: string;
  onRetry: () => void;
  isStreaming: boolean;
  onScroll?: (scrollTop: number) => void;
}

export const ComparisonColumn = React.forwardRef<any, ComparisonColumnProps>(
  (
    {
      conversation,
      isPrimary = false,
      models,
      onModelChange,
      onClose,
      generationState,
      generationLabel,
      onRetry,
      isStreaming,
      onScroll,
    },
    ref,
  ) => {
    const scroll = useScrollButton();

    React.useImperativeHandle(ref, () => scroll.virtuosoRef.current, [scroll.virtuosoRef.current]);

    const messages = conversation.messages;
    useScrollTracking(conversation.id, messages.length, scroll.isAtBottom, isStreaming);

    // Track if we need to automatically scroll to bottom when new messages arrive
    useEffect(() => {
      if (isStreaming && scroll.isAtBottom) {
        scroll.scrollToBottom("auto");
      }
    }, [messages.length, isStreaming, scroll.isAtBottom]);

    return (
      <div className="min-h-0 min-w-0 flex flex-col relative bg-chat">
        <div className="shrink-0 px-4 py-2 text-xs font-medium text-text-muted border-b border-border flex items-center justify-between bg-surface/50 backdrop-blur-sm relative z-10">
          <span className="truncate max-w-[50%]">
            {isPrimary ? `Primary Chat (${conversation.title || "Primary"})` : conversation.title}
          </span>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-text-muted">Model:</span>
            <select
              value={conversation.model}
              onChange={(e) => onModelChange(e.target.value)}
              className="bg-surface border border-border rounded-md px-2 py-0.5 text-xs text-text-secondary outline-none focus:border-accent hover:border-text-muted transition-colors cursor-pointer max-w-[150px] shadow-sm"
            >
              {models
                .filter((m) => m.enabled !== false)
                .map((m) => (
                  <option key={m.id} value={m.id} className="bg-surface text-text-primary">
                    {m.name}
                  </option>
                ))}
            </select>
            {onClose && (
              <button
                onClick={onClose}
                className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-hover transition-colors ml-1"
                title="Remove comparison"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>
        <ChatArea
          messages={messages}
          setIsAtBottom={scroll.setIsAtBottom}
          virtuosoRef={scroll.virtuosoRef}
          onRetry={onRetry}
          generationState={generationState}
          generationLabel={generationLabel}
          onScroll={onScroll}
          conversationId={conversation.id}
          pendingWorktree={conversation.pendingWorktree}
        />
      </div>
    );
  },
);
