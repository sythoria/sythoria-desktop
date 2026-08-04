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
      selectedServerIds: new Set([config.id]),
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

  it("keeps a connected server running when it is removed from the chat", async () => {
    await useMcpStore.getState().toggleServerSelected(config.id, false);

    expect(useMcpStore.getState().selectedServerIds.has(config.id)).toBe(false);
    expect(useMcpStore.getState().enabledServerIds.has(config.id)).toBe(true);
    expect(useMcpStore.getState().serverStatuses[config.id]).toBe("connected");
    expect(useMcpStore.getState().availableTools).toEqual([tool]);
    expect(mocks.invoke).not.toHaveBeenCalledWith("mcp_stop_server", { serverId: config.id });
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

  it("passes the native single-use approval capability into the tool call", async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "mcp_request_tool_approval") {
        return Promise.resolve("approval-capability");
      }
      if (command === "mcp_call_tool") {
        return Promise.resolve(JSON.stringify({ content: "ok", isError: false }));
      }
      return Promise.resolve(undefined);
    });

    await expect(
      useMcpStore.getState().callTool(config.id, tool.name, { path: "notes.txt" }, "conversation-a"),
    ).resolves.toEqual({ content: "ok", isError: false });

    expect(mocks.invoke).toHaveBeenCalledWith("mcp_request_tool_approval", {
      serverId: config.id,
      toolName: tool.name,
      arguments: JSON.stringify({ path: "notes.txt" }),
      conversationId: "conversation-a",
    });
    expect(mocks.invoke).toHaveBeenCalledWith(
      "mcp_call_tool",
      expect.objectContaining({
        serverId: config.id,
        toolName: tool.name,
        conversationId: "conversation-a",
        approvalCapability: "approval-capability",
      }),
    );
  });

  it("disconnects an active server when its trust level changes", async () => {
    await useMcpStore.getState().updateMcpConfig(config.id, { trustLevel: "trusted" });

    expect(mocks.saveMcpConfigs).toHaveBeenCalledWith([
      expect.objectContaining({ id: config.id, trustLevel: "trusted" }),
    ]);
    expect(mocks.invoke).toHaveBeenCalledWith("mcp_stop_server", { serverId: config.id });
    expect(useMcpStore.getState().serverStatuses[config.id]).toBe("disconnected");
  });

  it("cancels only tool calls tracked for the deleted conversation", async () => {
    let rejectToolCall: ((reason: Error) => void) | undefined;
    let trackedRequestId = "";
    mocks.invoke.mockImplementation((command: string, args?: Record<string, unknown>) => {
      if (command === "mcp_request_tool_approval") {
        return Promise.resolve("approval-delete");
      }
      if (command === "mcp_call_tool") {
        trackedRequestId = String(args?.requestId);
        return new Promise<string>((_resolve, reject) => {
          rejectToolCall = reject;
        });
      }
      if (command === "mcp_cancel_tool_call") {
        rejectToolCall?.(new Error("Tool call cancelled"));
        return Promise.resolve(true);
      }
      return Promise.resolve(undefined);
    });

    const toolCall = useMcpStore.getState().callTool(config.id, tool.name, {}, "conversation-delete");
    await vi.waitFor(() => expect(trackedRequestId).toMatch(/^mcp-/));
    await useMcpStore.getState().cancelConversationToolCalls(["conversation-delete"]);

    await expect(toolCall).resolves.toMatchObject({ isError: true });
    expect(mocks.invoke).toHaveBeenCalledWith("mcp_cancel_tool_call", { requestId: trackedRequestId });
  });
});
