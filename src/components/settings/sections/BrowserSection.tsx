import { useRef, useEffect } from "react";
import { motion } from "motion/react";
import { Plus } from "lucide-react";
import { SearchApiCard } from "../components/SearchApiCard";
import { FetchApiCard } from "../components/FetchApiCard";
import { springs, motionTokens } from "../../../lib/motion-tokens";
import { SearchApiConfig, FetchApiConfig } from "../../../types";
import { useTranslation } from "../../../utils/i18n";

interface BrowserSectionProps {
  searchConfigs: SearchApiConfig[];
  updateSearchConfig: (id: string, updates: Partial<SearchApiConfig>) => void;
  deleteSearchConfig: (id: string) => void;
  addSearchConfig: () => void;
  showSearchKeys: Record<string, boolean>;
  toggleSearchKeyVisibility: (id: string) => void;

  fetchConfigs: FetchApiConfig[];
  updateFetchConfig: (id: string, updates: Partial<FetchApiConfig>) => void;
  deleteFetchConfig: (id: string) => void;
  addFetchConfig: () => void;
  showFetchKeys: Record<string, boolean>;
  toggleFetchKeyVisibility: (id: string) => void;
}

export const BrowserSection = ({
  searchConfigs,
  updateSearchConfig,
  deleteSearchConfig,
  addSearchConfig,
  showSearchKeys,
  toggleSearchKeyVisibility,
  fetchConfigs,
  updateFetchConfig,
  deleteFetchConfig,
  addFetchConfig,
  showFetchKeys,
  toggleFetchKeyVisibility,
}: BrowserSectionProps) => {
  const { t } = useTranslation();
  const prevSearchIdsRef = useRef<string[]>(searchConfigs.map((c) => c.id));
  const prevFetchIdsRef = useRef<string[]>(fetchConfigs.map((c) => c.id));

  useEffect(() => {
    const currentIds = searchConfigs.map((c) => c.id);
    const prevIds = prevSearchIdsRef.current;
    const addedId = currentIds.find((id) => !prevIds.includes(id));
    if (addedId) {
      setTimeout(() => {
        const element = document.getElementById(`search-card-${addedId}`);
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      }, 100);
    }
    prevSearchIdsRef.current = currentIds;
  }, [searchConfigs]);

  useEffect(() => {
    const currentIds = fetchConfigs.map((c) => c.id);
    const prevIds = prevFetchIdsRef.current;
    const addedId = currentIds.find((id) => !prevIds.includes(id));
    if (addedId) {
      setTimeout(() => {
        const element = document.getElementById(`fetch-card-${addedId}`);
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      }, 100);
    }
    prevFetchIdsRef.current = currentIds;
  }, [fetchConfigs]);

  return (
    <div className="space-y-6">
      {/* Web Search Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-text-primary mb-1">{t("settings.search.title")}</h3>
            <p className="text-xs text-text-muted">{t("settings.search.subtitle")}</p>
          </div>
          <motion.button
            onClick={addSearchConfig}
            whileHover={{ scale: motionTokens.scale.pop }}
            whileTap={{ scale: motionTokens.scale.press }}
            transition={springs.snappy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-input text-text-primary hover:bg-hover border border-border text-sm font-medium transition-colors shadow-sm min-h-[44px]"
            aria-label={t("settings.search.addBtn")}
          >
            <Plus size={14} />
            <span>{t("settings.search.addBtn")}</span>
          </motion.button>
        </div>

        <div className="space-y-4">
          {searchConfigs.map((config: SearchApiConfig) => (
            <SearchApiCard
              key={config.id}
              id={`search-card-${config.id}`}
              config={config}
              onUpdate={updateSearchConfig}
              onDelete={deleteSearchConfig}
              showKey={!!showSearchKeys[config.id]}
              onToggleKey={toggleSearchKeyVisibility}
            />
          ))}
          {searchConfigs.length === 0 && (
            <div className="text-center py-8 bg-surface border border-border border-dashed rounded-xl">
              <p className="text-text-muted text-sm">{t("settings.search.noApis")}</p>
              <p className="text-text-muted text-xs mt-1">{t("settings.search.noApisDesc")}</p>
              <button
                onClick={addSearchConfig}
                className="mt-2 text-accent hover:text-accent-hover text-sm font-medium min-h-[44px]"
              >
                {t("settings.search.addFirst")}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Web Fetching Section */}
      <div className="space-y-4 pt-6 border-t border-border/50">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-text-primary mb-1">Web Fetching APIs</h3>
            <p className="text-xs text-text-muted">Configure APIs for fetching page contents directly.</p>
          </div>
          <motion.button
            onClick={addFetchConfig}
            whileHover={{ scale: motionTokens.scale.pop }}
            whileTap={{ scale: motionTokens.scale.press }}
            transition={springs.snappy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-input text-text-primary hover:bg-hover border border-border text-sm font-medium transition-colors shadow-sm min-h-[44px]"
            aria-label="Add Fetch API"
          >
            <Plus size={14} />
            <span>Add Fetch API</span>
          </motion.button>
        </div>

        <div className="space-y-4">
          {fetchConfigs.map((config: FetchApiConfig) => (
            <FetchApiCard
              key={config.id}
              id={`fetch-card-${config.id}`}
              config={config}
              onUpdate={updateFetchConfig}
              onDelete={deleteFetchConfig}
              showKey={!!showFetchKeys[config.id]}
              onToggleKey={toggleFetchKeyVisibility}
            />
          ))}
          {fetchConfigs.length === 0 && (
            <div className="text-center py-8 bg-surface border border-border border-dashed rounded-xl">
              <p className="text-text-muted text-sm">No fetch APIs configured.</p>
              <p className="text-text-muted text-xs mt-1">Add a fetch API to configure web fetching.</p>
              <button
                onClick={addFetchConfig}
                className="mt-2 text-accent hover:text-accent-hover text-sm font-medium min-h-[44px]"
              >
                Add your first fetch API
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
