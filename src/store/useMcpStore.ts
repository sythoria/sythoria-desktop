import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { McpServerConfig, McpTool, McpToolResult, McpServerStatus, ExecutableCheck } from "../types";
import { generateId } from "../utils/generateId";
import { saveMcpConfigs, saveMcpEnvSecrets, saveEnabledMcpServers, saveMcpApiKeys } from "../utils/storage";
import { logError, logWarn, logInfo } from "../utils/logger";
import { parseApiError } from "../utils/parseApiError";
import { validateMcpServerConfig } from "../utils/validation";
import type { McpServerPreset } from "../config/mcpPresets";
import { useUIStore } from "./useUIStore";
import { debounce } from "../utils/debounce";

const debouncedSaveMcpConfigs = debounce((configs: McpServerConfig[]) => {
  saveMcpConfigs(configs);
}, 500);

const debouncedSaveMcpEnvSecrets = debounce((secrets: Record<string, Record<string, string>>) => {
  saveMcpEnvSecrets(secrets);
}, 500);

const debouncedSaveMcpApiKeys = debounce((keys: Record<string, string>) => {
  saveMcpApiKeys(keys);
}, 500);

const debouncedLogConfigUpdate = debounce((name: string, fields: string[]) => {
  logInfo("mcp", `MCP server config updated: "${name}"`, {
    details: `Updated fields: ${fields.join(", ")}`,
  });
}, 500);

const debouncedLogEnvUpdate = debounce((name: string) => {
  logInfo("mcp", `MCP env secrets updated for server: "${name}"`, {});
}, 500);

function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

interface McpState {
  mcpConfigs: McpServerConfig[];
  envSecrets: Record<string, Record<string, string>>;
  mcpApiKeys: Record<string, string>;
  serverStatuses: Record<string, McpServerStatus>;
  availableTools: McpTool[];
  enabledServerIds: Set<string>;
  connectionGenerations: Record<string, number>;

  addMcpConfig: () => void;
  addMcpConfigFromPreset: (preset: McpServerPreset) => void;
  updateMcpConfig: (id: string, updates: Partial<McpServerConfig>) => Promise<void>;
  deleteMcpConfig: (id: string) => Promise<void>;
  connectServer: (id: string) => Promise<void>;
  disconnectServer: (id: string) => Promise<void>;
  connectAllEnabled: () => Promise<void>;
  callTool: (serverId: string, toolName: string, args: Record<string, string>) => Promise<McpToolResult>;
  toggleServerEnabled: (serverId: string, enabled: boolean) => Promise<void>;
  getEnabledTools: () => McpTool[];
  setEnvSecrets: (serverId: string, secrets: Record<string, string>) => void;
  checkCommand: (command: string) => Promise<ExecutableCheck>;
}

export const useMcpStore = create<McpState>((set, get) => ({
  mcpConfigs: [],
  envSecrets: {},
  mcpApiKeys: {},
  serverStatuses: {},
  availableTools: [],
  enabledServerIds: new Set(),
  connectionGenerations: {},

  addMcpConfig: () => {
    const newConfig: McpServerConfig = {
      id: generateId(),
      name: "New MCP Server",
      transport: "stdio",
      command: "",
      args: [],
      enabled: true,
      trustLevel: "untrusted",
    };
    const validation = validateMcpServerConfig(newConfig);
    if (!validation.success) {
      const firstError = validation.error.issues[0]?.message ?? "Invalid MCP config";
      logWarn("mcp", `MCP config validation failed: ${firstError}`, {
        action: "Fix the MCP server configuration in Settings > MCP Servers.",
      });
      useUIStore.getState().addToast(`Validation: ${firstError}`, "error");
      return;
    }
    const { mcpConfigs } = get();
    const updated = [...mcpConfigs, newConfig];
    set({
      mcpConfigs: updated,
      serverStatuses: { ...get().serverStatuses, [newConfig.id]: "disconnected" },
    });
    debouncedSaveMcpConfigs.cancel();
    saveMcpConfigs(updated);
    logInfo("mcp", `MCP server added: "${newConfig.name}"`, {
      details: `Transport: ${newConfig.transport}, Command: ${newConfig.command || "(not set)"}`,
    });
    useUIStore.getState().addToast("MCP server added — configure its details", "info");
  },

  addMcpConfigFromPreset: (preset) => {
    const newConfig: McpServerConfig = {
      id: generateId(),
      name: preset.name,
      transport: "stdio",
      command: preset.command,
      args: [...preset.args],
      enabled: true,
      trustLevel: "untrusted",
    };
    const validation = validateMcpServerConfig(newConfig);
    if (!validation.success) {
      const firstError = validation.error.issues[0]?.message ?? "Invalid MCP config";
      logWarn("mcp", `MCP preset "${preset.name}" failed validation`, {
        action: firstError,
      });
      useUIStore.getState().addToast(`Validation: ${firstError}`, "error");
      return;
    }
    const { mcpConfigs, envSecrets } = get();
    const updated = [...mcpConfigs, newConfig];

    // Pre-seed env keys (with empty values) so the user sees them to fill in.
    let updatedEnvSecrets = envSecrets;
    if (preset.envKeys && preset.envKeys.length > 0) {
      const seed = Object.fromEntries(preset.envKeys.map((k) => [k, ""]));
      updatedEnvSecrets = { ...envSecrets, [newConfig.id]: seed };
    }

    set({
      mcpConfigs: updated,
      envSecrets: updatedEnvSecrets,
      serverStatuses: { ...get().serverStatuses, [newConfig.id]: "disconnected" },
    });
    debouncedSaveMcpConfigs.cancel();
    debouncedSaveMcpEnvSecrets.cancel();
    saveMcpConfigs(updated);
    saveMcpEnvSecrets(updatedEnvSecrets);
    const needsEnv = preset.envKeys?.length ?? 0;
    logInfo("mcp", `MCP server added from "${preset.name}" preset`, {
      details: `Command: ${newConfig.command}, Args: ${newConfig.args?.join(" ") ?? "(none)"}`,
    });
    useUIStore
      .getState()
      .addToast(
        needsEnv > 0
          ? `Added ${preset.name} — fill in ${needsEnv} env var${needsEnv > 1 ? "s" : ""}`
          : `Added ${preset.name} preset`,
        "info",
      );
  },

  updateMcpConfig: async (id, updates) => {
    const { mcpConfigs, mcpApiKeys } = get();
    const updatedConfigs = mcpConfigs.map((c) => (c.id === id ? { ...c, ...updates } : c));
    const isBeingDisabled = updates.enabled === false;

    if (isBeingDisabled) {
      const nextEnabled = new Set(get().enabledServerIds);
      nextEnabled.delete(id);
      set({
        mcpConfigs: updatedConfigs,
        enabledServerIds: nextEnabled,
        availableTools: get().availableTools.filter((tool) => tool.serverId !== id),
        serverStatuses: { ...get().serverStatuses, [id]: "disconnected" },
        connectionGenerations: {
          ...get().connectionGenerations,
          [id]: (get().connectionGenerations[id] ?? 0) + 1,
        },
      });
      await invoke("mcp_set_server_enabled", { serverId: id, enabled: false });
      await Promise.all([saveMcpConfigs(updatedConfigs), saveEnabledMcpServers(Array.from(nextEnabled))]);
      await invoke("mcp_stop_server", { serverId: id });
    } else {
      set({ mcpConfigs: updatedConfigs });
    }

    if (updates.apiKey !== undefined) {
      const newKeys = { ...mcpApiKeys, [id]: updates.apiKey };
      set({ mcpApiKeys: newKeys });
      debouncedSaveMcpApiKeys(newKeys);
    }

    if (updates.trustLevel !== undefined) {
      // Trust revocation is a security boundary: persist it immediately so a
      // quick shutdown cannot restore the previous trusted state on restart.
      debouncedSaveMcpConfigs.cancel();
      await saveMcpConfigs(updatedConfigs);
    } else if (!isBeingDisabled) {
      debouncedSaveMcpConfigs(updatedConfigs);
    }
    const updatedConfig = updatedConfigs.find((c) => c.id === id);
    if (updatedConfig && Object.keys(updates).length > 0) {
      debouncedLogConfigUpdate(updatedConfig.name, Object.keys(updates));
    }
  },

  deleteMcpConfig: async (id) => {
    const { mcpConfigs, serverStatuses, envSecrets, availableTools, mcpApiKeys } = get();
    const config = mcpConfigs.find((c) => c.id === id);
    const updated = mcpConfigs.filter((c) => c.id !== id);
    const newStatuses = { ...serverStatuses };
    delete newStatuses[id];
    const newEnvSecrets = { ...envSecrets };
    delete newEnvSecrets[id];
    const updatedTools = availableTools.filter((t) => t.serverId !== id);
    const nextEnabled = new Set(get().enabledServerIds);
    nextEnabled.delete(id);

    const newKeys = { ...mcpApiKeys };
    delete newKeys[id];

    set({
      mcpConfigs: updated,
      serverStatuses: newStatuses,
      envSecrets: newEnvSecrets,
      availableTools: updatedTools,
      enabledServerIds: nextEnabled,
      mcpApiKeys: newKeys,
      connectionGenerations: {
        ...get().connectionGenerations,
        [id]: (get().connectionGenerations[id] ?? 0) + 1,
      },
    });
    debouncedSaveMcpConfigs.cancel();
    debouncedSaveMcpEnvSecrets.cancel();
    debouncedSaveMcpApiKeys.cancel();
    await invoke("mcp_set_server_enabled", { serverId: id, enabled: false });
    await Promise.all([
      saveMcpConfigs(updated),
      saveMcpEnvSecrets(newEnvSecrets),
      saveMcpApiKeys(newKeys),
      saveEnabledMcpServers(Array.from(nextEnabled)),
    ]);
    await invoke("mcp_stop_server", { serverId: id });
    logInfo("mcp", `MCP server deleted: "${config?.name ?? id}"`, {});
    useUIStore.getState().addToast("MCP server deleted", "info");
  },

  connectServer: async (id) => {
    const { mcpConfigs, envSecrets } = get();
    const config = mcpConfigs.find((c) => c.id === id);
    if (!config || !config.enabled) return;

    const connectionGeneration = (get().connectionGenerations[id] ?? 0) + 1;

    set({
      serverStatuses: { ...get().serverStatuses, [id]: "connecting" },
      connectionGenerations: { ...get().connectionGenerations, [id]: connectionGeneration },
    });
    logInfo("mcp", `Connecting to MCP server: "${config.name}"`, {
      details: `Transport: ${config.transport}, Command: ${config.command || config.baseUrl || "(none)"}`,
    });

    try {
      const configPayload = { ...config };
      const envForServer = envSecrets[id] ?? {};

      const raw = await invoke<string>("mcp_start_server", {
        config: JSON.stringify(configPayload),
        envSecrets: JSON.stringify(envForServer),
        explicitlyEnabled: get().enabledServerIds.has(id),
      });

      const currentState = get();
      const currentConfig = currentState.mcpConfigs.find((candidate) => candidate.id === id);
      if (currentState.connectionGenerations[id] !== connectionGeneration || !currentConfig?.enabled) {
        await invoke("mcp_stop_server", { serverId: id });
        return;
      }

      const tools: { name: string; description: string; inputSchema: Record<string, unknown> }[] = JSON.parse(raw);

      const sanitizedName = sanitizeName(config.name);
      const mcpTools: McpTool[] = tools.map((t) => ({
        name: t.name,
        namespacedName: `${sanitizedName}__${t.name}`,
        description: t.description,
        inputSchema: t.inputSchema,
        serverId: id,
        serverName: config.name,
      }));

      const { availableTools } = get();
      const otherTools = availableTools.filter((t) => t.serverId !== id);
      set({
        serverStatuses: { ...get().serverStatuses, [id]: "connected" },
        availableTools: [...otherTools, ...mcpTools],
      });

      logInfo("mcp", `Connected to MCP server: "${config.name}"`, {
        details: `${mcpTools.length} tool(s) available: ${mcpTools.map((t) => t.name).join(", ") || "(none)"}`,
      });
      useUIStore.getState().addToast(`Connected to ${config.name} (${mcpTools.length} tools)`, "success");
    } catch (err) {
      if (get().connectionGenerations[id] !== connectionGeneration || !get().mcpConfigs.some((c) => c.id === id)) {
        return;
      }
      const parsed = parseApiError(err);
      logError("mcp", `MCP server connect failed: "${config.name}"`, {
        error: err,
        action: `Check the server command/path and environment variables for "${config.name}" in Settings > MCP Servers. ${parsed.action}`,
        details: `Transport: ${config.transport}, Command: ${config.command || config.baseUrl || "(none)"}. ${parsed.message}${parsed.rawDetail ? `\nRaw: ${parsed.rawDetail}` : ""}`,
      });
      set({ serverStatuses: { ...get().serverStatuses, [id]: "error" } });
      useUIStore.getState().addToast(parsed.message, "error");
    }
  },

  disconnectServer: async (id) => {
    const { mcpConfigs } = get();
    const config = mcpConfigs.find((c) => c.id === id);
    set({
      serverStatuses: { ...get().serverStatuses, [id]: "disconnected" },
      availableTools: get().availableTools.filter((tool) => tool.serverId !== id),
      connectionGenerations: {
        ...get().connectionGenerations,
        [id]: (get().connectionGenerations[id] ?? 0) + 1,
      },
    });
    try {
      await invoke("mcp_stop_server", { serverId: id });
      logInfo("mcp", `Disconnected from MCP server: "${config?.name ?? id}"`, {});
    } catch (err) {
      logError("mcp", `MCP server disconnect error: "${config?.name ?? id}"`, {
        error: err,
        action: "The server process may have already exited. If tools are stuck, try restarting the app.",
      });
    }
  },

  connectAllEnabled: async () => {
    const { mcpConfigs, enabledServerIds } = get();
    const enabledServers = mcpConfigs.filter((c) => c.enabled && enabledServerIds.has(c.id));
    if (enabledServers.length > 0) {
      logInfo("mcp", `Auto-connecting ${enabledServers.length} enabled MCP server(s)`, {
        details: enabledServers.map((s) => s.name).join(", "),
      });
    }
    for (const server of enabledServers) {
      await get().connectServer(server.id);
    }
  },

  callTool: async (serverId, toolName, args) => {
    const { mcpConfigs, enabledServerIds, serverStatuses } = get();
    const config = mcpConfigs.find((c) => c.id === serverId);
    if (!config?.enabled || !enabledServerIds.has(serverId) || serverStatuses[serverId] !== "connected") {
      return { content: "Error: MCP server is disabled or disconnected", isError: true };
    }
    try {
      logInfo("mcp", `Calling MCP tool: ${toolName}`, {
        details: `Server: "${config?.name ?? serverId}", Args: ${JSON.stringify(args).slice(0, 200)}`,
      });
      const raw = await invoke<string>("mcp_call_tool", {
        serverId,
        toolName,
        arguments: JSON.stringify(args),
      });
      const result = JSON.parse(raw) as McpToolResult;
      if (result.isError) {
        logWarn("mcp", `MCP tool returned error: ${toolName}`, {
          details: `Server: "${config?.name ?? serverId}", Error: ${result.content.slice(0, 200)}`,
          action: "Check the tool arguments and that the MCP server is running correctly.",
        });
      }
      return result;
    } catch (err) {
      const parsed = parseApiError(err);
      logError("mcp", `MCP tool call failed: ${toolName}`, {
        error: err,
        action: `Make sure the MCP server "${config?.name ?? serverId}" is still running. ${parsed.action}`,
        details: parsed.message,
      });
      return { content: `Error: ${parsed.message}`, isError: true };
    }
  },

  toggleServerEnabled: async (serverId, enabled) => {
    const { enabledServerIds, mcpConfigs } = get();
    const config = mcpConfigs.find((candidate) => candidate.id === serverId);
    if (enabled && !config?.enabled) {
      useUIStore.getState().addToast("Enable this MCP server in Settings before selecting its tools", "error");
      return;
    }
    const next = new Set(enabledServerIds);
    if (enabled) {
      next.add(serverId);
    } else {
      next.delete(serverId);
    }
    if (!enabled) {
      set({
        enabledServerIds: next,
        availableTools: get().availableTools.filter((tool) => tool.serverId !== serverId),
        serverStatuses: { ...get().serverStatuses, [serverId]: "disconnected" },
        connectionGenerations: {
          ...get().connectionGenerations,
          [serverId]: (get().connectionGenerations[serverId] ?? 0) + 1,
        },
      });
      await invoke("mcp_set_server_enabled", { serverId, enabled: false });
      await saveEnabledMcpServers(Array.from(next));
      await invoke("mcp_stop_server", { serverId });
      return;
    }

    set({ enabledServerIds: next });
    await invoke("mcp_set_server_enabled", { serverId, enabled: true });
    await saveEnabledMcpServers(Array.from(next));
    if (get().serverStatuses[serverId] !== "connected") {
      await get().connectServer(serverId);
    }
  },

  getEnabledTools: () => {
    const { availableTools, enabledServerIds, mcpConfigs, serverStatuses } = get();
    return availableTools.filter(
      (tool) =>
        enabledServerIds.has(tool.serverId) &&
        serverStatuses[tool.serverId] === "connected" &&
        mcpConfigs.some((config) => config.id === tool.serverId && config.enabled),
    );
  },

  setEnvSecrets: (serverId, secrets) => {
    const { envSecrets } = get();
    const updated = { ...envSecrets, [serverId]: secrets };
    set({ envSecrets: updated });
    debouncedSaveMcpEnvSecrets(updated);
    const config = get().mcpConfigs.find((c) => c.id === serverId);
    const serverName = config?.name ?? serverId;
    debouncedLogEnvUpdate(serverName);
  },

  checkCommand: async (command) => {
    const trimmed = command.trim();
    if (!trimmed) {
      return { found: false, message: "Enter a command to check" };
    }
    try {
      const raw = await invoke<string>("mcp_check_command", { command: trimmed });
      return JSON.parse(raw) as ExecutableCheck;
    } catch (err) {
      const parsed = parseApiError(err);
      logWarn("mcp", `Executable check failed for "${trimmed}"`, {
        details: parsed.message,
      });
      return { found: false, message: parsed.message };
    }
  },
}));
