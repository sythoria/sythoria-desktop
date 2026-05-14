import { useState, useRef, useEffect } from "react";
import { Send, Paperclip, ChevronDown, Check } from "lucide-react";
import { STATUS_COLORS, ModelConfig } from "../types";
import type { ConnectionStatus } from "../types";
import { MAX_INPUT_LENGTH, MAX_TEXTAREA_HEIGHT } from "../config/constants";

interface InputBarProps {
  models: ModelConfig[];
  onSend: (message: string) => void;
  selectedModel: string;
  onModelChange: (model: string) => void;
  disabled?: boolean;
  connectionStatus: ConnectionStatus;
}

export default function InputBar({
  models,
  onSend,
  selectedModel,
  onModelChange,
  disabled,
  connectionStatus,
}: InputBarProps) {
  const [value, setValue] = useState("");
  const [modelOpen, setModelOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isOverLimit = value.length > MAX_INPUT_LENGTH;
  const trimmed = value.trim();
  const canSend = trimmed.length > 0 && !isOverLimit && !disabled;

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, MAX_TEXTAREA_HEIGHT) + "px";
    }
  }, [value]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setModelOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleSubmit = () => {
    if (!canSend) return;
    onSend(trimmed);
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    if (val.length <= MAX_INPUT_LENGTH + 100) {
      setValue(val);
    }
  };

  const currentModel = models.find((m) => m.id === selectedModel) ?? models[0];

  return (
    <div className="px-4 md:px-0 pb-4 pt-2">
      <div className="max-w-3xl mx-auto">
        <div
          className={`flex items-end gap-2 glass-panel rounded-2xl px-4 py-3 transition-all focus-within:border-accent/40 focus-within:shadow-lg focus-within:shadow-accent/5 ${isOverLimit ? "border-red-500/50" : ""}`}
        >
          <button
            className="shrink-0 p-1.5 rounded-lg text-text-muted hover:text-text-secondary hover:bg-hover transition-colors"
            title="Attach file"
          >
            <Paperclip size={18} />
          </button>

          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="Message Sythoria..."
            rows={1}
            disabled={disabled}
            className={`flex-1 bg-transparent text-sm text-text-primary placeholder-text-muted resize-none outline-none leading-relaxed max-h-[${MAX_TEXTAREA_HEIGHT}px] ${isOverLimit ? "text-red-400" : ""}`}
          />

          <div ref={dropdownRef} className="relative shrink-0">
            <button
              onClick={() => setModelOpen(!modelOpen)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg
                text-xs text-text-muted hover:text-text-secondary hover:bg-hover
                transition-colors whitespace-nowrap"
            >
              <div className={`w-1.5 h-1.5 rounded-full ${STATUS_COLORS[connectionStatus]}`} />
              {currentModel?.name || "No Model"}
              <ChevronDown size={12} className={`transition-transform ${modelOpen ? "rotate-180" : ""}`} />
            </button>

            {modelOpen && (
              <div className="absolute bottom-full right-0 mb-2 w-52 bg-surface border border-border rounded-xl shadow-2xl py-1 z-50 animate-fade-in max-h-64 overflow-y-auto">
                {models.map((model) => (
                  <button
                    key={model.id}
                    onClick={() => {
                      onModelChange(model.id);
                      setModelOpen(false);
                    }}
                    className="w-full flex items-center justify-between px-3 py-2
                      text-sm text-text-secondary hover:bg-hover hover:text-text-primary
                      transition-colors"
                  >
                    <div className="flex flex-col items-start">
                      <span className="flex items-center gap-1.5">
                        <div className={`w-1.5 h-1.5 rounded-full ${STATUS_COLORS[connectionStatus]}`} />
                        {model.name}
                      </span>
                      <span
                        className="text-[10px] text-text-muted max-w-full truncate overflow-hidden text-ellipsis whitespace-nowrap"
                        style={{ maxWidth: "140px" }}
                        title={model.apiBase}
                      >
                        {model.apiBase.replace(/^https?:\/\//, "").split("/")[0]}
                      </span>
                    </div>
                    {selectedModel === model.id && <Check size={14} className="text-accent shrink-0" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={handleSubmit}
            disabled={!canSend}
            className="shrink-0 p-2 rounded-lg bg-accent hover:bg-accent-hover
              text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed hover:shadow-lg"
          >
            <Send size={16} />
          </button>
        </div>

        <p className="mt-2 text-center text-[11px] text-text-muted">
          {isOverLimit ? (
            <span className="text-red-400">Message exceeds {MAX_INPUT_LENGTH.toLocaleString()} character limit</span>
          ) : (
            "Sythoria can make mistakes. Consider checking important information."
          )}
        </p>
      </div>
    </div>
  );
}
