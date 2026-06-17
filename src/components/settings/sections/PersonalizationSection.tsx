import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown, Check } from "lucide-react";
import { Switch } from "../../ui/Switch";
import { springs } from "../../../lib/motion-tokens";
import { DEFAULT_TITLE_SYSTEM_PROMPT, TitleGenerationConfig, ModelConfig } from "../../../types";
import { useModelStore } from "../../../store/useModelStore";

interface PersonalizationSectionProps {
  titleConfig: TitleGenerationConfig;
  setTitleConfig: (updates: Partial<TitleGenerationConfig>) => void;
  models: ModelConfig[];
  enabledModels: ModelConfig[];
}

export const PersonalizationSection = ({
  titleConfig,
  setTitleConfig,
  models,
  enabledModels,
}: PersonalizationSectionProps) => {
  const [titleModelDropdownOpen, setTitleModelDropdownOpen] = useState(false);
  const systemPrompt = useModelStore((s) => s.systemPrompt);
  const setSystemPrompt = useModelStore((s) => s.setSystemPrompt);

  return (
    <>
      <div>
        <h3 className="text-sm font-semibold text-text-primary mb-1">Title Generation</h3>
        <p className="text-xs text-text-muted">Automatically name conversations</p>
      </div>{" "}
      <div className="bg-surface border border-border rounded-xl p-4 space-y-4 shadow-sm">
        <Switch
          checked={titleConfig.enabled}
          onChange={(checked) => setTitleConfig({ enabled: checked })}
          label="AI Title Generation"
          description="Automatically generate conversation titles using AI"
        />

        <AnimatePresence>
          {titleConfig.enabled && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={springs.gentle}
              className="overflow-hidden"
            >
              <div className="space-y-2">
                <label htmlFor="title-model-select" className="text-sm font-medium text-text-primary block">
                  Title Model
                </label>
                <p className="text-xs text-text-muted mb-2">
                  Choose the model used to generate titles, or use the same model as the conversation
                </p>
                <div className="relative">
                  <button
                    id="title-model-select"
                    onClick={() => setTitleModelDropdownOpen(!titleModelDropdownOpen)}
                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-input-border bg-input text-sm text-text-primary hover:border-accent/30 transition-colors min-h-[44px]"
                    aria-expanded={titleModelDropdownOpen}
                    aria-haspopup="listbox"
                  >
                    <span>
                      {titleConfig.modelId === "__same__"
                        ? "Same as selected model"
                        : (models.find((m) => m.id === titleConfig.modelId)?.name ?? "Same as selected model")}
                    </span>
                    <ChevronDown
                      size={16}
                      className={`text-text-muted transition-transform ${titleModelDropdownOpen ? "rotate-180" : ""}`}
                      aria-hidden="true"
                    />
                  </button>
                  {titleModelDropdownOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-10"
                        onClick={() => setTitleModelDropdownOpen(false)}
                        aria-hidden="true"
                      />
                      <motion.div
                        initial={{ opacity: 0, y: -4, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -4, scale: 0.97 }}
                        transition={springs.snappy}
                        className="absolute top-full left-0 right-0 mt-1 bg-surface border border-border rounded-xl shadow-lg z-20 overflow-hidden max-h-64 overflow-y-auto"
                        role="listbox"
                        aria-label="Title generation models"
                      >
                        <button
                          onClick={() => {
                            setTitleConfig({ modelId: "__same__" });
                            setTitleModelDropdownOpen(false);
                          }}
                          className={`w-full flex items-center justify-between px-3 py-2.5 text-sm transition-colors min-h-[44px] ${
                            titleConfig.modelId === "__same__"
                              ? "bg-accent-soft text-accent"
                              : "text-text-secondary hover:bg-hover hover:text-text-primary"
                          }`}
                          role="option"
                          aria-selected={titleConfig.modelId === "__same__"}
                        >
                          <div className="flex flex-col items-start">
                            <span className="font-medium">Same as selected model</span>
                            <span className="text-[10px] text-text-muted">Uses the active chat model</span>
                          </div>
                          {titleConfig.modelId === "__same__" && (
                            <Check size={14} className="text-accent shrink-0" aria-hidden="true" />
                          )}
                        </button>
                        {enabledModels.map((model) => (
                          <button
                            key={model.id}
                            onClick={() => {
                              setTitleConfig({ modelId: model.id });
                              setTitleModelDropdownOpen(false);
                            }}
                            className={`w-full flex items-center justify-between px-3 py-2.5 text-sm transition-colors min-h-[44px] ${
                              titleConfig.modelId === model.id
                                ? "bg-accent-soft text-accent"
                                : "text-text-secondary hover:bg-hover hover:text-text-primary"
                            }`}
                            role="option"
                            aria-selected={titleConfig.modelId === model.id}
                          >
                            <div className="flex flex-col items-start">
                              <span className="font-medium">{model.name}</span>
                              <span className="text-[10px] text-text-muted">{model.modelId}</span>
                            </div>
                            {titleConfig.modelId === model.id && (
                              <Check size={14} className="text-accent shrink-0" aria-hidden="true" />
                            )}
                          </button>
                        ))}
                      </motion.div>
                    </>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="title-system-prompt" className="text-sm font-medium text-text-primary block">
                  System Prompt
                </label>
                <p className="text-xs text-text-muted mb-2">
                  Customize the prompt used for title generation. Use{" "}
                  <code className="text-accent text-[11px]">{"{{userMessage}}"}</code> as a placeholder for the
                  user&apos;s message
                </p>
                <textarea
                  id="title-system-prompt"
                  value={titleConfig.systemPrompt}
                  onChange={(e) => setTitleConfig({ systemPrompt: e.target.value })}
                  rows={4}
                  placeholder={DEFAULT_TITLE_SYSTEM_PROMPT}
                  className="w-full px-3 py-2 rounded-lg border border-input-border bg-input text-sm text-text-primary placeholder-text-muted focus:border-accent/50 focus:outline-none transition-colors resize-y min-h-[80px]"
                />
                {titleConfig.systemPrompt !== DEFAULT_TITLE_SYSTEM_PROMPT && (
                  <button
                    onClick={() => setTitleConfig({ systemPrompt: DEFAULT_TITLE_SYSTEM_PROMPT })}
                    className="text-xs text-accent hover:text-accent-hover transition-colors"
                  >
                    Reset to default
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-text-primary mb-1">AI Behavior</h3>
        <p className="text-xs text-text-muted">Configure the global instructions for the AI</p>
      </div>
      <div className="bg-surface border border-border rounded-xl p-4 space-y-4 shadow-sm">
        <div className="space-y-2">
          <label htmlFor="global-system-prompt" className="text-sm font-medium text-text-primary block">
            System Prompt
          </label>
          <p className="text-xs text-text-muted mb-2">
            Customize the instructions used to define the AI assistant&apos;s persona, tone, and constraints.
          </p>
          <textarea
            id="global-system-prompt"
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={4}
            placeholder="Customize the global instructions for the AI..."
            className="w-full px-3 py-2 rounded-lg border border-input-border bg-input text-sm text-text-primary placeholder-text-muted focus:border-accent/50 focus:outline-none transition-colors resize-y min-h-[80px]"
          />
          {systemPrompt !== "" && (
            <button
              onClick={() => setSystemPrompt("")}
              className="text-xs text-accent hover:text-accent-hover transition-colors"
            >
              Reset to default
            </button>
          )}
        </div>
      </div>
    </>
  );
};
