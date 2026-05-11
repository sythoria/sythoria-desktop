import { useState, useRef, useEffect } from "react";
import {
  Send,
  Paperclip,
  ChevronDown,
  Check,
} from "lucide-react";
import { MODELS, STATUS_COLORS } from "../types";
import type { ConnectionStatus } from "../types";

interface InputBarProps {
  onSend: (message: string) => void;
  selectedModel: string;
  onModelChange: (model: string) => void;
  disabled?: boolean;
  connectionStatus: ConnectionStatus;
}

export default function InputBar({
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

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height =
        Math.min(textareaRef.current.scrollHeight, 200) + "px";
    }
  }, [value]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setModelOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
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

  const currentModel = MODELS.find((m) => m.id === selectedModel) ?? MODELS[0];

  return (
    <div className="px-4 md:px-0 pb-4 pt-2 animate-slide-up">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-end gap-2 glass-panel rounded-2xl px-4 py-3 transition-all focus-within:border-accent/50 focus-within:shadow-md">
          <button
            className="shrink-0 p-1.5 rounded-lg text-text-muted hover:text-text-secondary hover:bg-hover transition-colors"
            title="Attach file"
          >
            <Paperclip size={18} />
          </button>

          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message Sythoria..."
            rows={1}
            disabled={disabled}
            className="flex-1 bg-transparent text-sm text-text-primary placeholder-text-muted
              resize-none outline-none leading-relaxed max-h-[200px]"
          />

          <div ref={dropdownRef} className="relative shrink-0">
            <button
              onClick={() => setModelOpen(!modelOpen)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg
                text-xs text-text-muted hover:text-text-secondary hover:bg-hover
                transition-colors whitespace-nowrap"
            >
              <div className={`w-1.5 h-1.5 rounded-full ${STATUS_COLORS[connectionStatus]}`} />
              {currentModel.name}
              <ChevronDown
                size={12}
                className={`transition-transform ${modelOpen ? "rotate-180" : ""}`}
              />
            </button>

            {modelOpen && (
              <div className="absolute bottom-full right-0 mb-2 w-52 bg-surface border border-border rounded-xl shadow-2xl py-1 z-50 animate-fade-in">
                {MODELS.map((model) => (
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
                      <span className="text-[10px] text-text-muted">
                        {model.provider}
                      </span>
                    </div>
                    {selectedModel === model.id && (
                      <Check size={14} className="text-accent" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={handleSubmit}
            disabled={!value.trim() || disabled}
            className="shrink-0 p-2 rounded-lg bg-accent hover:bg-accent-hover
              text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed hover:shadow-lg"
          >
            <Send size={16} />
          </button>
        </div>

        <p className="mt-2 text-center text-[11px] text-text-muted">
          Sythoria can make mistakes. Consider checking important information.
        </p>
      </div>
    </div>
  );
}
