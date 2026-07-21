import { memo } from "react";
import { motion } from "motion/react";
import { Trash2, AlertCircle, Eye, EyeOff } from "lucide-react";
import { SearchApiConfig, SearchProvider } from "../../../types";
import { SEARCH_PROVIDER_PRESETS } from "../../../config/searchPresets";
import { springs, motionTokens } from "../../../lib/motion-tokens";
import { validateSearchApiKey } from "../../../utils/validation";
import { Switch } from "../../ui/Switch";
import { Select } from "../../ui/Select";
import { useTranslation } from "../../../utils/i18n";

interface SearchApiCardProps {
  id?: string;
  config: SearchApiConfig;
  onUpdate: (id: string, updates: Partial<SearchApiConfig>) => void;
  onDelete: (id: string) => void;
  showKey: boolean;
  onToggleKey: (id: string) => void;
}

export const SearchApiCard = memo(function SearchApiCard({
  id,
  config,
  onUpdate,
  onDelete,
  showKey,
  onToggleKey,
}: SearchApiCardProps) {
  const { t } = useTranslation();
  const keyValidation = validateSearchApiKey(config.apiKey, config.provider);

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
              defaultValue: `Delete search API ${config.name}`,
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
            <label className="text-xs font-medium text-text-muted" htmlFor={`search-name-${config.id}`}>
              {t("settings.search.name")}
            </label>
            <input
              id={`search-name-${config.id}`}
              type="text"
              value={config.name}
              onChange={(e) => onUpdate(config.id, { name: e.target.value })}
              placeholder={t("settings.search.namePlaceholder", { defaultValue: "e.g. Google Search" })}
              autoComplete="off"
              autoCorrect="off"
              spellCheck="false"
              className="w-full h-10 px-3 py-2 rounded-lg border border-input-border bg-input text-sm text-text-primary placeholder-text-muted focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none transition-colors"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-text-muted" htmlFor={`search-provider-${config.id}-trigger`}>
              {t("settings.search.provider")}
            </label>
            <Select
              id={`search-provider-${config.id}`}
              value={config.provider}
              onChange={(value) => {
                const provider = value as SearchProvider;
                const preset = SEARCH_PROVIDER_PRESETS.find((candidate) => candidate.provider === provider);
                if (preset) {
                  onUpdate(config.id, {
                    provider,
                    baseUrl: preset.baseUrl || config.baseUrl,
                    name: config.name === "New Search API" ? preset.label : config.name,
                    maxResults: preset.defaultMaxResults,
                  });
                } else {
                  onUpdate(config.id, { provider });
                }
              }}
              options={SEARCH_PROVIDER_PRESETS.map((preset) => ({
                value: preset.provider,
                label: preset.label,
              }))}
              aria-label="Search provider"
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-text-muted" htmlFor={`search-base-${config.id}`}>
            {t("settings.search.baseUrl")}
          </label>
          <input
            id={`search-base-${config.id}`}
            type="url"
            value={config.baseUrl}
            onChange={(e) => onUpdate(config.id, { baseUrl: e.target.value })}
            placeholder={
              config.provider === "google"
                ? "https://www.googleapis.com/customsearch/v1"
                : config.provider === "searxng"
                  ? "http://localhost:8080"
                  : config.provider === "firecrawl"
                    ? "https://api.firecrawl.dev/v1"
                    : "https://example.com/search"
            }
            autoComplete="off"
            autoCorrect="off"
            spellCheck="false"
            className="w-full h-10 px-3 py-2 rounded-lg border border-input-border bg-input text-sm text-text-primary placeholder-text-muted font-mono text-xs focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none transition-colors"
          />
        </div>

        {(config.provider === "google" || config.provider === "firecrawl" || config.provider === "custom") && (
          <div className="space-y-1">
            <label className="text-xs font-medium text-text-muted" htmlFor={`search-key-${config.id}`}>
              {config.provider === "custom" ? t("settings.search.apiKeyOptional") : t("settings.search.apiKey")}
            </label>
            <div className="relative">
              <input
                id={`search-key-${config.id}`}
                type={showKey ? "text" : "password"}
                value={config.apiKey || ""}
                onChange={(e) => onUpdate(config.id, { apiKey: e.target.value })}
                placeholder={
                  config.provider === "google"
                    ? t("settings.search.googleApiKeyPlaceholder", { defaultValue: "Google API Key" })
                    : config.provider === "custom"
                      ? t("settings.search.customApiKeyPlaceholder", { defaultValue: "API Key (optional)" })
                      : t("settings.search.apiKeyPlaceholder", { defaultValue: "API Key" })
                }
                autoComplete="off"
                autoCorrect="off"
                spellCheck="false"
                className={`w-full h-10 px-3 py-2 pr-9 rounded-lg border bg-input text-sm text-text-primary placeholder-text-muted focus:outline-none transition-colors ${
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
        )}

        {config.provider === "google" && (
          <div className="space-y-1">
            <label className="text-xs font-medium text-text-muted" htmlFor={`search-cx-${config.id}`}>
              {t("settings.search.cx")}
            </label>
            <input
              id={`search-cx-${config.id}`}
              type="text"
              value={config.cx || ""}
              onChange={(e) => onUpdate(config.id, { cx: e.target.value })}
              placeholder="e.g. a1b2c3d4e5f6g7h8i"
              autoComplete="off"
              autoCorrect="off"
              spellCheck="false"
              className="w-full h-10 px-3 py-2 rounded-lg border border-input-border bg-input text-sm text-text-primary placeholder-text-muted font-mono text-xs focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none transition-colors"
            />
          </div>
        )}

        <div className="space-y-1">
          <label className="text-xs font-medium text-text-muted" htmlFor={`search-results-${config.id}`}>
            {t("settings.search.maxResults")}
          </label>
          <input
            id={`search-results-${config.id}`}
            type="number"
            min={1}
            max={20}
            value={config.maxResults}
            onChange={(e) => onUpdate(config.id, { maxResults: parseInt(e.target.value) || 5 })}
            className="w-full h-10 px-3 py-2 rounded-lg border border-input-border bg-input text-sm text-text-primary focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none transition-colors"
          />
        </div>
      </div>
    </motion.div>
  );
});
