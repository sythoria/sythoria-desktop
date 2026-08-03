import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  saveMcpConfigs: vi.fn(),
  saveMcpEnvSecrets: vi.fn(),
  saveEnabledMcpServers: vi.fn(),
  saveMcpApiKeys: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../utils/storage", () => ({
  saveMcpConfigs: mocks.saveMcpConfigs,
  saveMcpEnvSecrets: mocks.saveMcpEnvSecrets,
  saveEnabledMcpServers: mocks.saveEnabledMcpServers,
  saveMcpApiKeys: mocks.saveMcpApiKeys,
}));

import type { McpServerConfig, McpTool } from "../types";
import { useMcpStore } from "./useMcpStore";

const config: McpServerConfig = {
  id: "server-1",
  name: "Server",
  transport: "stdio",
  command: "server",
  enabled: true,
};

const tool: McpTool = {
  name: "write",
  namespacedName: "server__write",
  description: "Writes",
  inputSchema: {},
  serverId: config.id,
  serverName: config.name,
};

describe("useMcpStore capability revocation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockResolvedValue(undefined);
    mocks.saveMcpConfigs.mockResolvedValue(undefined);
    mocks.saveMcpEnvSecrets.mockResolvedValue(undefined);
    mocks.saveEnabledMcpServers.mockResolvedValue(undefined);
    mocks.saveMcpApiKeys.mockResolvedValue(undefined);
    useMcpStore.setState({
      mcpConfigs: [config],
      envSecrets: {},
      mcpApiKeys: {},
      serverStatuses: { [config.id]: "connected" },
      availableTools: [tool],
      enabledServerIds: new Set([config.id]),
      connectionGenerations: { [config.id]: 1 },
    });
  });

  it("revokes local execution before awaiting native disable", async () => {
    let releaseDisable: (() => void) | undefined;
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "mcp_set_server_enabled") {
        return new Promise<void>((resolve) => {
          releaseDisable = resolve;
        });
      }
      return Promise.resolve(undefined);
    });

    const disabling = useMcpStore.getState().toggleServerEnabled(config.id, false);

    expect(useMcpStore.getState().enabledServerIds.has(config.id)).toBe(false);
    expect(useMcpStore.getState().availableTools).toEqual([]);
    expect(useMcpStore.getState().serverStatuses[config.id]).toBe("disconnected");
    expect(await useMcpStore.getState().callTool(config.id, tool.name, {})).toMatchObject({ isError: true });

    releaseDisable?.();
    await disabling;
    expect(mocks.invoke).toHaveBeenCalledWith("mcp_stop_server", { serverId: config.id });
  });

  it("does not publish a late connection after deletion", async () => {
    let releaseConnection: ((value: string) => void) | undefined;
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "mcp_start_server") {
        return new Promise<string>((resolve) => {
          releaseConnection = resolve;
        });
      }
      return Promise.resolve(undefined);
    });

    const connecting = useMcpStore.getState().connectServer(config.id);
    await useMcpStore.getState().deleteMcpConfig(config.id);
    releaseConnection?.(JSON.stringify([{ name: "late", description: "Late", inputSchema: {} }]));
    await connecting;

    expect(useMcpStore.getState().mcpConfigs).toEqual([]);
    expect(useMcpStore.getState().availableTools).toEqual([]);
    expect(useMcpStore.getState().serverStatuses[config.id]).toBeUndefined();
  });
});
