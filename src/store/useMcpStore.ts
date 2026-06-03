import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { McpServerConfig, McpTool, McpToolResult, McpServerStatus } from "../types";
import { generateId } from "../utils/generateId";
import { saveMcpConfigs, saveMcpEnvSecrets } from "../utils/storage";
import { logError } from "../utils/logger";
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
    useUIStore.getState().addToast("MCP server added — configure its details", "info");
  },

  updateMcpConfig: (id, updates) => {
    const { mcpConfigs } = get();
    const updatedConfigs = mcpConfigs.map((c) => (c.id === id ? { ...c, ...updates } : c));
    set({ mcpConfigs: updatedConfigs });
    saveMcpConfigs(updatedConfigs);
  },

  deleteMcpConfig: (id) => {
    const { mcpConfigs, serverStatuses, envSecrets, availableTools } = get();
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
    useUIStore.getState().addToast("MCP server deleted", "info");
  },

  connectServer: async (id) => {
    const { mcpConfigs, envSecrets } = get();
    const config = mcpConfigs.find((c) => c.id === id);
    if (!config) return;

    set({ serverStatuses: { ...get().serverStatuses, [id]: "connecting" } });

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

      useUIStore.getState().addToast(`Connected to ${config.name} (${mcpTools.length} tools)`, "success");
    } catch (err) {
      logError("MCP server connect failed", err);
      set({ serverStatuses: { ...get().serverStatuses, [id]: "error" } });
      useUIStore.getState().addToast(parseApiError(err), "error");
    }
  },

  disconnectServer: async (id) => {
    try {
      await invoke("mcp_stop_server", { serverId: id });
    } catch (err) {
      logError("MCP server disconnect error", err);
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
    for (const server of enabledServers) {
      await get().connectServer(server.id);
    }
  },

  callTool: async (serverId, toolName, args) => {
    try {
      const raw = await invoke<string>("mcp_call_tool", {
        serverId,
        toolName,
        arguments: JSON.stringify(args),
      });
      return JSON.parse(raw) as McpToolResult;
    } catch (err) {
      logError("MCP tool call failed", err);
      return { content: `Error: ${parseApiError(err)}`, isError: true };
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
