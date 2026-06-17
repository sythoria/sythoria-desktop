import { motion } from "motion/react";
import { Plus } from "lucide-react";
import { McpServerCard } from "../components/McpServerCard";
import { springs, motionTokens } from "../../../lib/motion-tokens";
import { McpServerConfig, McpServerStatus, McpTool, ExecutableCheck } from "../../../types";
import { McpServerPreset } from "../../../config/mcpPresets";

interface McpSectionProps {
  mcpConfigs: McpServerConfig[];
  serverStatuses: Record<string, McpServerStatus>;
  availableTools: McpTool[];
  envSecrets: Record<string, Record<string, string>>;
  updateMcpConfig: (id: string, updates: Partial<McpServerConfig>) => void;
  deleteMcpConfig: (id: string) => void;
  connectServer: (id: string) => void;
  disconnectServer: (id: string) => void;
  setEnvSecrets: (id: string, secrets: Record<string, string>) => void;
  checkCommand: (command: string) => Promise<ExecutableCheck>;
  handleApplyPreset: (preset: McpServerPreset, currentConfig: McpServerConfig) => void;
  showMcpKeys: Record<string, boolean>;
  toggleMcpKeyVisibility: (id: string) => void;
  addMcpConfig: () => void;
}

export const McpSection = ({
  mcpConfigs,
  serverStatuses,
  availableTools,
  envSecrets,
  updateMcpConfig,
  deleteMcpConfig,
  connectServer,
  disconnectServer,
  setEnvSecrets,
  checkCommand,
  handleApplyPreset,
  showMcpKeys,
  toggleMcpKeyVisibility,
  addMcpConfig,
}: McpSectionProps) => {
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-text-primary mb-1">MCP Servers</h3>
          <p className="text-xs text-text-muted">Extend AI with external tools</p>
        </div>{" "}
        <motion.button
          onClick={addMcpConfig}
          whileHover={{ scale: motionTokens.scale.pop }}
          whileTap={{ scale: motionTokens.scale.press }}
          transition={springs.snappy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-input text-text-primary hover:bg-hover border border-border text-sm font-medium transition-colors shadow-sm min-h-[44px]"
          aria-label="Add MCP server"
        >
          <Plus size={14} />
          <span>Add Server</span>
        </motion.button>
      </div>

      <div className="space-y-4">
        {mcpConfigs.map((mcpConfig: McpServerConfig) => (
          <McpServerCard
            key={mcpConfig.id}
            config={mcpConfig}
            status={serverStatuses[mcpConfig.id] ?? "disconnected"}
            tools={availableTools
              .filter((t) => t.serverId === mcpConfig.id)
              .map((t) => ({ name: t.name, description: t.description }))}
            envVars={envSecrets[mcpConfig.id] ?? {}}
            onUpdate={updateMcpConfig}
            onDelete={deleteMcpConfig}
            onConnect={connectServer}
            onDisconnect={disconnectServer}
            onSetEnvVars={setEnvSecrets}
            onCheckCommand={checkCommand}
            onApplyPreset={handleApplyPreset}
            showKey={!!showMcpKeys[mcpConfig.id]}
            onToggleKey={toggleMcpKeyVisibility}
          />
        ))}
        {mcpConfigs.length === 0 && (
          <div className="text-center py-8 bg-surface border border-border border-dashed rounded-xl">
            <p className="text-text-muted text-sm">No MCP servers configured.</p>
            <p className="text-text-muted text-xs mt-1">
              Add an MCP server to extend AI capabilities with external tools.
            </p>
            <button
              onClick={addMcpConfig}
              className="mt-2 text-accent hover:text-accent-hover text-sm font-medium min-h-[44px]"
            >
              Add your first MCP server
            </button>
          </div>
        )}
      </div>
    </>
  );
};
