import { memo, useState } from "react";
import { motion } from "motion/react";
import { Trash2, ChevronDown, AlertCircle, Eye, EyeOff } from "lucide-react";
import { ModelConfig } from "../../../types";
import { PROVIDER_PRESETS } from "../../../config/providerPresets";
import { springs, motionTokens } from "../../../lib/motion-tokens";
import { validateApiUrl, validateApiKey } from "../../../utils/validation";
import { Switch } from "../../ui/Switch";

interface ModelCardProps {
  id?: string;
  model: ModelConfig;
  onUpdate: (id: string, updates: Partial<ModelConfig>) => void;
  onDelete: (id: string) => void;
  showKey: boolean;
  onToggleKey: (id: string) => void;
  connectionStatus: string;
}

export const ModelCard = memo(function ModelCard({
  id,
  model,
  onUpdate,
  onDelete,
  showKey,
  onToggleKey,
  connectionStatus,
}: ModelCardProps) {
  const urlValidation = validateApiUrl(model.apiBase);
  const keyValidation = validateApiKey(model.apiKey, model.provider);
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <motion.div
      id={id}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springs.gentle}
      className={`bg-surface border rounded-xl p-4 space-y-3 shadow-sm relative group ${model.enabled !== false ? "border-border" : "border-border opacity-60"}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-primary">Enabled</p>
          <p className="text-xs text-text-muted mt-0.5">Show in model selector & health check</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            role="switch"
            aria-checked={model.enabled !== false}
            aria-label="Toggle model enabled"
            onClick={() => onUpdate(model.id, { enabled: !(model.enabled !== false) })}
            onKeyDown={(e) => {
              if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                onUpdate(model.id, { enabled: !(model.enabled !== false) });
              }
            }}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface outline-none ${
              model.enabled !== false ? "bg-accent" : "bg-input-border"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full transition duration-200 shadow-sm ${
                model.enabled !== false ? "translate-x-6" : "translate-x-1"
              }`}
              style={{
                backgroundColor: model.enabled !== false ? "var(--theme-accent-foreground)" : "#ffffff",
              }}
              aria-hidden="true"
            />
          </button>
          <motion.button
            onClick={() => onDelete(model.id)}
            whileHover={{ scale: motionTokens.scale.pop }}
            whileTap={{ scale: motionTokens.scale.press }}
            transition={springs.snappy}
            className="p-1.5 rounded-lg text-text-muted hover:text-red-500 hover:bg-red-500/10 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label={`Delete model ${model.name}`}
          >
            <Trash2 size={16} />
          </motion.button>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <div
            className={`w-2 h-2 rounded-full ${
              connectionStatus === "connected"
                ? "bg-green-500"
                : connectionStatus === "connecting"
                  ? "bg-yellow-400 animate-pulse"
                  : connectionStatus === "error"
                    ? "bg-red-500"
                    : "bg-gray-400"
            }`}
            aria-label={`Status: ${connectionStatus}`}
          />
          <span className="text-[11px] text-text-muted capitalize">{connectionStatus}</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-text-muted" htmlFor={`model-name-${model.id}`}>
              Name
            </label>
            <input
              id={`model-name-${model.id}`}
              type="text"
              value={model.name}
              onChange={(e) => onUpdate(model.id, { name: e.target.value })}
              placeholder="e.g. My Llama 3"
              autoComplete="off"
              autoCorrect="off"
              spellCheck="false"
              className="w-full px-3 py-2 rounded-lg border border-input-border bg-input text-sm text-text-primary placeholder-text-muted focus:border-accent/50 focus:outline-none transition-colors"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-text-muted" htmlFor={`model-provider-${model.id}`}>
              Provider Preset
            </label>
            <div className="relative">
              <select
                id={`model-provider-${model.id}`}
                value={model.provider || "custom"}
                onChange={(e) => {
                  const preset = PROVIDER_PRESETS.find((p) => p.providerId === e.target.value);
                  if (preset) {
                    onUpdate(model.id, {
                      provider: preset.providerId,
                      apiBase: preset.apiBase || model.apiBase,
                      modelId: preset.defaultModel || model.modelId,
                      name: model.name === "New Model" ? preset.label : model.name,
                    });
                  } else {
                    onUpdate(model.id, { provider: e.target.value });
                  }
                }}
                className="w-full px-3 py-2 appearance-none rounded-lg border border-input-border bg-input text-sm text-text-primary focus:border-accent/50 focus:outline-none transition-colors"
                aria-label="Provider preset"
              >
                {PROVIDER_PRESETS.map((p) => (
                  <option key={p.providerId} value={p.providerId}>
                    {p.label}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={14}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
                aria-hidden="true"
              />
            </div>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-text-muted" htmlFor={`model-api-${model.id}`}>
            API Base URL
          </label>
          <input
            id={`model-api-${model.id}`}
            type="url"
            value={model.apiBase}
            onChange={(e) => onUpdate(model.id, { apiBase: e.target.value })}
            placeholder="https://api.openai.com/v1/chat/completions"
            autoComplete="off"
            autoCorrect="off"
            spellCheck="false"
            aria-invalid={!urlValidation.valid}
            aria-describedby={!urlValidation.valid ? `url-error-${model.id}` : undefined}
            className={`w-full px-3 py-2 rounded-lg border bg-input text-sm text-text-primary placeholder-text-muted font-mono text-xs focus:outline-none transition-colors ${
              !urlValidation.valid
                ? "border-red-500/50 focus:border-red-500"
                : "border-input-border focus:border-accent/50"
            }`}
          />
          {!urlValidation.valid && model.apiBase && (
            <p
              id={`url-error-${model.id}`}
              className="flex items-center gap-1 text-[11px] text-red-600 dark:text-red-400 mt-0.5"
              role="alert"
            >
              <AlertCircle size={11} />
              {urlValidation.error}
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-text-muted" htmlFor={`model-id-${model.id}`}>
              Model ID
            </label>
            <input
              id={`model-id-${model.id}`}
              type="text"
              value={model.modelId}
              onChange={(e) => onUpdate(model.id, { modelId: e.target.value })}
              placeholder="e.g. gpt-4o or meta/llama-3.3-70b-instruct"
              autoComplete="off"
              autoCorrect="off"
              spellCheck="false"
              className="w-full px-3 py-2 rounded-lg border border-input-border bg-input text-sm text-text-primary placeholder-text-muted font-mono text-xs focus:border-accent/50 focus:outline-none transition-colors"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-text-muted" htmlFor={`model-key-${model.id}`}>
              API Key
            </label>
            <div className="relative">
              <input
                id={`model-key-${model.id}`}
                type={showKey ? "text" : "password"}
                value={model.apiKey}
                onChange={(e) => onUpdate(model.id, { apiKey: e.target.value })}
                placeholder="API key (optional for local)"
                autoComplete="off"
                autoCorrect="off"
                spellCheck="false"
                aria-invalid={!keyValidation.valid}
                aria-describedby={!keyValidation.valid ? `key-warning-${model.id}` : undefined}
                className={`w-full px-3 py-2 pr-9 rounded-lg border bg-input text-sm text-text-primary placeholder-text-muted focus:outline-none transition-colors ${
                  !keyValidation.valid
                    ? "border-yellow-500/50 focus:border-yellow-500"
                    : "border-input-border focus:border-accent/50"
                }`}
              />
              <button
                onClick={() => onToggleKey(model.id)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors p-1"
                aria-label={showKey ? "Hide API key" : "Show API key"}
              >
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            {!keyValidation.valid && (
              <p
                id={`key-warning-${model.id}`}
                className="flex items-center gap-1 text-[11px] text-yellow-500 mt-0.5"
                role="alert"
              >
                <AlertCircle size={11} />
                {keyValidation.warning}
              </p>
            )}
          </div>
        </div>

        <div className="border-t border-border/40 pt-3">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary hover:text-text-primary transition-colors cursor-pointer select-none"
          >
            <ChevronDown
              size={14}
              className={`transition-transform duration-200 ${showAdvanced ? "rotate-180" : ""}`}
            />
            <span>Advanced Settings</span>
          </button>

          {showAdvanced && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              transition={springs.gentle}
              className="mt-3 space-y-4 border-t border-border/40 pt-3"
            >
              {/* Image Support Toggle */}
              <Switch
                checked={model.supportsImages !== false}
                onChange={(checked) => onUpdate(model.id, { supportsImages: checked })}
                label="Supports Image Inputs"
                description="Allow sending images/files to this model"
              />

              {/* Context Size & Max Output Size */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-text-muted" htmlFor={`model-context-${model.id}`}>
                    Context Window Size (tokens)
                  </label>
                  <input
                    id={`model-context-${model.id}`}
                    type="number"
                    value={model.contextSize ?? ""}
                    onChange={(e) => {
                      const val = e.target.value ? parseInt(e.target.value) : undefined;
                      onUpdate(model.id, { contextSize: val });
                    }}
                    placeholder="e.g. 128000"
                    className="w-full px-3 py-1.5 rounded-lg border border-input-border bg-input text-xs text-text-primary placeholder-text-muted focus:border-accent/50 focus:outline-none transition-colors"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-text-muted" htmlFor={`model-max-output-${model.id}`}>
                    Max Output Limit (tokens)
                  </label>
                  <input
                    id={`model-max-output-${model.id}`}
                    type="number"
                    value={model.maxOutputTokens ?? ""}
                    onChange={(e) => {
                      const val = e.target.value ? parseInt(e.target.value) : undefined;
                      onUpdate(model.id, { maxOutputTokens: val });
                    }}
                    placeholder="e.g. 4096"
                    className="w-full px-3 py-1.5 rounded-lg border border-input-border bg-input text-xs text-text-primary placeholder-text-muted focus:border-accent/50 focus:outline-none transition-colors"
                  />
                </div>
              </div>

              {/* Temperature override */}
              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <label className="text-[11px] font-medium text-text-muted" htmlFor={`model-temp-${model.id}`}>
                    Temperature Override
                  </label>
                  <span className="text-[10px] font-mono text-text-muted">
                    {model.temperature !== undefined ? model.temperature.toFixed(2) : "Default (0.70)"}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    id={`model-temp-${model.id}`}
                    type="range"
                    min="0"
                    max="2"
                    step="0.05"
                    value={model.temperature ?? 0.7}
                    onChange={(e) => onUpdate(model.id, { temperature: parseFloat(e.target.value) })}
                    className="flex-1 h-1 bg-border rounded-lg appearance-none cursor-pointer accent-accent"
                  />
                  {model.temperature !== undefined && (
                    <button
                      type="button"
                      onClick={() => onUpdate(model.id, { temperature: undefined })}
                      className="text-[10px] text-accent hover:underline shrink-0"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>

              {/* System Prompt Override */}
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-text-muted" htmlFor={`model-prompt-${model.id}`}>
                  System Prompt Override
                </label>
                <textarea
                  id={`model-prompt-${model.id}`}
                  rows={3}
                  value={model.systemPromptOverride ?? ""}
                  onChange={(e) => onUpdate(model.id, { systemPromptOverride: e.target.value || undefined })}
                  placeholder="Leave blank to use the default system prompt"
                  className="w-full px-3 py-1.5 rounded-lg border border-input-border bg-input text-xs text-text-primary placeholder-text-muted focus:border-accent/50 focus:outline-none transition-colors resize-y font-sans leading-relaxed"
                />
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </motion.div>
  );
});
