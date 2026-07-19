import React, { useEffect } from "react";
import { X } from "lucide-react";
import ChatArea from "./ChatArea";
import { ResponseSettingsSelector } from "./ResponseSettingsSelector";
import { useScrollButton } from "../hooks/useScrollPosition";
import { useScrollTracking } from "../hooks/useScrollTracking";
import type { Conversation, ModelConfig, GenerationState } from "../types";
import { useModelStore } from "../store/useModelStore";
import { useTranslation } from "../utils/i18n";

interface ComparisonColumnProps {
  conversation: Conversation;
  isPrimary?: boolean;
  label: string;
  models: ModelConfig[];
  onModelChange: (modelId: string) => void;
  onClose?: () => void;
  generationState: GenerationState;
  onRetry: () => void;
  isStreaming: boolean;
  onScroll?: (scrollTop: number, ratio: number) => void;
}

export const ComparisonColumn = React.memo(
  React.forwardRef<any, ComparisonColumnProps>(
    (
      {
        conversation,
        isPrimary = false,
        label,
        models,
        onModelChange,
        onClose,
        generationState,
        onRetry,
        isStreaming,
        onScroll,
      },
      ref,
    ) => {
      const { t } = useTranslation();
      const scroll = useScrollButton();
      const nonVirtualizedRef = React.useRef<HTMLDivElement>(null);
      const modelStatuses = useModelStore((state) => state.modelStatuses);

      React.useImperativeHandle(
        ref,
        () => ({
          scrollTo: (options: ScrollToOptions) => {
            if (scroll.virtuosoRef.current) {
              scroll.virtuosoRef.current.scrollTo(options);
            } else if (nonVirtualizedRef.current) {
              nonVirtualizedRef.current.scrollTo(options);
            }
          },
          scrollToIndex: (options: any) => {
            if (scroll.virtuosoRef.current) {
              scroll.virtuosoRef.current.scrollToIndex(options);
            } else if (nonVirtualizedRef.current) {
              nonVirtualizedRef.current.scrollTo({
                top: nonVirtualizedRef.current.scrollHeight,
                behavior: options?.behavior,
              });
            }
          },
          getScroller: () => {
            return (scroll.virtuosoRef.current as any)?._scroller || nonVirtualizedRef.current;
          },
        }),
        [scroll.virtuosoRef, nonVirtualizedRef],
      );

      const messages = conversation.messages;
      useScrollTracking(conversation.id, messages.length, scroll.isAtBottom, isStreaming);

      useEffect(() => {
        if (isStreaming && scroll.isAtBottom) {
          scroll.scrollToBottom("auto");
        }
      }, [messages.length, isStreaming, scroll.isAtBottom]);

      return (
        <section
          aria-label={`${label} response`}
          className="comparison-column-panel min-h-0 flex flex-col relative bg-chat"
        >
          <div className="shrink-0 px-4 py-2 text-xs font-medium border-b border-border/70 bg-surface/35 backdrop-blur-sm flex items-center justify-between gap-2 relative z-10">
            <span className={`min-w-0 flex-1 truncate ${isPrimary ? "text-text-primary" : "text-text-muted"}`}>
              {label}
            </span>
            <div className="flex shrink-0 items-center gap-1.5">
              <ResponseSettingsSelector
                models={models}
                selectedModel={conversation.model}
                onModelChange={onModelChange}
                modelStatuses={modelStatuses}
                placement="below"
                triggerClassName="max-w-[190px] border border-border bg-surface shadow-sm"
              />
              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  className="ml-1 rounded-md p-1 text-text-muted transition-colors hover:bg-hover hover:text-text-primary"
                  title={t("chat.removeComparison") || "Remove comparison"}
                  aria-label={t("chat.removeComparison") || "Remove comparison"}
                >
                  <X size={12} aria-hidden="true" />
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
            onScroll={onScroll}
            conversationId={conversation.id}
            pendingWorktree={conversation.pendingWorktree}
            scrollContainerRef={nonVirtualizedRef}
            showEmptyState={false}
          />
        </section>
      );
    },
  ),
);
