import { motion } from "motion/react";
import { Plus, Loader2 } from "lucide-react";
import { ModelCard } from "../components/ModelCard";
import { springs, motionTokens } from "../../../lib/motion-tokens";
import { ModelConfig, ConnectionStatus } from "../../../types";

interface ModelsSectionProps {
  models: ModelConfig[];
  modelStatuses: Record<string, ConnectionStatus>;
  updateModel: (id: string, updates: Partial<ModelConfig>) => void;
  deleteModel: (id: string) => void;
  addModel: () => void;
  handleRefreshConnections: () => void;
  loadingCheckConnection: boolean;
  showKeys: Record<string, boolean>;
  toggleKeyVisibility: (id: string) => void;
}

export const ModelsSection = ({
  models,
  modelStatuses,
  updateModel,
  deleteModel,
  addModel,
  handleRefreshConnections,
  loadingCheckConnection,
  showKeys,
  toggleKeyVisibility,
}: ModelsSectionProps) => {
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-text-primary mb-1">Model Endpoints</h3>
          <p className="text-xs text-text-muted">Configure AI model connections</p>
        </div>{" "}
        <div className="flex items-center gap-2">
          <motion.button
            onClick={handleRefreshConnections}
            disabled={loadingCheckConnection}
            whileHover={{ scale: motionTokens.scale.pop }}
            whileTap={{ scale: motionTokens.scale.press }}
            transition={springs.snappy}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-hover border border-border text-xs transition-colors min-h-[44px]"
            aria-label="Refresh connection status"
          >
            {loadingCheckConnection ? <Loader2 size={14} className="animate-spin" /> : null}
            Refresh
          </motion.button>
          <motion.button
            onClick={addModel}
            whileHover={{ scale: motionTokens.scale.pop }}
            whileTap={{ scale: motionTokens.scale.press }}
            transition={springs.snappy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-input text-text-primary hover:bg-hover border border-border text-sm font-medium transition-colors shadow-sm min-h-[44px]"
            aria-label="Add new model"
          >
            <Plus size={14} />
            <span>Add Model</span>
          </motion.button>
        </div>
      </div>

      <div className="space-y-4">
        {models.map((model: ModelConfig) => (
          <ModelCard
            key={model.id}
            model={model}
            onUpdate={updateModel}
            onDelete={deleteModel}
            showKey={!!showKeys[model.id]}
            onToggleKey={toggleKeyVisibility}
            connectionStatus={modelStatuses[model.id] ?? "disconnected"}
          />
        ))}
        {models.length === 0 && (
          <div className="text-center py-8 bg-surface border border-border border-dashed rounded-xl">
            <p className="text-text-muted text-sm">No models configured.</p>
            <button
              onClick={addModel}
              className="mt-2 text-accent hover:text-accent-hover text-sm font-medium min-h-[44px]"
            >
              Add your first model
            </button>
          </div>
        )}
      </div>
    </>
  );
};
