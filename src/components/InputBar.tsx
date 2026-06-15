import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Send, Plus, Paperclip, ChevronDown, Check, Search, Square, Loader2, Cpu } from "lucide-react";
import { STATUS_COLORS, ModelConfig, McpServerConfig, McpServerStatus } from "../types";
import type { ModelStatuses } from "../types";
import { MAX_INPUT_LENGTH, MAX_TEXTAREA_HEIGHT } from "../config/constants";
import { springs, motionTokens } from "../lib/motion-tokens";

interface InputBarProps {
  models: ModelConfig[];
  onSend: (message: string) => void;
  selectedModel: string;
  onModelChange: (model: string) => void;
  disabled?: boolean;
  modelStatuses: ModelStatuses;
  isSearchEnabled: boolean;
  onToggleSearch: (enabled: boolean) => void;
  mcpServers: McpServerConfig[];
  mcpServerStatuses: Record<string, McpServerStatus>;
  enabledMcpServerIds: Set<string>;
  onToggleMcpServer: (serverId: string) => void;
  isStreaming?: boolean;
  onStop?: () => void;
  centered?: boolean;
}

const STATUS_LABELS: Record<string, string> = {
  disconnected: "Disconnected",
  connecting: "Connecting\u2026",
  connected: "Connected",
  error: "Connection error",
};

export default function InputBar({
  models,
  onSend,
  selectedModel,
  onModelChange,
  disabled,
  modelStatuses,
  isSearchEnabled,
  onToggleSearch,
  mcpServers,
  mcpServerStatuses,
  enabledMcpServerIds,
  onToggleMcpServer,
  isStreaming,
  onStop,
  centered = false,
}: InputBarProps) {
  const [value, setValue] = useState("");
  const [modelOpen, setModelOpen] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const plusDropdownRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const anyToolActive = isSearchEnabled || enabledMcpServerIds.size > 0;
  const connectedMcpServers = mcpServers.filter((s) => (mcpServerStatuses[s.id] ?? "disconnected") === "connected");

  const isOverLimit = value.length > MAX_INPUT_LENGTH;
  const trimmed = value.trim();
  const canSend = trimmed.length > 0 && !isOverLimit && !disabled && !isStreaming;
  const enabledModels = models.filter((m) => m.enabled !== false);

  useEffect(() => {
    if (isStreaming && textareaRef.current) {
      textareaRef.current.blur();
    }
  }, [isStreaming]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      const newHeight = Math.min(textareaRef.current.scrollHeight, MAX_TEXTAREA_HEIGHT);
      textareaRef.current.style.height = newHeight + "px";
      textareaRef.current.style.overflowY = textareaRef.current.scrollHeight > MAX_TEXTAREA_HEIGHT ? "auto" : "hidden";
    }
  }, [value]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setModelOpen(false);
        setFocusedIndex(-1);
      }
      if (plusDropdownRef.current && !plusDropdownRef.current.contains(e.target as Node)) {
        setPlusOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleSubmit = useCallback(() => {
    if (!canSend) return;
    onSend(trimmed);
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [canSend, trimmed, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (modelOpen || plusOpen) {
        if (e.key === "Escape") {
          setModelOpen(false);
          setPlusOpen(false);
          setFocusedIndex(-1);
        }
        if (modelOpen) {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setFocusedIndex((i) => Math.min(i + 1, enabledModels.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setFocusedIndex((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter" && focusedIndex >= 0) {
            e.preventDefault();
            onModelChange(enabledModels[focusedIndex].id);
            setModelOpen(false);
            setFocusedIndex(-1);
          }
        }
        return;
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [modelOpen, plusOpen, focusedIndex, enabledModels, onModelChange, handleSubmit],
  );

  useEffect(() => {
    if (focusedIndex >= 0 && itemRefs.current[focusedIndex]) {
      itemRefs.current[focusedIndex]?.focus();
    }
  }, [focusedIndex]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    if (val.length <= MAX_INPUT_LENGTH + 100) {
      setValue(val);
    }
  };

  const currentModel =
    models.find((m) => m.id === selectedModel && m.enabled !== false) ??
    models.find((m) => m.enabled !== false) ??
    models[0];
  const currentStatus = modelStatuses[selectedModel] ?? "disconnected";

  return (
    <div
      className={`transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
        centered
          ? "flex-1 flex flex-col items-center translate-y-[-7vh] pt-4"
          : "px-4 pb-[env(safe-area-inset-bottom,16px)] pt-2 md:px-0 md:pb-4"
      }`}
    >
      <div className="max-w-3xl mx-auto w-full px-4 md:px-0">
        <label htmlFor="chat-input" className="sr-only">
          Message
        </label>
        <div
          className={`flex items-center gap-2 glass-panel rounded-2xl px-3 py-2.5 transition-colors focus-within:border-text-muted ${isOverLimit ? "border-red-500/50" : ""} ${isStreaming ? "dark:animate-border-glow animate-border-glow-light" : ""}`}
        >
          {/* Plus / tools button */}
          <div ref={plusDropdownRef} className="relative shrink-0">
            <button
              onClick={() => setPlusOpen(!plusOpen)}
              className={`p-2 rounded-lg transition-colors flex items-center justify-center ${
                anyToolActive
                  ? "text-text-primary bg-active"
                  : "text-text-muted hover:text-text-secondary hover:bg-hover"
              }`}
              aria-label="Attach or search"
              aria-expanded={plusOpen}
              aria-haspopup="menu"
            >
              <Plus size={18} />
            </button>

            <AnimatePresence>
              {plusOpen && (
                <motion.div
                  className="absolute bottom-full left-0 mb-2 w-56 bg-surface border border-border rounded-xl py-1 z-50"
                  style={{ boxShadow: "var(--shadow-xl)" }}
                  role="menu"
                  aria-label="Attachment and search options"
                  initial={{ opacity: 0, y: 8, scale: motionTokens.scale.subtle }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: motionTokens.scale.subtle }}
                  transition={springs.gentle}
                >
                  <button
                    onClick={() => {
                      setPlusOpen(false);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-text-muted hover:bg-hover hover:text-text-secondary transition-colors cursor-not-allowed"
                    role="menuitem"
                    disabled
                  >
                    <Paperclip size={15} />
                    <span>Add File</span>
                    <span className="ml-auto text-[10px] text-text-muted/60">Soon</span>
                  </button>
                  <button
                    onClick={() => {
                      onToggleSearch(!isSearchEnabled);
                      setPlusOpen(false);
                    }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors ${
                      isSearchEnabled
                        ? "text-text-primary bg-active"
                        : "text-text-secondary hover:bg-hover hover:text-text-primary"
                    }`}
                    role="menuitemcheckbox"
                    aria-checked={isSearchEnabled}
                  >
                    <Search size={15} className={isSearchEnabled ? "text-text-primary" : "text-text-muted"} />
                    <span>Web Search</span>
                    {isSearchEnabled && <Check size={14} className="text-text-primary ml-auto" />}
                  </button>
                  {connectedMcpServers.length > 0 && (
                    <>
                      <div className="border-t border-border my-1" />
                      {connectedMcpServers.map((server) => {
                        const isEnabled = enabledMcpServerIds.has(server.id);
                        return (
                          <button
                            key={server.id}
                            onClick={() => {
                              onToggleMcpServer(server.id);
                            }}
                            className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors ${
                              isEnabled
                                ? "text-text-primary bg-active"
                                : "text-text-secondary hover:bg-hover hover:text-text-primary"
                            }`}
                            role="menuitemcheckbox"
                            aria-checked={isEnabled}
                          >
                            <Cpu size={15} className={isEnabled ? "text-text-primary" : "text-text-muted"} />
                            <span className="truncate">{server.name}</span>
                            {isEnabled && <Check size={14} className="text-text-primary ml-auto" />}
                          </button>
                        );
                      })}
                    </>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <textarea
            id="chat-input"
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${currentModel?.name ?? "Sythoria"}…`}
            rows={1}
            disabled={disabled}
            aria-describedby={isOverLimit ? "input-limit-error" : "input-hint"}
            aria-invalid={isOverLimit}
            className={`flex-1 min-w-0 bg-transparent text-sm text-text-primary placeholder-text-muted resize-none outline-none leading-relaxed overflow-y-hidden ${isOverLimit ? "text-red-400" : ""}`}
          />

          {/* Model selector */}
          <div ref={dropdownRef} className="relative shrink-0">
            <button
              onClick={() => {
                setModelOpen(!modelOpen);
                setFocusedIndex(-1);
              }}
              className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-hover transition-colors max-w-[140px]"
              aria-label={`Select model: currently ${currentModel?.name ?? "None"}`}
              aria-expanded={modelOpen}
              aria-haspopup="listbox"
            >
              <div
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_COLORS[currentStatus]}`}
                title={STATUS_LABELS[currentStatus] ?? currentStatus}
                aria-hidden="true"
              />
              <span className="truncate">{currentModel?.name || "No Model"}</span>
              <ChevronDown
                size={13}
                className={`shrink-0 transition-transform duration-200 ${modelOpen ? "rotate-180" : ""}`}
                aria-hidden="true"
              />
            </button>

            <AnimatePresence>
              {modelOpen && (
                <motion.div
                  className="absolute bottom-full right-0 mb-2 w-64 bg-surface border border-border rounded-xl py-1 z-50 max-h-72 overflow-y-auto overflow-x-hidden"
                  style={{ boxShadow: "var(--shadow-xl)" }}
                  role="listbox"
                  aria-label="Available models"
                  initial={{ opacity: 0, y: 8, scale: motionTokens.scale.subtle }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: motionTokens.scale.subtle }}
                  transition={springs.gentle}
                >
                  {enabledModels.map((model, idx) => {
                    const status = modelStatuses[model.id] ?? "disconnected";
                    const isSelected = selectedModel === model.id;
                    return (
                      <button
                        key={model.id}
                        ref={(el) => {
                          itemRefs.current[idx] = el;
                        }}
                        onClick={() => {
                          onModelChange(model.id);
                          setModelOpen(false);
                          setFocusedIndex(-1);
                        }}
                        className={`w-full flex items-center gap-2.5 px-2.5 py-2 text-sm transition-colors text-left ${
                          isSelected
                            ? "bg-active text-text-primary"
                            : "text-text-secondary hover:bg-hover hover:text-text-primary"
                        }`}
                        role="option"
                        aria-selected={isSelected}
                      >
                        <div
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_COLORS[status]}`}
                          title={STATUS_LABELS[status] ?? status}
                          aria-label={STATUS_LABELS[status] ?? status}
                        />
                        <div className="flex-1 min-w-0">
                          <span className="block font-medium truncate">{model.name}</span>
                          <span className="block text-[10px] text-text-muted truncate" title={model.apiBase}>
                            {model.modelId}
                          </span>
                        </div>
                        {isSelected && <Check size={14} className="text-text-primary shrink-0" aria-hidden="true" />}
                      </button>
                    );
                  })}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Send / Stop button */}
          <button
            onClick={isStreaming ? onStop : handleSubmit}
            disabled={!isStreaming && !canSend}
            className={`shrink-0 p-2 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center ${
              isStreaming
                ? "bg-red-500/90 hover:bg-red-600 text-white"
                : "bg-accent hover:bg-accent-hover text-accent-foreground disabled:bg-input disabled:text-text-muted"
            }`}
            aria-label={isStreaming ? "Stop generating" : "Send message"}
          >
            {isStreaming ? <Square size={15} className="fill-current" /> : <Send size={15} />}
          </button>
        </div>

        <p
          id={isOverLimit ? "input-limit-error" : "input-hint"}
          className="mt-2 text-center text-[11px] text-text-muted"
        >
          {isOverLimit ? (
            <span className="text-red-400" role="alert">
              Message exceeds {MAX_INPUT_LENGTH.toLocaleString()} character limit
            </span>
          ) : isStreaming ? (
            <span className="flex items-center justify-center gap-2 text-text-secondary font-medium animate-generating-pulse">
              <Loader2 size={13} className="animate-spin" />
              <span>Generating response</span>
              <span className="generating-dots">
                <span />
                <span />
                <span />
              </span>
            </span>
          ) : isSearchEnabled ? (
            <span className="flex items-center justify-center gap-1.5">
              <Search size={11} className="text-text-secondary" />
              Web Search enabled
            </span>
          ) : enabledMcpServerIds.size > 0 ? (
            <span className="flex items-center justify-center gap-1.5">
              <Cpu size={11} className="text-text-secondary" />
              {enabledMcpServerIds.size} MCP server{enabledMcpServerIds.size !== 1 ? "s" : ""} enabled
            </span>
          ) : (
            "Sythoria can make mistakes. Consider checking important information."
          )}
        </p>
      </div>
    </div>
  );
}
