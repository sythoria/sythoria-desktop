import { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown, Check } from "lucide-react";
import { springs } from "../../../lib/motion-tokens";
import {
  MIN_TEMPERATURE,
  MAX_TEMPERATURE,
  TEMPERATURE_STEP,
  MIN_TOOL_STEPS,
  MAX_TOOL_STEPS_LIMIT,
} from "../../../config/constants";
import { ModelConfig, SearchApiConfig } from "../../../types";

interface ConfigurationSectionProps {
  models: ModelConfig[];
  selectedModel: string;
  setSelectedModel: (id: string) => void;
  searchConfigs: SearchApiConfig[];
  activeSearchId: string | null;
  setActiveSearchId: (id: string) => void;
  temperature: number;
  setTemperature: (temp: number) => void;
  addToast: (msg: string, variant: "info" | "success" | "error") => void;
  maxToolSteps: number;
  setMaxToolSteps: (steps: number) => void;
}

export const ConfigurationSection = ({
  models,
  selectedModel,
  setSelectedModel,
  searchConfigs,
  activeSearchId,
  setActiveSearchId,
  temperature,
  setTemperature,
  addToast,
  maxToolSteps,
  setMaxToolSteps,
}: ConfigurationSectionProps) => {
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [searchProviderDropdownOpen, setSearchProviderDropdownOpen] = useState(false);
  const tempToastRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxStepsToastRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const enabledModels = models.filter((m) => m.enabled !== false);
  const effectiveModel = models.find((m) => m.id === selectedModel) ?? models[0];

  const enabledSearchConfigs = searchConfigs.filter((c) => c.enabled);
  const activeSearchConfig = enabledSearchConfigs.find((c) => c.id === activeSearchId);

  const handleTemperatureChange = useCallback(
    (value: string) => {
      const t = parseFloat(value);
      setTemperature(t);
      if (tempToastRef.current) clearTimeout(tempToastRef.current);
      tempToastRef.current = setTimeout(() => {
        addToast(`Temperature set to ${t.toFixed(1)}`, "info");
      }, 800);
    },
    [setTemperature, addToast],
  );

  const handleMaxToolStepsChange = useCallback(
    (value: string) => {
      const steps = parseInt(value, 10);
      setMaxToolSteps(steps);
      if (maxStepsToastRef.current) clearTimeout(maxStepsToastRef.current);
      maxStepsToastRef.current = setTimeout(() => {
        addToast(`Maximum tool steps set to ${steps}`, "info");
      }, 800);
    },
    [setMaxToolSteps, addToast],
  );

  useEffect(() => {
    return () => {
      if (tempToastRef.current) clearTimeout(tempToastRef.current);
      if (maxStepsToastRef.current) clearTimeout(maxStepsToastRef.current);
    };
  }, []);

  const tempPercent = ((temperature - MIN_TEMPERATURE) / (MAX_TEMPERATURE - MIN_TEMPERATURE)) * 100;
  const stepsPercent = ((maxToolSteps - MIN_TOOL_STEPS) / (MAX_TOOL_STEPS_LIMIT - MIN_TOOL_STEPS)) * 100;

  return (
    <>
      <div>
        <h3 className="text-sm font-semibold text-text-primary mb-1">Chat Settings</h3>
        <p className="text-xs text-text-muted">
          Configure default model selection, generation parameters, and tool execution limits
        </p>
      </div>{" "}
      <div className="bg-surface border border-border rounded-xl p-4 space-y-4 shadow-sm">
        <div className="space-y-2">
          <label htmlFor="default-model-select" className="text-sm font-medium text-text-primary block">
            Default AI Model
          </label>
          <p className="text-xs text-text-muted mb-2">Choose the model for new conversations</p>
          <div className="relative">
            <button
              id="default-model-select"
              onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-input-border bg-input text-sm text-text-primary hover:border-accent/30 transition-colors min-h-[44px]"
              aria-expanded={modelDropdownOpen}
              aria-haspopup="listbox"
            >
              <span>{effectiveModel?.name || "No Model"}</span>
              <ChevronDown
                size={16}
                className={`text-text-muted transition-transform ${modelDropdownOpen ? "rotate-180" : ""}`}
                aria-hidden="true"
              />
            </button>
            {modelDropdownOpen && (
              <div className="fixed inset-0 z-10" onClick={() => setModelDropdownOpen(false)} aria-hidden="true" />
            )}
            <AnimatePresence>
              {modelDropdownOpen && (
                <motion.div
                  key="model-dropdown"
                  initial={{ opacity: 0, y: -4, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.97 }}
                  transition={springs.snappy}
                  className="absolute top-full left-0 right-0 mt-1 bg-surface border border-border rounded-xl shadow-lg z-20 overflow-hidden max-h-64 overflow-y-auto"
                  role="listbox"
                  aria-label="Available models"
                >
                  {enabledModels.map((model) => (
                    <button
                      key={model.id}
                      onClick={() => {
                        setSelectedModel(model.id);
                        setModelDropdownOpen(false);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2.5 text-sm transition-colors min-h-[44px] ${
                        selectedModel === model.id
                          ? "bg-accent-soft text-accent"
                          : "text-text-secondary hover:bg-hover hover:text-text-primary"
                      }`}
                      role="option"
                      aria-selected={selectedModel === model.id}
                    >
                      <div className="flex flex-col items-start">
                        <span className="font-medium">{model.name}</span>
                        <span className="text-[10px] text-text-muted">{model.modelId}</span>
                      </div>
                      {selectedModel === model.id && (
                        <Check size={14} className="text-accent shrink-0" aria-hidden="true" />
                      )}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <div className="space-y-2 pt-2">
          <label htmlFor="default-search-provider" className="text-sm font-medium text-text-primary block">
            Default Search Provider
          </label>
          <p className="text-xs text-text-muted mb-2">Choose the search API used when web search is enabled</p>
          <div className="relative">
            <button
              id="default-search-provider"
              onClick={() => setSearchProviderDropdownOpen(!searchProviderDropdownOpen)}
              disabled={enabledSearchConfigs.length === 0}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-input-border bg-input text-sm text-text-primary hover:border-accent/30 transition-colors min-h-[44px] disabled:opacity-50 disabled:cursor-not-allowed"
              aria-expanded={searchProviderDropdownOpen}
              aria-haspopup="listbox"
            >
              <span>
                {activeSearchConfig?.name ||
                  (enabledSearchConfigs.length === 0 ? "No search APIs configured" : "Select provider")}
              </span>
              <ChevronDown
                size={16}
                className={`text-text-muted transition-transform ${searchProviderDropdownOpen ? "rotate-180" : ""}`}
                aria-hidden="true"
              />
            </button>
            {searchProviderDropdownOpen && enabledSearchConfigs.length > 0 && (
              <div
                className="fixed inset-0 z-10"
                onClick={() => setSearchProviderDropdownOpen(false)}
                aria-hidden="true"
              />
            )}
            <AnimatePresence>
              {searchProviderDropdownOpen && enabledSearchConfigs.length > 0 && (
                <motion.div
                  key="search-provider-dropdown"
                  initial={{ opacity: 0, y: -4, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.97 }}
                  transition={springs.snappy}
                  className="absolute top-full left-0 right-0 mt-1 bg-surface border border-border rounded-xl shadow-lg z-20 overflow-hidden max-h-64 overflow-y-auto"
                  role="listbox"
                  aria-label="Available search providers"
                >
                  {enabledSearchConfigs.map((config) => (
                    <button
                      key={config.id}
                      onClick={() => {
                        setActiveSearchId(config.id);
                        setSearchProviderDropdownOpen(false);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2.5 text-sm transition-colors min-h-[44px] ${
                        activeSearchId === config.id
                          ? "bg-accent-soft text-accent"
                          : "text-text-secondary hover:bg-hover hover:text-text-primary"
                      }`}
                      role="option"
                      aria-selected={activeSearchId === config.id}
                    >
                      <div className="flex flex-col items-start">
                        <span className="font-medium">{config.name}</span>
                        <span className="text-[10px] text-text-muted">{config.provider}</span>
                      </div>
                      {activeSearchId === config.id && (
                        <Check size={14} className="text-accent shrink-0" aria-hidden="true" />
                      )}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <div className="space-y-3 pt-2 border-t border-border/50">
          <div className="flex items-center justify-between">
            <label htmlFor="temperature-slider" className="text-sm font-medium text-text-primary">
              Temperature
            </label>
            <span className="text-xs text-text-muted bg-input border border-input-border rounded px-2 py-0.5 font-mono">
              {temperature.toFixed(1)}
            </span>
          </div>
          <p className="text-xs text-text-muted">
            Adjust creativity: lower values produce more focused responses, higher values more creative ones
          </p>
          <div className="flex items-center gap-4">
            <span className="text-xs text-text-muted whitespace-nowrap">{MIN_TEMPERATURE.toFixed(1)}</span>
            <div className="relative flex-1 h-1.5 bg-input-border rounded-full">
              <div
                className="absolute h-full bg-accent rounded-full transition-all duration-150"
                style={{ width: `${tempPercent}%` }}
              />
              <input
                id="temperature-slider"
                type="range"
                min={MIN_TEMPERATURE}
                max={MAX_TEMPERATURE}
                step={TEMPERATURE_STEP}
                value={temperature}
                onChange={(e) => handleTemperatureChange(e.target.value)}
                className="peer absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                aria-label="Temperature"
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-accent rounded-full border-2 border-white shadow-sm pointer-events-none transition-all duration-150 peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-1"
                style={{ left: `calc(${tempPercent}% - 6px)` }}
                aria-hidden="true"
              />
            </div>
            <span className="text-xs text-text-muted whitespace-nowrap">{MAX_TEMPERATURE.toFixed(1)}</span>
          </div>
          <div className="flex justify-between text-[10px] text-text-muted pt-1">
            <span>Precise</span>
            <span>Balanced</span>
            <span>Creative</span>
          </div>
        </div>

        <div className="space-y-3 pt-4 border-t border-border/50">
          <div className="flex items-center justify-between">
            <label htmlFor="max-tool-steps-slider" className="text-sm font-medium text-text-primary">
              Maximum Tool Steps
            </label>
            <span className="text-xs text-text-muted bg-input border border-input-border rounded px-2 py-0.5 font-mono">
              {maxToolSteps}
            </span>
          </div>
          <p className="text-xs text-text-muted">
            Set the maximum number of consecutive tool execution steps allowed for complex tasks (e.g. web search, file
            fetching, or MCP tools) before returning a final answer
          </p>
          <div className="flex items-center gap-4">
            <span className="text-xs text-text-muted whitespace-nowrap">{MIN_TOOL_STEPS}</span>
            <div className="relative flex-1 h-1.5 bg-input-border rounded-full">
              <div
                className="absolute h-full bg-accent rounded-full transition-all duration-150"
                style={{ width: `${stepsPercent}%` }}
              />
              <input
                id="max-tool-steps-slider"
                type="range"
                min={MIN_TOOL_STEPS}
                max={MAX_TOOL_STEPS_LIMIT}
                step={1}
                value={maxToolSteps}
                onChange={(e) => handleMaxToolStepsChange(e.target.value)}
                className="peer absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                aria-label="Maximum Tool Steps"
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-accent rounded-full border-2 border-white shadow-sm pointer-events-none transition-all duration-150 peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-1"
                style={{ left: `calc(${stepsPercent}% - 6px)` }}
                aria-hidden="true"
              />
            </div>
            <span className="text-xs text-text-muted whitespace-nowrap">{MAX_TOOL_STEPS_LIMIT}</span>
          </div>
          <div className="flex justify-between text-[10px] text-text-muted pt-1">
            <span>Minimum (1)</span>
            <span>Default (25)</span>
            <span>Maximum (100)</span>
          </div>
        </div>
      </div>
    </>
  );
};
