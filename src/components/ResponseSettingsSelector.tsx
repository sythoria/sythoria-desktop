import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, BrainCircuit, Check, ChevronDown, ChevronRight } from "lucide-react";
import type { ModelConfig, ModelStatuses } from "../types";
import { STATUS_COLORS } from "../types";
import { useModelStore } from "../store/useModelStore";
import { useUIStore } from "../store/useUIStore";
import { motionTokens, springs } from "../lib/motion-tokens";
import { getThinkingLabel, getThinkingLevel, supportsThinkingControl, THINKING_LEVELS } from "../utils/thinking";
import { useTranslation } from "../utils/i18n";

const STATUS_LABELS: Record<string, string> = {
  disconnected: "Disconnected",
  connecting: "Connecting\u2026",
  connected: "Connected",
  error: "Connection error",
};

const STATUS_KEYS: Record<string, string> = {
  disconnected: "status.disconnected",
  connecting: "status.connecting",
  connected: "status.connected",
  error: "status.error",
};

interface ResponseSettingsSelectorProps {
  models: ModelConfig[];
  selectedModel: string;
  onModelChange: (modelId: string) => void;
  modelStatuses: ModelStatuses;
  placement?: "above" | "below";
  buttonId?: string;
  triggerClassName?: string;
}

export function ResponseSettingsSelector({
  models,
  selectedModel,
  onModelChange,
  modelStatuses,
  placement = "above",
  buttonId,
  triggerClassName = "max-w-[190px]",
}: ResponseSettingsSelectorProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [panel, setPanel] = useState<"root" | "models" | "thinking">("root");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const updateModel = useModelStore((state) => state.updateModel);
  const disableBgActivity = useUIStore((state) => state.disableBgActivity);

  const enabledModels = models.filter((model) => model.enabled !== false);
  const currentModel =
    models.find((model) => model.id === selectedModel && model.enabled !== false) ?? enabledModels[0] ?? models[0];
  const currentStatus = modelStatuses[selectedModel] ?? "disconnected";
  const thinkingLevel = getThinkingLevel(currentModel);
  const thinkingLabel = getThinkingLabel(currentModel);
  const thinkingSupported = supportsThinkingControl(currentModel);
  const opensAbove = placement === "above";

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setPanel("root");
      }
    }

    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const frame = requestAnimationFrame(() => {
      panelRef.current
        ?.querySelector<HTMLButtonElement>(`[data-selector-panel="${panel}"] button:not(:disabled)`)
        ?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [isOpen, panel]);

  return (
    <div ref={dropdownRef} className="relative z-20 shrink-0">
      <button
        ref={triggerRef}
        id={buttonId}
        type="button"
        onClick={() => {
          setIsOpen((open) => !open);
          setPanel("root");
        }}
        className={`flex min-h-8 items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-hover hover:text-text-primary ${triggerClassName}`}
        aria-label={`Response settings: ${currentModel?.name ?? "no model"}, thinking ${thinkingLabel}`}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
      >
        {!disableBgActivity && (
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_COLORS[currentStatus]}`}
            title={t(STATUS_KEYS[currentStatus]) || STATUS_LABELS[currentStatus] || currentStatus}
            aria-hidden="true"
          />
        )}
        <span className="truncate">{currentModel?.name || "No Model Configured"}</span>
        <span className="text-text-muted/60" aria-hidden="true">
          ·
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 text-text-muted">
          <BrainCircuit size={12} aria-hidden="true" />
          {thinkingSupported ? thinkingLabel : "Auto"}
        </span>
        <ChevronDown
          size={14}
          className={`shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            ref={panelRef}
            className={`absolute left-1/2 z-50 w-[min(11.5rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-surface p-1.5 font-normal ${
              opensAbove ? "bottom-full mb-2" : "top-full mt-2"
            }`}
            style={{ boxShadow: "var(--shadow-xl)" }}
            role="dialog"
            aria-label="Model and thinking settings"
            initial={{ opacity: 0, x: "-50%", y: opensAbove ? 8 : -8, scale: motionTokens.scale.subtle }}
            animate={{ opacity: 1, x: "-50%", y: 0, scale: 1 }}
            exit={{ opacity: 0, x: "-50%", y: opensAbove ? 8 : -8, scale: motionTokens.scale.subtle }}
            transition={springs.gentle}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              if (panel !== "root") {
                setPanel("root");
              } else {
                setIsOpen(false);
                requestAnimationFrame(() => triggerRef.current?.focus());
              }
            }}
          >
            <AnimatePresence mode="popLayout" initial={false}>
              {panel === "root" && (
                <motion.div
                  key="selector-root"
                  data-selector-panel="root"
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -6 }}
                  transition={springs.snappy}
                >
                  <button
                    type="button"
                    onClick={() => setPanel("models")}
                    className="group flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-hover"
                  >
                    <span className="shrink-0 text-xs font-medium text-text-primary">Model</span>
                    <span className="min-w-0 flex-1 truncate text-right text-xs text-text-muted">
                      {currentModel?.name || "No model configured"}
                    </span>
                    <ChevronRight
                      size={14}
                      className="shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPanel("thinking")}
                    className="group flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-hover"
                  >
                    <span className="shrink-0 text-xs font-medium text-text-primary">Thinking</span>
                    <span className="min-w-0 flex-1 truncate text-right text-xs text-text-muted">
                      {thinkingSupported ? thinkingLabel : "Not available"}
                    </span>
                    <ChevronRight
                      size={14}
                      className="shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </button>
                </motion.div>
              )}

              {panel === "models" && (
                <motion.div
                  key="selector-models"
                  data-selector-panel="models"
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 8 }}
                  transition={springs.snappy}
                >
                  <div className="flex items-center gap-1 px-0.5 pb-0.5 pt-0.5">
                    <button
                      type="button"
                      onClick={() => setPanel("root")}
                      className="rounded-md p-1 text-text-muted transition-colors hover:bg-hover hover:text-text-primary"
                      aria-label="Back to response settings"
                    >
                      <ArrowLeft size={14} aria-hidden="true" />
                    </button>
                    <span className="text-xs font-medium text-text-muted">Model</span>
                  </div>
                  <div className="max-h-72 overflow-y-auto overscroll-contain pr-0.5">
                    {enabledModels.length === 0 ? (
                      <div className="px-3 py-5 text-center text-xs text-text-muted">
                        No models configured. Go to Settings &gt; Models to add one.
                      </div>
                    ) : (
                      enabledModels.map((model) => {
                        const status = modelStatuses[model.id] ?? "disconnected";
                        const isSelected = selectedModel === model.id;
                        return (
                          <button
                            key={model.id}
                            type="button"
                            onClick={() => {
                              onModelChange(model.id);
                              setPanel("root");
                            }}
                            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors ${
                              isSelected
                                ? "bg-active text-text-primary"
                                : "text-text-secondary hover:bg-hover hover:text-text-primary"
                            }`}
                            aria-pressed={isSelected}
                          >
                            {!disableBgActivity && (
                              <span
                                className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_COLORS[status]}`}
                                title={t(STATUS_KEYS[status]) || STATUS_LABELS[status] || status}
                                aria-hidden="true"
                              />
                            )}
                            <span className="min-w-0 flex-1 truncate text-xs font-medium" title={model.modelId}>
                              {model.name}
                            </span>
                            {isSelected && <Check size={14} className="shrink-0" aria-hidden="true" />}
                          </button>
                        );
                      })
                    )}
                  </div>
                </motion.div>
              )}

              {panel === "thinking" && (
                <motion.div
                  key="selector-thinking"
                  data-selector-panel="thinking"
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 8 }}
                  transition={springs.snappy}
                >
                  <div className="flex items-center gap-1 px-0.5 pb-0.5 pt-0.5">
                    <button
                      type="button"
                      onClick={() => setPanel("root")}
                      className="rounded-md p-1 text-text-muted transition-colors hover:bg-hover hover:text-text-primary"
                      aria-label="Back to response settings"
                    >
                      <ArrowLeft size={14} aria-hidden="true" />
                    </button>
                    <span className="text-xs font-medium text-text-muted">Thinking</span>
                  </div>
                  <div className="space-y-0.5">
                    {THINKING_LEVELS.map((option) => {
                      const isSelected = thinkingLevel === option.value;
                      const isDisabled = option.value !== "auto" && !thinkingSupported;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          disabled={isDisabled}
                          onClick={() => {
                            if (!currentModel) return;
                            updateModel(currentModel.id, { thinkingLevel: option.value });
                            setPanel("root");
                          }}
                          className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors ${
                            isSelected
                              ? "bg-active text-text-primary"
                              : "text-text-secondary hover:bg-hover hover:text-text-primary"
                          } disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent`}
                          aria-pressed={isSelected}
                          title={isDisabled ? "This model does not expose adjustable thinking." : undefined}
                        >
                          <span className="min-w-0 flex-1 text-xs font-medium">{option.label}</span>
                          {isSelected && <Check size={14} className="shrink-0" aria-hidden="true" />}
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
