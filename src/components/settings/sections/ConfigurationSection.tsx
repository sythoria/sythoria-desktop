import { useCallback, useRef, useEffect } from "react";
import { useTranslation } from "../../../utils/i18n";
import { Select } from "../../ui/Select";
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
  const tempToastRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxStepsToastRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const enabledModels = models.filter((m) => m.enabled !== false);
  const enabledSearchConfigs = searchConfigs.filter((c) => c.enabled);
  const enabledFetchConfigs = fetchConfigs.filter((c) => c.enabled);

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
        <div id="setting-configuration-model" className="space-y-2">
          <label htmlFor="default-model-select-trigger" className="text-sm font-medium text-text-primary block">
            {t("settings.chat.defaultModel")}
          </label>
          <p className="text-xs text-text-muted mb-2">{t("settings.chat.defaultModelDesc")}</p>
          <Select
            id="default-model-select"
            value={selectedModel}
            onChange={setSelectedModel}
            options={enabledModels.map((model) => ({
              value: model.id,
              label: model.name,
              description: model.modelId,
            }))}
            disabled={enabledModels.length === 0}
            placeholder="No Model"
            aria-label="Available models"
          />
        </div>

        <div className="space-y-2 pt-2">
          <label htmlFor="default-search-provider-trigger" className="text-sm font-medium text-text-primary block">
            {t("settings.chat.defaultSearch")}
          </label>
          <p className="text-xs text-text-muted mb-2">{t("settings.chat.defaultSearchDesc")}</p>
          <Select
            id="default-search-provider"
            value={activeSearchId ?? ""}
            onChange={setActiveSearchId}
            options={enabledSearchConfigs.map((config) => ({
              value: config.id,
              label: config.name,
              description: config.provider,
            }))}
            disabled={enabledSearchConfigs.length === 0}
            placeholder={
              enabledSearchConfigs.length === 0 ? t("settings.chat.noEnabledSearch") : t("settings.chat.selectSearch")
            }
            aria-label="Available search providers"
          />
        </div>

        <div className="space-y-2 pt-2">
          <label htmlFor="default-fetch-provider-trigger" className="text-sm font-medium text-text-primary block">
            Default Fetch Provider
          </label>
          <p className="text-xs text-text-muted mb-2">
            Select the default provider used when fetching web page contents directly.
          </p>
          <Select
            id="default-fetch-provider"
            value={activeFetchId ?? ""}
            onChange={setActiveFetchId}
            options={enabledFetchConfigs.map((config) => ({
              value: config.id,
              label: config.name,
              description: config.provider,
            }))}
            disabled={enabledFetchConfigs.length === 0}
            placeholder={enabledFetchConfigs.length === 0 ? "No enabled fetch APIs" : "Select fetch provider"}
            aria-label="Available fetch providers"
          />
        </div>

        <div id="setting-configuration-temperature" className="space-y-3 pt-2 border-t border-border/50">
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

        <div id="setting-configuration-max-steps" className="space-y-3 pt-4 border-t border-border/50">
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
