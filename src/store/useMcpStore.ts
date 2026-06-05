import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { McpServerConfig, McpTool, McpToolResult, McpServerStatus } from "../types";
import { generateId } from "../utils/generateId";
import { saveMcpConfigs, saveMcpEnvSecrets } from "../utils/storage";
import { logError, logWarn, logInfo } from "../utils/logger";
import { parseApiError } from "../utils/parseApiError";
import { validateMcpServerConfig } from "../utils/validation";
import { useUIStore } from "./useUIStore";

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
  serverStatuses: Record<string, McpServerStatus>;
  availableTools: McpTool[];
  enabledServerIds: Set<string>;

  addMcpConfig: () => void;
  updateMcpConfig: (id: string, updates: Partial<McpServerConfig>) => void;
  deleteMcpConfig: (id: string) => void;
  connectServer: (id: string) => Promise<void>;
  disconnectServer: (id: string) => Promise<void>;
  connectAllEnabled: () => Promise<void>;
  callTool: (serverId: string, toolName: string, args: Record<string, string>) => Promise<McpToolResult>;
  toggleServerEnabled: (serverId: string, enabled: boolean) => void;
  getEnabledTools: () => McpTool[];
  setEnvSecrets: (serverId: string, secrets: Record<string, string>) => void;
}

export const useMcpStore = create<McpState>((set, get) => ({
  mcpConfigs: [],
  envSecrets: {},
  serverStatuses: {},
  availableTools: [],
  enabledServerIds: new Set(),

  addMcpConfig: () => {
    const newConfig: McpServerConfig = {
      id: generateId(),
      name: "New MCP Server",
      transport: "stdio",
      command: "",
      args: [],
      enabled: true,
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
    saveMcpConfigs(updated);
    logInfo("mcp", `MCP server added: "${newConfig.name}"`, {
      details: `Transport: ${newConfig.transport}, Command: ${newConfig.command || "(not set)"}`,
    });
    useUIStore.getState().addToast("MCP server added — configure its details", "info");
  },

  updateMcpConfig: (id, updates) => {
    const { mcpConfigs } = get();
    const updatedConfigs = mcpConfigs.map((c) => (c.id === id ? { ...c, ...updates } : c));
    set({ mcpConfigs: updatedConfigs });
    saveMcpConfigs(updatedConfigs);
    const updatedConfig = updatedConfigs.find((c) => c.id === id);
    if (updatedConfig && Object.keys(updates).length > 0) {
      logInfo("mcp", `MCP server config updated: "${updatedConfig.name}"`, {
        details: `Updated fields: ${Object.keys(updates).join(", ")}`,
      });
    }
  },

  deleteMcpConfig: (id) => {
    const { mcpConfigs, serverStatuses, envSecrets, availableTools } = get();
    const config = mcpConfigs.find((c) => c.id === id);
    const updated = mcpConfigs.filter((c) => c.id !== id);
    const newStatuses = { ...serverStatuses };
    delete newStatuses[id];
    const newEnvSecrets = { ...envSecrets };
    delete newEnvSecrets[id];
    const updatedTools = availableTools.filter((t) => t.serverId !== id);
    set({
      mcpConfigs: updated,
      serverStatuses: newStatuses,
      envSecrets: newEnvSecrets,
      availableTools: updatedTools,
    });
    saveMcpConfigs(updated);
    saveMcpEnvSecrets(newEnvSecrets);
    logInfo("mcp", `MCP server deleted: "${config?.name ?? id}"`, {});
    useUIStore.getState().addToast("MCP server deleted", "info");
  },

  connectServer: async (id) => {
    const { mcpConfigs, envSecrets } = get();
    const config = mcpConfigs.find((c) => c.id === id);
    if (!config) return;

    set({ serverStatuses: { ...get().serverStatuses, [id]: "connecting" } });
    logInfo("mcp", `Connecting to MCP server: "${config.name}"`, {
      details: `Transport: ${config.transport}, Command: ${config.command || config.baseUrl || "(none)"}`,
    });

    try {
      const configPayload = { ...config };
      const envForServer = envSecrets[id] ?? {};

      const raw = await invoke<string>("mcp_start_server", {
        config: JSON.stringify(configPayload),
        envSecrets: JSON.stringify(envForServer),
      });

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

      const { availableTools, enabledServerIds } = get();
      const otherTools = availableTools.filter((t) => t.serverId !== id);
      set({
        serverStatuses: { ...get().serverStatuses, [id]: "connected" },
        availableTools: [...otherTools, ...mcpTools],
        enabledServerIds: new Set([...Array.from(enabledServerIds), id]),
      });

      logInfo("mcp", `Connected to MCP server: "${config.name}"`, {
        details: `${mcpTools.length} tool(s) available: ${mcpTools.map((t) => t.name).join(", ") || "(none)"}`,
      });
      useUIStore.getState().addToast(`Connected to ${config.name} (${mcpTools.length} tools)`, "success");
    } catch (err) {
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
    try {
      await invoke("mcp_stop_server", { serverId: id });
      logInfo("mcp", `Disconnected from MCP server: "${config?.name ?? id}"`, {});
    } catch (err) {
      logError("mcp", `MCP server disconnect error: "${config?.name ?? id}"`, {
        error: err,
        action: "The server process may have already exited. If tools are stuck, try restarting the app.",
      });
    }
    const { availableTools } = get();
    set({
      serverStatuses: { ...get().serverStatuses, [id]: "disconnected" },
      availableTools: availableTools.filter((t) => t.serverId !== id),
    });
  },

  connectAllEnabled: async () => {
    const { mcpConfigs } = get();
    const enabledServers = mcpConfigs.filter((c) => c.enabled);
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
    const { mcpConfigs } = get();
    const config = mcpConfigs.find((c) => c.id === serverId);
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

  toggleServerEnabled: (serverId, enabled) => {
    const { enabledServerIds } = get();
    const next = new Set(enabledServerIds);
    if (enabled) {
      next.add(serverId);
    } else {
      next.delete(serverId);
    }
    set({ enabledServerIds: next });
  },

  getEnabledTools: () => {
    const { availableTools, enabledServerIds } = get();
    return availableTools.filter((t) => enabledServerIds.has(t.serverId));
  },

  setEnvSecrets: (serverId, secrets) => {
    const { envSecrets } = get();
    const updated = { ...envSecrets, [serverId]: secrets };
    set({ envSecrets: updated });
    saveMcpEnvSecrets(updated);
  },
}));
