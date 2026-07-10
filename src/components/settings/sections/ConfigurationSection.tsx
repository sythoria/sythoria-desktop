import { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown, Check } from "lucide-react";
import { springs } from "../../../lib/motion-tokens";
import { useTranslation } from "../../../utils/i18n";
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
  fetchConfigs: import("../../../types").FetchApiConfig[];
  activeFetchId: string | null;
  setActiveFetchId: (id: string) => void;
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
  fetchConfigs,
  activeFetchId,
  setActiveFetchId,
  temperature,
  setTemperature,
  addToast,
  maxToolSteps,
  setMaxToolSteps,
}: ConfigurationSectionProps) => {
  const { t } = useTranslation();
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [searchProviderDropdownOpen, setSearchProviderDropdownOpen] = useState(false);
  const [fetchProviderDropdownOpen, setFetchProviderDropdownOpen] = useState(false);
  const tempToastRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxStepsToastRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const enabledModels = models.filter((m) => m.enabled !== false);
  const effectiveModel = models.find((m) => m.id === selectedModel) ?? models[0];

  const enabledSearchConfigs = searchConfigs.filter((c) => c.enabled);
  const activeSearchConfig = enabledSearchConfigs.find((c) => c.id === activeSearchId);

  const enabledFetchConfigs = fetchConfigs.filter((c) => c.enabled);
  const activeFetchConfig = enabledFetchConfigs.find((c) => c.id === activeFetchId);

  const handleTemperatureChange = useCallback(
    (value: string) => {
      const tempVal = parseFloat(value);
      setTemperature(tempVal);
      if (tempToastRef.current) clearTimeout(tempToastRef.current);
      tempToastRef.current = setTimeout(() => {
        addToast(t("settings.chat.tempToast", { temp: tempVal.toFixed(1) }), "info");
      }, 800);
    },
    [setTemperature, addToast, t],
  );

  const handleMaxToolStepsChange = useCallback(
    (value: string) => {
      const steps = parseInt(value, 10);
      setMaxToolSteps(steps);
      if (maxStepsToastRef.current) clearTimeout(maxStepsToastRef.current);
      maxStepsToastRef.current = setTimeout(() => {
        addToast(t("settings.chat.maxStepsToast", { steps: String(steps) }), "info");
      }, 800);
    },
    [setMaxToolSteps, addToast, t],
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
        <h3 className="text-sm font-semibold text-text-primary mb-1">{t("settings.chat.title")}</h3>
        <p className="text-xs text-text-muted">{t("settings.chat.subtitle")}</p>
      </div>{" "}
      <div className="bg-surface border border-border rounded-xl p-4 space-y-4 shadow-sm">
        <div className="space-y-2">
          <label htmlFor="default-model-select" className="text-sm font-medium text-text-primary block">
            {t("settings.chat.defaultModel")}
          </label>
          <p className="text-xs text-text-muted mb-2">{t("settings.chat.defaultModelDesc")}</p>
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
            {t("settings.chat.defaultSearch")}
          </label>
          <p className="text-xs text-text-muted mb-2">{t("settings.chat.defaultSearchDesc")}</p>
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
                  (enabledSearchConfigs.length === 0
                    ? t("settings.chat.noEnabledSearch")
                    : t("settings.chat.selectSearch"))}
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

        <div className="space-y-2 pt-2">
          <label htmlFor="default-fetch-provider" className="text-sm font-medium text-text-primary block">
            Default Fetch Provider
          </label>
          <p className="text-xs text-text-muted mb-2">
            Select the default provider used when fetching web page contents directly.
          </p>
          <div className="relative">
            <button
              id="default-fetch-provider"
              onClick={() => setFetchProviderDropdownOpen(!fetchProviderDropdownOpen)}
              disabled={enabledFetchConfigs.length === 0}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-input-border bg-input text-sm text-text-primary hover:border-accent/30 transition-colors min-h-[44px] disabled:opacity-50 disabled:cursor-not-allowed"
              aria-expanded={fetchProviderDropdownOpen}
              aria-haspopup="listbox"
            >
              <span>
                {activeFetchConfig?.name ||
                  (enabledFetchConfigs.length === 0 ? "No enabled fetch APIs" : "Select fetch provider")}
              </span>
              <ChevronDown
                size={16}
                className={`text-text-muted transition-transform ${fetchProviderDropdownOpen ? "rotate-180" : ""}`}
                aria-hidden="true"
              />
            </button>
            {fetchProviderDropdownOpen && enabledFetchConfigs.length > 0 && (
              <div
                className="fixed inset-0 z-10"
                onClick={() => setFetchProviderDropdownOpen(false)}
                aria-hidden="true"
              />
            )}
            <AnimatePresence>
              {fetchProviderDropdownOpen && enabledFetchConfigs.length > 0 && (
                <motion.div
                  key="fetch-provider-dropdown"
                  initial={{ opacity: 0, y: -4, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.97 }}
                  transition={springs.snappy}
                  className="absolute top-full left-0 right-0 mt-1 bg-surface border border-border rounded-xl shadow-lg z-20 overflow-hidden max-h-64 overflow-y-auto"
                  role="listbox"
                  aria-label="Available fetch providers"
                >
                  {enabledFetchConfigs.map((config) => (
                    <button
                      key={config.id}
                      onClick={() => {
                        setActiveFetchId(config.id);
                        setFetchProviderDropdownOpen(false);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2.5 text-sm transition-colors min-h-[44px] ${
                        activeFetchId === config.id
                          ? "bg-accent-soft text-accent"
                          : "text-text-secondary hover:bg-hover hover:text-text-primary"
                      }`}
                      role="option"
                      aria-selected={activeFetchId === config.id}
                    >
                      <div className="flex flex-col items-start">
                        <span className="font-medium">{config.name}</span>
                        <span className="text-[10px] text-text-muted">{config.provider}</span>
                      </div>
                      {activeFetchId === config.id && (
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
              {t("settings.chat.temperature")}
            </label>
            <span className="text-xs text-text-muted bg-input border border-input-border rounded px-2 py-0.5 font-mono">
              {temperature.toFixed(1)}
            </span>
          </div>
          <p className="text-xs text-text-muted">{t("settings.chat.temperatureDesc")}</p>
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
            <span>{t("settings.chat.tempPrecise", { defaultValue: "Precise" })}</span>
            <span>{t("settings.chat.tempBalanced", { defaultValue: "Balanced" })}</span>
            <span>{t("settings.chat.tempCreative", { defaultValue: "Creative" })}</span>
          </div>
        </div>

        <div className="space-y-3 pt-4 border-t border-border/50">
          <div className="flex items-center justify-between">
            <label htmlFor="max-tool-steps-slider" className="text-sm font-medium text-text-primary">
              {t("settings.chat.maxToolSteps")}
            </label>
            <span className="text-xs text-text-muted bg-input border border-input-border rounded px-2 py-0.5 font-mono">
              {maxToolSteps}
            </span>
          </div>
          <p className="text-xs text-text-muted">{t("settings.chat.maxToolStepsDesc")}</p>
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
            <span>{t("settings.chat.stepsMin", { defaultValue: "Minimum (1)" })}</span>
            <span>{t("settings.chat.stepsDefault", { defaultValue: "Default (25)" })}</span>
            <span>{t("settings.chat.stepsMax", { defaultValue: "Maximum (100)" })}</span>
          </div>
        </div>
      </div>
    </>
  );
};
