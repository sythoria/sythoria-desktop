import React, { useEffect, useRef, useState } from "react";
import { X, ChevronDown, Check } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import ChatArea from "./ChatArea";
import { useScrollButton } from "../hooks/useScrollPosition";
import { useScrollTracking } from "../hooks/useScrollTracking";
import type { Conversation, ModelConfig, GenerationState } from "../types";
import { STATUS_COLORS } from "../types";
import { useModelStore } from "../store/useModelStore";
import { useUIStore } from "../store/useUIStore";
import { motionTokens, springs } from "../lib/motion-tokens";
import { useTranslation } from "../utils/i18n";

const STATUS_KEYS: Record<string, string> = {
  disconnected: "status.disconnected",
  connecting: "status.connecting",
  connected: "status.connected",
  error: "status.error",
};

const STATUS_LABELS: Record<string, string> = {
  disconnected: "Disconnected",
  connecting: "Connecting\u2026",
  connected: "Connected",
  error: "Connection error",
};

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
  onScroll?: (scrollTop: number, ratio: number) => void;
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
    const { t } = useTranslation();
    const scroll = useScrollButton();
    const nonVirtualizedRef = React.useRef<HTMLDivElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const [modelOpen, setModelOpen] = useState(false);
    const modelStatuses = useModelStore((s) => s.modelStatuses);
    const disableBgActivity = useUIStore((s) => s.disableBgActivity);

    useEffect(() => {
      function handleClick(e: MouseEvent) {
        if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
          setModelOpen(false);
        }
      }
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }, []);

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

    // Track if we need to automatically scroll to bottom when new messages arrive
    useEffect(() => {
      if (isStreaming && scroll.isAtBottom) {
        scroll.scrollToBottom("auto");
      }
    }, [messages.length, isStreaming, scroll.isAtBottom]);

    return (
      <div
        className={`comparison-column-panel min-h-0 flex flex-col relative bg-chat ${isPrimary ? "primary-column" : ""}`}
      >
        <div
          className={`shrink-0 px-4 py-2 text-xs font-medium border-b flex items-center justify-between relative z-10 ${
            isPrimary
              ? "bg-accent-soft/40 text-text-primary font-semibold border-accent/20"
              : "bg-surface/50 backdrop-blur-sm text-text-muted border-border"
          }`}
        >
          <span className="truncate max-w-[50%]">
            {isPrimary
              ? `${t("chat.primaryChat")} (${conversation.title || t("chat.primary")})`
              : conversation.title?.endsWith(" (Compare)")
                ? `${conversation.title.slice(0, -10)} (${t("common.compare")})`
                : conversation.title === "Untitled" || !conversation.title
                  ? t("common.untitled")
                  : conversation.title}
          </span>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-text-muted">Model:</span>
            {/* Custom Model Selector */}
            <div ref={dropdownRef} className="relative shrink-0 z-20">
              <button
                onClick={() => setModelOpen(!modelOpen)}
                className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-hover transition-colors max-w-[140px] shadow-sm bg-surface border border-border"
                aria-label={`Select model: currently ${models.find((m) => m.id === conversation.model)?.name ?? "None"}`}
                aria-expanded={modelOpen}
                aria-haspopup="listbox"
              >
                {!disableBgActivity && (
                  <div
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_COLORS[modelStatuses[conversation.model] ?? "disconnected"]}`}
                    title={STATUS_LABELS[modelStatuses[conversation.model] ?? "disconnected"] ?? "disconnected"}
                    aria-hidden="true"
                  />
                )}
                <span className="truncate">{models.find((m) => m.id === conversation.model)?.name || "No Model"}</span>
                <ChevronDown
                  size={14}
                  className={`shrink-0 transition-transform duration-200 ${modelOpen ? "rotate-180" : ""}`}
                  aria-hidden="true"
                />
              </button>

              <AnimatePresence>
                {modelOpen && (
                  <motion.div
                    className="absolute top-full right-0 mt-1.5 w-64 bg-surface border border-border rounded-xl p-1 z-50 max-h-72 overflow-y-auto overflow-x-hidden"
                    style={{ boxShadow: "var(--shadow-xl)" }}
                    role="listbox"
                    aria-label="Available models"
                    initial={{ opacity: 0, y: 8, scale: motionTokens.scale.subtle }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: motionTokens.scale.subtle }}
                    transition={springs.gentle}
                  >
                    {models
                      .filter((m) => m.enabled !== false)
                      .map((model) => {
                        const status = modelStatuses[model.id] ?? "disconnected";
                        const isSelected = conversation.model === model.id;
                        return (
                          <button
                            key={model.id}
                            onClick={() => {
                              onModelChange(model.id);
                              setModelOpen(false);
                            }}
                            className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-colors text-left ${
                              isSelected
                                ? "bg-active text-text-primary"
                                : "text-text-secondary hover:bg-hover hover:text-text-primary"
                            }`}
                            role="option"
                            aria-selected={isSelected}
                          >
                            {!disableBgActivity && (
                              <div
                                className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_COLORS[status]}`}
                                title={t(STATUS_KEYS[status]) || STATUS_LABELS[status] || status}
                                aria-label={t(STATUS_KEYS[status]) || STATUS_LABELS[status] || status}
                              />
                            )}
                            <span className="truncate flex-1">{model.name}</span>
                            {isSelected && <Check size={14} className="text-accent shrink-0" aria-hidden="true" />}
                          </button>
                        );
                      })}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            {onClose && (
              <button
                onClick={onClose}
                className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-hover transition-colors ml-1"
                title={t("chat.removeComparison") || "Remove comparison"}
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
          scrollContainerRef={nonVirtualizedRef}
        />
      </div>
    );
  },
);
