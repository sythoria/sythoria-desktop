import { useState, useCallback } from "react";
import { motion } from "motion/react";
import { Plus } from "lucide-react";
import { useModelStore } from "../../store/useModelStore";
import { useSearchStore } from "../../store/useSearchStore";
import { useMcpStore } from "../../store/useMcpStore";
import { useUIStore } from "../../store/useUIStore";
import { useChatStore } from "../../store/useChatStore";
import { McpServerConfig } from "../../types";
import { McpServerPreset } from "../../config/mcpPresets";
import { springs, motionTokens } from "../../lib/motion-tokens";

import { AppearanceSection } from "./sections/AppearanceSection";
import { ConfigurationSection } from "./sections/ConfigurationSection";
import { PersonalizationSection } from "./sections/PersonalizationSection";
import { ModelsSection } from "./sections/ModelsSection";
import { BrowserSection } from "./sections/BrowserSection";
import { McpSection } from "./sections/McpSection";
import { LogsSection } from "./sections/LogsSection";
import { SectionId } from "./types";

export default function Settings() {
  const models = useModelStore((s) => s.models);
  const selectedModel = useModelStore((s) => s.selectedModel);
  const temperature = useModelStore((s) => s.temperature);
  const modelStatuses = useModelStore((s) => s.modelStatuses);
  const titleConfig = useModelStore((s) => s.titleConfig);
  const setSelectedModel = useModelStore((s) => s.setSelectedModel);
  const setTemperature = useModelStore((s) => s.setTemperature);
  const updateModel = useModelStore((s) => s.updateModel);
  const deleteModel = useModelStore((s) => s.deleteModel);
  const addModel = useModelStore((s) => s.addModel);
  const checkModelConnections = useModelStore((s) => s.checkModelConnections);
  const setTitleConfig = useModelStore((s) => s.setTitleConfig);

  const searchConfigs = useSearchStore((s) => s.searchConfigs);
  const activeSearchId = useSearchStore((s) => s.activeSearchId);
  const setActiveSearchId = useSearchStore((s) => s.setActiveSearchId);
  const updateSearchConfig = useSearchStore((s) => s.updateSearchConfig);
  const deleteSearchConfig = useSearchStore((s) => s.deleteSearchConfig);
  const addSearchConfig = useSearchStore((s) => s.addSearchConfig);

  const mcpConfigs = useMcpStore((s) => s.mcpConfigs);
  const serverStatuses = useMcpStore((s) => s.serverStatuses);
  const availableTools = useMcpStore((s) => s.availableTools);
  const envSecrets = useMcpStore((s) => s.envSecrets);
  const addMcpConfig = useMcpStore((s) => s.addMcpConfig);
  const updateMcpConfig = useMcpStore((s) => s.updateMcpConfig);
  const deleteMcpConfig = useMcpStore((s) => s.deleteMcpConfig);
  const connectServer = useMcpStore((s) => s.connectServer);
  const disconnectServer = useMcpStore((s) => s.disconnectServer);
  const setEnvSecrets = useMcpStore((s) => s.setEnvSecrets);
  const checkCommand = useMcpStore((s) => s.checkCommand);

  const theme = useUIStore((s) => s.theme);
  const animationsDisabled = useUIStore((s) => s.animationsDisabled);
  const loading = useUIStore((s) => s.loading);
  const setTheme = useUIStore((s) => s.setTheme);
  const setAnimationsDisabled = useUIStore((s) => s.setAnimationsDisabled);
  const setView = useUIStore((s) => s.setView);
  const addToast = useUIStore((s) => s.addToast);
  const activeSection = useUIStore((s) => s.activeSection) as SectionId;

  const logBuffer = useUIStore((s) => s.logBuffer);
  const logFilterSource = useUIStore((s) => s.logFilterSource);
  const logFilterLevel = useUIStore((s) => s.logFilterLevel);
  const setLogFilterSource = useUIStore((s) => s.setLogFilterSource);
  const setLogFilterLevel = useUIStore((s) => s.setLogFilterLevel);

  const newChat = useChatStore((s) => s.newChat);

  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [showSearchKeys, setShowSearchKeys] = useState<Record<string, boolean>>({});
  const [showMcpKeys, setShowMcpKeys] = useState<Record<string, boolean>>({});

  const toggleKeyVisibility = (id: string) => {
    setShowKeys((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleSearchKeyVisibility = (id: string) => {
    setShowSearchKeys((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleMcpKeyVisibility = (id: string) => {
    setShowMcpKeys((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleApplyPreset = useCallback(
    (preset: McpServerPreset, currentConfig: McpServerConfig) => {
      const isPristine =
        (currentConfig.command ?? "").trim() === "" &&
        (currentConfig.args ?? []).length === 0 &&
        currentConfig.name === "New MCP Server";
      if (!isPristine) {
        const ok = window.confirm(
          `Apply the "${preset.name}" template? This will replace the current command, arguments, and environment variables.`,
        );
        if (!ok) return;
      }
      updateMcpConfig(currentConfig.id, {
        name: preset.name,
        transport: "stdio",
        command: preset.command,
        args: [...preset.args],
      });
      if (preset.envKeys && preset.envKeys.length > 0) {
        const existing = envSecrets[currentConfig.id] ?? {};
        const merged = { ...existing };
        for (const k of preset.envKeys) {
          if (!(k in merged)) merged[k] = "";
        }
        setEnvSecrets(currentConfig.id, merged);
      }
      useUIStore.getState().addToast(`Applied "${preset.name}" template`, "info");
    },
    [envSecrets, updateMcpConfig, setEnvSecrets],
  );

  const handleCreateChat = () => {
    const id = newChat();
    setView("chat");
    return id;
  };

  const handleRefreshConnections = () => {
    checkModelConnections(undefined, true);
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden" role="region" aria-label="Settings">
      <header className="shrink-0 flex items-center justify-end px-4 py-4 md:px-6 h-14" data-tauri-drag-region>
        <motion.button
          onClick={handleCreateChat}
          whileHover={{ scale: motionTokens.scale.pop }}
          whileTap={{ scale: motionTokens.scale.press }}
          transition={springs.snappy}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent/10 text-accent hover:bg-accent/20 border border-accent/30 text-sm font-medium transition-all"
          aria-label="Create New Chat"
        >
          <Plus size={16} />
          <span>New Chat</span>
        </motion.button>
      </header>

      <div className="flex-1 flex min-w-0 overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          <motion.div
            key={activeSection}
            className="max-w-2xl mx-auto px-4 md:px-8 py-8 space-y-6"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={springs.gentle}
          >
            {activeSection === "appearance" && (
              <AppearanceSection
                theme={theme}
                setTheme={setTheme}
                animationsDisabled={animationsDisabled}
                setAnimationsDisabled={setAnimationsDisabled}
              />
            )}

            {activeSection === "configuration" && (
              <ConfigurationSection
                models={models}
                selectedModel={selectedModel}
                setSelectedModel={setSelectedModel}
                searchConfigs={searchConfigs}
                activeSearchId={activeSearchId}
                setActiveSearchId={setActiveSearchId}
                temperature={temperature}
                setTemperature={setTemperature}
                addToast={addToast}
              />
            )}

            {activeSection === "personalization" && (
              <PersonalizationSection
                titleConfig={titleConfig}
                setTitleConfig={setTitleConfig}
                models={models}
                enabledModels={models.filter((m) => m.enabled !== false)}
              />
            )}

            {activeSection === "models" && (
              <ModelsSection
                models={models}
                modelStatuses={modelStatuses}
                updateModel={updateModel}
                deleteModel={deleteModel}
                addModel={addModel}
                handleRefreshConnections={handleRefreshConnections}
                loadingCheckConnection={loading.checkConnection}
                showKeys={showKeys}
                toggleKeyVisibility={toggleKeyVisibility}
              />
            )}

            {activeSection === "browser" && (
              <BrowserSection
                searchConfigs={searchConfigs}
                updateSearchConfig={updateSearchConfig}
                deleteSearchConfig={deleteSearchConfig}
                addSearchConfig={addSearchConfig}
                showSearchKeys={showSearchKeys}
                toggleSearchKeyVisibility={toggleSearchKeyVisibility}
              />
            )}

            {activeSection === "mcp" && (
              <McpSection
                mcpConfigs={mcpConfigs}
                serverStatuses={serverStatuses}
                availableTools={availableTools}
                envSecrets={envSecrets}
                updateMcpConfig={updateMcpConfig}
                deleteMcpConfig={deleteMcpConfig}
                connectServer={connectServer}
                disconnectServer={disconnectServer}
                setEnvSecrets={setEnvSecrets}
                checkCommand={checkCommand}
                handleApplyPreset={handleApplyPreset}
                showMcpKeys={showMcpKeys}
                toggleMcpKeyVisibility={toggleMcpKeyVisibility}
                addMcpConfig={addMcpConfig}
              />
            )}

            {activeSection === "logs" && (
              <LogsSection
                logBuffer={logBuffer}
                logFilterSource={logFilterSource}
                logFilterLevel={logFilterLevel}
                setLogFilterSource={setLogFilterSource}
                setLogFilterLevel={setLogFilterLevel}
              />
            )}
          </motion.div>
        </div>
      </div>
    </div>
  );
}
