import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Plus,
  Paperclip,
  ChevronDown,
  Check,
  Search,
  Square,
  Loader2,
  Cpu,
  X,
  Image as ImageIcon,
  FileText as FileTextIcon,
  ArrowUp,
} from "lucide-react";
import { STATUS_COLORS, ModelConfig, McpServerConfig, McpServerStatus, Attachment } from "../types";
import type { ModelStatuses } from "../types";
import { MAX_INPUT_LENGTH, MAX_TEXTAREA_HEIGHT } from "../config/constants";

import { formatFileSize } from "../utils/attachments";
import { springs, motionTokens } from "../lib/motion-tokens";
import { useAttachments } from "../hooks/useAttachments";
import { useUIStore } from "../store/useUIStore";

interface InputBarProps {
  models: ModelConfig[];
  onSend: (message: string, attachments?: Attachment[]) => void;
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

  const { attachments, setAttachments, isDragging, setIsDragging, fileInputRef, handleAddFiles, handleFileChange } =
    useAttachments();

  const sendMessageShortcut = useUIStore((s) => s.sendMessageShortcut);
  const clearInputOnEscape = useUIStore((s) => s.clearInputOnEscape);

  const anyToolActive = isSearchEnabled || enabledMcpServerIds.size > 0;
  const connectedMcpServers = mcpServers.filter((s) => (mcpServerStatuses[s.id] ?? "disconnected") === "connected");

  const isOverLimit = value.length > MAX_INPUT_LENGTH;
  const trimmed = value.trim();
  const canSend = (trimmed.length > 0 || attachments.length > 0) && !isOverLimit && !disabled && !isStreaming;
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
    if (attachments.length > 0) {
      onSend(trimmed, attachments);
    } else {
      onSend(trimmed);
    }
    setValue("");
    setAttachments([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [canSend, trimmed, attachments, onSend, setAttachments]);

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

      if (clearInputOnEscape && e.key === "Escape") {
        setValue("");
        return;
      }

      if (e.key === "Enter") {
        if (sendMessageShortcut === "ctrl-enter") {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            handleSubmit();
          }
        } else {
          if (!e.shiftKey) {
            e.preventDefault();
            handleSubmit();
          }
        }
      }
    },
    [
      modelOpen,
      plusOpen,
      focusedIndex,
      enabledModels,
      onModelChange,
      handleSubmit,
      sendMessageShortcut,
      clearInputOnEscape,
    ],
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
      <div className={`w-full max-w-4xl mx-auto px-8 md:px-12 ${centered ? "" : "pb-4 md:pb-6 pt-2"}`}>
        <label htmlFor="chat-input" className="sr-only">
          Message
        </label>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (!disabled && !isStreaming) {
              setIsDragging(true);
            }
          }}
          onDragLeave={() => {
            setIsDragging(false);
          }}
          onDrop={async (e) => {
            e.preventDefault();
            setIsDragging(false);
            if (disabled || isStreaming) return;
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
              await handleAddFiles(Array.from(e.dataTransfer.files));
            }
          }}
          className={`flex flex-col items-stretch bg-input rounded-3xl px-4 py-3 transition-all focus-within:ring-1 focus-within:ring-border ${
            isOverLimit ? "ring-red-500/50" : ""
          } ${isStreaming ? "dark:animate-border-glow animate-border-glow-light" : ""} ${
            isDragging ? "ring-accent bg-active/40 scale-[1.01]" : ""
          }`}
        >
          {/* Hidden input element */}
          <input
            id="file-input-element"
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            multiple
            accept="image/*,.txt,.md,.json,.csv,.xml,.yaml,.yml,.js,.jsx,.ts,.tsx,.py,.rb,.go,.rs,.java,.c,.h,.cpp,.hpp,.cs,.php,.swift,.kt,.scala,.sh,.bash,.zsh,.sql,.html,.css,.scss,.toml,.ini,.cfg,.log,.env"
            className="hidden"
          />

          {/* Attachments strip */}
          <AnimatePresence>
            {attachments.length > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                animate={{ opacity: 1, height: "auto", marginBottom: 8 }}
                exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                className="flex flex-wrap gap-2 w-full overflow-hidden pb-1 border-b border-border/40"
              >
                {attachments.map((a) => (
                  <motion.div
                    key={a.id}
                    initial={{ opacity: 0, scale: motionTokens.scale.subtle }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: motionTokens.scale.subtle }}
                    transition={springs.gentle}
                    className="flex items-center gap-1.5 rounded-md border border-border bg-surface pl-2 pr-0.5 py-0.5 text-xs text-text-secondary select-none"
                  >
                    {a.kind === "image" ? (
                      <ImageIcon size={13} className="text-text-muted" />
                    ) : (
                      <FileTextIcon size={13} className="text-text-muted" />
                    )}
                    <span className="max-w-[120px] truncate font-medium" title={a.name}>
                      {a.name}
                    </span>
                    <span className="text-[10px] text-text-muted">({formatFileSize(a.size)})</span>
                    <button
                      onClick={() => setAttachments((prev) => prev.filter((item) => item.id !== a.id))}
                      className="p-0.5 rounded-md hover:bg-hover text-text-muted hover:text-text-primary transition-colors"
                      title="Remove attachment"
                    >
                      <X size={12} />
                    </button>
                  </motion.div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex items-center gap-2 w-full">
            {/* Plus / tools button */}
            <div ref={plusDropdownRef} className="relative shrink-0">
              <button
                onClick={() => setPlusOpen(!plusOpen)}
                className={`p-1.5 rounded-full transition-colors flex items-center justify-center ${
                  anyToolActive
                    ? "text-text-primary bg-active"
                    : "text-text-muted hover:text-text-secondary hover:bg-hover"
                }`}
                aria-label="Attach or search"
                aria-expanded={plusOpen}
                aria-haspopup="menu"
              >
                <Plus size={20} />
              </button>

              <AnimatePresence>
                {plusOpen && (
                  <motion.div
                    className="absolute bottom-full left-0 mb-2 w-56 bg-surface border border-border rounded-xl p-1 z-50"
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
                        fileInputRef.current?.click();
                      }}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-text-secondary hover:bg-hover hover:text-text-primary transition-colors"
                      role="menuitem"
                    >
                      <Paperclip size={15} className="text-text-muted" />
                      <span>Add File</span>
                    </button>
                    <button
                      onClick={() => {
                        onToggleSearch(!isSearchEnabled);
                        setPlusOpen(false);
                      }}
                      className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-colors ${
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
                        <div className="border-t border-border my-1 -mx-1" />
                        {connectedMcpServers.map((server) => {
                          const isEnabled = enabledMcpServerIds.has(server.id);
                          return (
                            <button
                              key={server.id}
                              onClick={() => {
                                onToggleMcpServer(server.id);
                              }}
                              className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-colors ${
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
              placeholder="Ask for follow-up changes..."
              rows={1}
              disabled={disabled}
              aria-describedby={isOverLimit ? "input-limit-error" : "input-hint"}
              aria-invalid={isOverLimit}
              className={`flex-1 min-w-0 bg-transparent text-sm text-text-primary placeholder-text-muted resize-none outline-none leading-relaxed overflow-y-hidden ${isOverLimit ? "text-red-600 dark:text-red-400" : ""}`}
            />

            {/* Model selector */}
            <div ref={dropdownRef} className="relative shrink-0">
              <button
                id="model-selector-button"
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
                <span className="truncate">{currentModel?.name || "5.4-Mini High"}</span>
                <ChevronDown
                  size={14}
                  className={`shrink-0 transition-transform duration-200 ${modelOpen ? "rotate-180" : ""}`}
                  aria-hidden="true"
                />
              </button>

              <AnimatePresence>
                {modelOpen && (
                  <motion.div
                    className="absolute bottom-full right-0 mb-2 w-64 bg-surface border border-border rounded-xl p-1 z-50 max-h-72 overflow-y-auto overflow-x-hidden"
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
                          className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-colors text-left ${
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
              className={`shrink-0 p-2 rounded-full transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center ${
                isStreaming
                  ? "bg-red-500/90 hover:bg-red-600 text-white"
                  : "bg-surface hover:bg-hover text-text-primary border border-border disabled:bg-transparent disabled:border-transparent disabled:text-text-muted"
              }`}
              aria-label={isStreaming ? "Stop generating" : "Send message"}
            >
              {isStreaming ? <Square size={16} className="fill-current" /> : <ArrowUp size={16} strokeWidth={2.5} />}
            </button>
          </div>
        </div>

        <p
          id={isOverLimit ? "input-limit-error" : "input-hint"}
          className="mt-2 text-center text-[11px] text-text-muted"
        >
          {isOverLimit ? (
            <span className="text-red-600 dark:text-red-400" role="alert">
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
