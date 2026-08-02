import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpServerConfig } from "../types";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  toast: vi.fn(),
  logInfo: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../utils/storage", () => ({
  saveMcpConfigs: vi.fn(),
  saveMcpEnvSecrets: vi.fn(),
  saveEnabledMcpServers: vi.fn(),
  saveMcpApiKeys: vi.fn(),
}));
vi.mock("../utils/logger", () => ({ logInfo: mocks.logInfo, logWarn: vi.fn(), logError: vi.fn() }));
vi.mock("./useUIStore", () => ({ useUIStore: { getState: () => ({ addToast: mocks.toast }) } }));

import { useMcpStore } from "./useMcpStore";

describe("useMcpStore", () => {
  const config: McpServerConfig = {
    id: "mcp-local",
    name: "Local MCP",
    transport: "streamable-http",
    baseUrl: "http://127.0.0.1:3001/mcp",
    enabled: true,
    trustLevel: "untrusted",
    allowLocalNetwork: true,
  };

  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.toast.mockReset();
    mocks.logInfo.mockReset();
    useMcpStore.setState({
      mcpConfigs: [config],
      envSecrets: {},
      mcpApiKeys: {},
      serverStatuses: { [config.id]: "disconnected" },
      availableTools: [],
      enabledServerIds: new Set(),
    });
  });

  it("passes the local-network setting to the native MCP transport", async () => {
    mocks.invoke.mockResolvedValue("[]");

    await useMcpStore.getState().connectServer(config.id);

    const nativeConfig = JSON.parse(mocks.invoke.mock.calls[0][1].config as string) as McpServerConfig;
    expect(nativeConfig.allowLocalNetwork).toBe(true);
    expect(useMcpStore.getState().serverStatuses[config.id]).toBe("connected");
  });

  it("logs argument field names without logging secret values", async () => {
    mocks.invoke.mockResolvedValue(JSON.stringify({ content: "ok", isError: false }));

    await useMcpStore.getState().callTool(config.id, "write_secret", { password: "do-not-log", path: "C:/secret" });

    const serializedLogs = JSON.stringify(mocks.logInfo.mock.calls);
    expect(serializedLogs).toContain("password");
    expect(serializedLogs).toContain("path");
    expect(serializedLogs).not.toContain("do-not-log");
    expect(serializedLogs).not.toContain("C:/secret");
  });
});
