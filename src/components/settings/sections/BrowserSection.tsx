import { useRef, useEffect } from "react";
import { motion } from "motion/react";
import { Plus } from "lucide-react";
import { SearchApiCard } from "../components/SearchApiCard";
import { springs, motionTokens } from "../../../lib/motion-tokens";
import { SearchApiConfig } from "../../../types";

interface BrowserSectionProps {
  searchConfigs: SearchApiConfig[];
  updateSearchConfig: (id: string, updates: Partial<SearchApiConfig>) => void;
  deleteSearchConfig: (id: string) => void;
  addSearchConfig: () => void;
  showSearchKeys: Record<string, boolean>;
  toggleSearchKeyVisibility: (id: string) => void;
}

export const BrowserSection = ({
  searchConfigs,
  updateSearchConfig,
  deleteSearchConfig,
  addSearchConfig,
  showSearchKeys,
  toggleSearchKeyVisibility,
}: BrowserSectionProps) => {
  const prevIdsRef = useRef<string[]>(searchConfigs.map((c) => c.id));

  useEffect(() => {
    const currentIds = searchConfigs.map((c) => c.id);
    const prevIds = prevIdsRef.current;
    const addedId = currentIds.find((id) => !prevIds.includes(id));
    if (addedId) {
      setTimeout(() => {
        const element = document.getElementById(`search-card-${addedId}`);
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      }, 100);
    }
    prevIdsRef.current = currentIds;
  }, [searchConfigs]);

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-text-primary mb-1">Web Search APIs</h3>
          <p className="text-xs text-text-muted">Configure search providers</p>
        </div>{" "}
        <motion.button
          onClick={addSearchConfig}
          whileHover={{ scale: motionTokens.scale.pop }}
          whileTap={{ scale: motionTokens.scale.press }}
          transition={springs.snappy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-input text-text-primary hover:bg-hover border border-border text-sm font-medium transition-colors shadow-sm min-h-[44px]"
          aria-label="Add new search API"
        >
          <Plus size={14} />
          <span>Add Search API</span>
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
            <p className="text-text-muted text-sm">No search APIs configured.</p>
            <p className="text-text-muted text-xs mt-1">Add a search API to enable web search in chat.</p>
            <button
              onClick={addSearchConfig}
              className="mt-2 text-accent hover:text-accent-hover text-sm font-medium min-h-[44px]"
            >
              Add your first search API
            </button>
          </div>
        )}
      </div>
    </>
  );
};
