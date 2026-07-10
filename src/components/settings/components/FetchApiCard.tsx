import { memo } from "react";
import { motion } from "motion/react";
import { Trash2, ChevronDown, AlertCircle, Eye, EyeOff } from "lucide-react";
import { FetchApiConfig, FetchProvider } from "../../../types";
import { FETCH_PROVIDER_PRESETS } from "../../../config/fetchPresets";
import { springs, motionTokens } from "../../../lib/motion-tokens";
import { validateFetchApiKey } from "../../../utils/validation";
import { Switch } from "../../ui/Switch";
import { useTranslation } from "../../../utils/i18n";

interface FetchApiCardProps {
  id?: string;
  config: FetchApiConfig;
  onUpdate: (id: string, updates: Partial<FetchApiConfig>) => void;
  onDelete: (id: string) => void;
  showKey: boolean;
  onToggleKey: (id: string) => void;
}

export const FetchApiCard = memo(function FetchApiCard({
  id,
  config,
  onUpdate,
  onDelete,
  showKey,
  onToggleKey,
}: FetchApiCardProps) {
  const { t } = useTranslation();
  const keyValidation = validateFetchApiKey(config.apiKey, config.provider);

  return (
    <motion.div
      id={id}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springs.gentle}
      className={`bg-surface border rounded-xl p-4 space-y-3 shadow-sm relative group ${config.enabled ? "border-border" : "border-border opacity-60"}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-primary">{t("settings.search.enabled")}</p>
          <p className="text-xs text-text-muted mt-0.5">{t("settings.search.enabledDesc")}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Switch checked={config.enabled} onChange={(checked) => onUpdate(config.id, { enabled: checked })} />
          <motion.button
            onClick={() => onDelete(config.id)}
            whileHover={{ scale: motionTokens.scale.pop }}
            whileTap={{ scale: motionTokens.scale.press }}
            transition={springs.snappy}
            className="p-1.5 rounded-lg text-text-muted hover:text-red-500 hover:bg-red-500/10 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label={t("settings.search.deleteTooltip", {
              defaultValue: `Delete fetch API ${config.name}`,
              name: config.name,
            })}
          >
            <Trash2 size={16} />
          </motion.button>
        </div>
      </div>

      <div className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-text-muted" htmlFor={`fetch-name-${config.id}`}>
              {t("settings.search.name")}
            </label>
            <input
              id={`fetch-name-${config.id}`}
              type="text"
              value={config.name}
              onChange={(e) => onUpdate(config.id, { name: e.target.value })}
              placeholder={t("settings.search.namePlaceholder", { defaultValue: "e.g. Firecrawl Reader" })}
              autoComplete="off"
              autoCorrect="off"
              spellCheck="false"
              className="w-full px-3 py-2 rounded-lg border border-input-border bg-input text-sm text-text-primary placeholder-text-muted focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none transition-colors"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-text-muted" htmlFor={`fetch-provider-${config.id}`}>
              {t("settings.search.provider")}
            </label>
            <div className="relative">
              <select
                id={`fetch-provider-${config.id}`}
                value={config.provider}
                onChange={(e) => {
                  const provider = e.target.value as FetchProvider;
                  const preset = FETCH_PROVIDER_PRESETS.find((p) => p.provider === provider);
                  if (preset) {
                    onUpdate(config.id, {
                      provider,
                      baseUrl: preset.baseUrl || config.baseUrl,
                      name: config.name === "New Fetch API" ? preset.label : config.name,
                    });
                  } else {
                    onUpdate(config.id, { provider });
                  }
                }}
                className="w-full px-3 py-2 appearance-none rounded-lg border border-input-border bg-input text-sm text-text-primary focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none transition-colors"
                aria-label="Fetch provider"
              >
                {FETCH_PROVIDER_PRESETS.map((p) => (
                  <option key={p.provider} value={p.provider}>
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
          <label className="text-xs font-medium text-text-muted" htmlFor={`fetch-base-${config.id}`}>
            {t("settings.search.baseUrl")}
          </label>
          <input
            id={`fetch-base-${config.id}`}
            type="url"
            value={config.baseUrl || ""}
            onChange={(e) => onUpdate(config.id, { baseUrl: e.target.value })}
            placeholder={
              config.provider === "firecrawl"
                ? "https://api.firecrawl.dev/v1"
                : config.provider === "jina"
                  ? "https://r.jina.ai"
                  : "https://example.com/fetch"
            }
            autoComplete="off"
            autoCorrect="off"
            spellCheck="false"
            className="w-full px-3 py-2 rounded-lg border border-input-border bg-input text-sm text-text-primary placeholder-text-muted font-mono text-xs focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none transition-colors"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-text-muted" htmlFor={`fetch-key-${config.id}`}>
            {config.provider === "jina" ? t("settings.search.apiKeyOptional") : t("settings.search.apiKey")}
          </label>
          <div className="relative">
            <input
              id={`fetch-key-${config.id}`}
              type={showKey ? "text" : "password"}
              value={config.apiKey || ""}
              onChange={(e) => onUpdate(config.id, { apiKey: e.target.value })}
              placeholder={
                config.provider === "jina"
                  ? t("settings.search.customApiKeyPlaceholder", { defaultValue: "API Key (optional)" })
                  : t("settings.search.apiKeyPlaceholder", { defaultValue: "API Key" })
              }
              autoComplete="off"
              autoCorrect="off"
              spellCheck="false"
              className={`w-full px-3 py-2 pr-9 rounded-lg border bg-input text-sm text-text-primary placeholder-text-muted focus:outline-none transition-colors ${
                !keyValidation.valid
                  ? "border-yellow-500/50 focus:border-yellow-500 focus:ring-2 focus:ring-yellow-500/20"
                  : "border-input-border focus:border-accent focus:ring-2 focus:ring-accent/20"
              }`}
            />
            <button
              onClick={() => onToggleKey(config.id)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors p-1"
              aria-label={
                showKey
                  ? t("settings.search.hideApiKey", { defaultValue: "Hide API key" })
                  : t("settings.search.showApiKey", { defaultValue: "Show API key" })
              }
            >
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          {!keyValidation.valid && (
            <p className="flex items-center gap-1 text-[11px] text-yellow-500 mt-0.5" role="alert">
              <AlertCircle size={11} />
              {keyValidation.warning}
            </p>
          )}
        </div>
      </div>
    </motion.div>
  );
});
