import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  saveMcpConfigs: vi.fn(),
  saveMcpEnvSecrets: vi.fn(),
  saveEnabledMcpServers: vi.fn(),
  saveMcpApiKeys: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../utils/storage/storage", () => ({
  saveMcpConfigs: mocks.saveMcpConfigs,
  saveMcpEnvSecrets: mocks.saveMcpEnvSecrets,
  saveEnabledMcpServers: mocks.saveEnabledMcpServers,
  saveMcpApiKeys: mocks.saveMcpApiKeys,
}));

import type { McpServerConfig, McpTool } from "../../types";
import { PLUGINS_CATALOG } from "../../config/pluginsCatalog";
import { useMcpStore } from "./useMcpStore";
import { useUIStore } from "../ui/useUIStore";

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

  it("resolves tools from explicit prompt references without global chat selection", async () => {
    await useMcpStore.getState().toggleServerSelected(config.id, false);

    expect(useMcpStore.getState().getToolsForServers([config.id])).toEqual([tool]);
    expect(useMcpStore.getState().getToolsForServers([])).toEqual([]);
  });

  it("enables a server before connecting it for explicit prompt tools", async () => {
    useMcpStore.setState({
      serverStatuses: { [config.id]: "disconnected" },
      availableTools: [],
      selectedServerIds: new Set(),
      enabledServerIds: new Set(),
    });
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "mcp_start_server") {
        return Promise.resolve(
          JSON.stringify([
            {
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema,
            },
          ]),
        );
      }
      return Promise.resolve(undefined);
    });

    await useMcpStore.getState().toggleServerEnabled(config.id, true);

    expect(useMcpStore.getState().enabledServerIds.has(config.id)).toBe(true);
    expect(mocks.invoke).toHaveBeenCalledWith("mcp_set_server_enabled", { serverId: config.id, enabled: true });
    expect(mocks.invoke).toHaveBeenCalledWith("mcp_start_server", {
      config: JSON.stringify({ ...config, apiKey: undefined }),
      explicitlyEnabled: true,
    });
    expect(useMcpStore.getState().getToolsForServers([config.id])).toEqual([
      { ...tool, namespacedName: "mcp_7365727665722d31__write" },
    ]);
  });

  it("gives same-named servers distinct tool namespaces", async () => {
    const otherConfig: McpServerConfig = {
      ...config,
      id: "server-2",
      name: "Server",
    };
    useMcpStore.setState({
      mcpConfigs: [config, otherConfig],
      serverStatuses: { [config.id]: "disconnected", [otherConfig.id]: "disconnected" },
      availableTools: [],
      enabledServerIds: new Set([config.id, otherConfig.id]),
    });
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "mcp_start_server") {
        return Promise.resolve(JSON.stringify([{ name: "write", description: "Writes", inputSchema: {} }]));
      }
      return Promise.resolve(undefined);
    });

    await useMcpStore.getState().connectServer(config.id);
    await useMcpStore.getState().connectServer(otherConfig.id);

    expect(useMcpStore.getState().availableTools.map((candidate) => candidate.namespacedName)).toEqual([
      "mcp_7365727665722d31__write",
      "mcp_7365727665722d32__write",
    ]);
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

  it("reconnects enabled Computer Use on startup using the saved installation", async () => {
    const preset = PLUGINS_CATALOG.find((plugin) => plugin.id === "computer-use")!.preset;
    const desktop = {
      ...config,
      name: preset.name,
      command: preset.command,
      args: preset.args,
      catalogPluginId: "computer-use",
    };
    useMcpStore.setState({ mcpConfigs: [desktop], serverStatuses: {}, availableTools: [] });
    mocks.invoke.mockResolvedValueOnce(
      JSON.stringify([{ name: "list_apps", description: "List apps", inputSchema: {}, readOnlyHint: true }]),
    );
    await useMcpStore.getState().connectAllEnabled();
    expect(mocks.invoke).toHaveBeenCalledWith("mcp_start_server", {
      config: JSON.stringify(desktop),
      explicitlyEnabled: true,
    });
    expect(useMcpStore.getState().serverStatuses[desktop.id]).toBe("connected");
    expect(useMcpStore.getState().availableTools).toEqual([
      expect.objectContaining({ name: "list_apps", serverId: desktop.id }),
    ]);
    expect(useMcpStore.getState().mcpConfigs).toEqual([desktop]);
    expect(mocks.saveMcpConfigs).not.toHaveBeenCalled();
  });

  it("keeps disabled Computer Use installations disconnected on startup", async () => {
    const preset = PLUGINS_CATALOG.find((plugin) => plugin.id === "computer-use")!.preset;
    useMcpStore.setState({
      mcpConfigs: [
        { ...config, name: preset.name, command: preset.command, args: preset.args, catalogPluginId: "computer-use" },
      ],
      enabledServerIds: new Set(),
      serverStatuses: {},
      availableTools: [],
    });
    await useMcpStore.getState().connectAllEnabled();
    expect(mocks.invoke).not.toHaveBeenCalledWith("mcp_start_server", expect.anything());
    expect(useMcpStore.getState().availableTools).toEqual([]);
  });

  it("requires manual Computer Use reconnect when the native session is stale", async () => {
    const preset = PLUGINS_CATALOG.find((plugin) => plugin.id === "computer-use")!.preset;
    useMcpStore.setState({
      mcpConfigs: [
        { ...config, name: preset.name, command: preset.command, args: preset.args, catalogPluginId: "computer-use" },
      ],
    });
    mocks.invoke.mockRejectedValueOnce(new Error("MCP server 'server-1' is not connected"));
    const result = await useMcpStore.getState().callTool(config.id, "write", {}, "conversation-a");
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Reconnect this plugin");
    expect(mocks.invoke).not.toHaveBeenCalledWith("mcp_start_server", expect.anything());
    expect(useMcpStore.getState().availableTools).toEqual([]);
  });

  it("does not launch browser OAuth bridges during startup", async () => {
    const bridge = { ...config, id: "canva", args: ["-y", "mcp-remote@latest", "https://mcp.canva.com/mcp"] };
    useMcpStore.setState({ mcpConfigs: [bridge], enabledServerIds: new Set([bridge.id]) });
    await useMcpStore.getState().connectAllEnabled();
    expect(mocks.invoke).not.toHaveBeenCalledWith("mcp_start_server", expect.anything());
  });

  it("requires an explicit reconnect when a browser OAuth bridge is stale", async () => {
    useMcpStore.setState({
      mcpConfigs: [{ ...config, args: ["-y", "mcp-remote@latest", "https://mcp.canva.com/mcp"] }],
    });
    mocks.invoke.mockRejectedValueOnce(new Error("MCP server 'server-1' is not connected"));
    const result = await useMcpStore.getState().callTool(config.id, tool.name, {});
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Reconnect this plugin");
    expect(mocks.invoke).not.toHaveBeenCalledWith("mcp_start_server", expect.anything());
    expect(useMcpStore.getState().serverStatuses[config.id]).toBe("disconnected");
  });

  it("cancels a pending native connection when authorization is cancelled", async () => {
    let release: ((value: string) => void) | undefined;
    mocks.invoke.mockImplementation((command: string) =>
      command === "mcp_start_server"
        ? new Promise<string>((resolve) => {
            release = resolve;
          })
        : Promise.resolve(undefined),
    );
    const controller = new AbortController();
    const pending = useMcpStore.getState().connectServer(config.id, { signal: controller.signal });
    controller.abort();
    expect(mocks.invoke).toHaveBeenCalledWith("mcp_stop_server", { serverId: config.id });
    release?.("[]");
    await pending;
    expect(useMcpStore.getState().serverStatuses[config.id]).toBe("disconnected");
    expect(useMcpStore.getState().availableTools).toEqual([]);
  });

  it("reconnects and retries once when native MCP state is stale", async () => {
    let approvalAttempts = 0;
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "mcp_request_tool_approval") {
        approvalAttempts += 1;
        if (approvalAttempts === 1) {
          return Promise.reject(new Error("MCP server 'server-1' is not connected"));
        }
        return Promise.resolve("replacement-approval");
      }
      if (command === "mcp_start_server") {
        return Promise.resolve(JSON.stringify([{ name: tool.name, description: tool.description, inputSchema: {} }]));
      }
      if (command === "mcp_call_tool") {
        return Promise.resolve(JSON.stringify({ content: "recovered", isError: false }));
      }
      return Promise.resolve(undefined);
    });

    await expect(useMcpStore.getState().callTool(config.id, tool.name, {}, "conversation-recovery")).resolves.toEqual({
      content: "recovered",
      isError: false,
    });

    expect(mocks.invoke).toHaveBeenCalledWith("mcp_start_server", expect.objectContaining({ explicitlyEnabled: true }));
    expect(mocks.invoke).toHaveBeenCalledWith(
      "mcp_call_tool",
      expect.objectContaining({ approvalCapability: "replacement-approval" }),
    );
    expect(approvalAttempts).toBe(2);
    expect(useMcpStore.getState().serverStatuses[config.id]).toBe("connected");
  });

  it("disconnects an active server when its trust level changes", async () => {
    await useMcpStore.getState().updateMcpConfig(config.id, { trustLevel: "trusted" });

    expect(mocks.saveMcpConfigs).toHaveBeenCalledWith([
      expect.objectContaining({ id: config.id, trustLevel: "trusted" }),
    ]);
    expect(mocks.invoke).toHaveBeenCalledWith("mcp_stop_server", { serverId: config.id });
    expect(useMcpStore.getState().serverStatuses[config.id]).toBe("disconnected");
  });

  it("installs bundled catalog plugins as verified and trusted", async () => {
    const memory = PLUGINS_CATALOG.find((plugin) => plugin.id === "memory")!;
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "mcp_start_server") return Promise.resolve("[]");
      return Promise.resolve(undefined);
    });

    await expect(
      useMcpStore.getState().addMcpConfigWithSecrets(memory.preset, {}, { catalogPluginId: memory.id }),
    ).resolves.toBe(true);

    expect(useMcpStore.getState().mcpConfigs.find((candidate) => candidate.name === memory.name)).toMatchObject({
      catalogPluginId: memory.id,
      trustLevel: "trusted",
    });
  });

  it("saves the Fireflies bearer key before starting its native HTTP connection", async () => {
    const fireflies = PLUGINS_CATALOG.find((plugin) => plugin.id === "fireflies")!;
    mocks.invoke.mockImplementation((command: string) =>
      Promise.resolve(command === "mcp_start_server" ? "[]" : undefined),
    );

    await expect(
      useMcpStore
        .getState()
        .addMcpConfigWithSecrets(
          fireflies.preset,
          { FIREFLIES_API_KEY: "test-key" },
          { catalogPluginId: fireflies.id },
        ),
    ).resolves.toBe(true);

    const created = useMcpStore.getState().mcpConfigs.find((candidate) => candidate.catalogPluginId === "fireflies")!;
    expect(created).toMatchObject({
      transport: "streamable-http",
      baseUrl: "https://api.fireflies.ai/mcp",
      trustLevel: "trusted",
    });
    expect(mocks.saveMcpApiKeys).toHaveBeenCalledWith(expect.objectContaining({ [created.id]: "test-key" }));
    const start = mocks.invoke.mock.calls.find(([command]) => command === "mcp_start_server")!;
    expect(JSON.parse(start[1].config)).not.toHaveProperty("apiKey", "test-key");
  });

  it("maps the Atlassian form credentials to the local Jira and Confluence server", async () => {
    const atlassian = PLUGINS_CATALOG.find((plugin) => plugin.id === "jira-confluence")!;
    mocks.invoke.mockImplementation((command: string) =>
      Promise.resolve(command === "mcp_start_server" ? "[]" : undefined),
    );

    await useMcpStore.getState().addMcpConfigWithSecrets(
      atlassian.preset,
      {
        ATLASSIAN_DOMAIN: "example.atlassian.net",
        ATLASSIAN_EMAIL: "user@example.com",
        ATLASSIAN_API_TOKEN: "test-token",
      },
      { catalogPluginId: atlassian.id },
    );

    const created = useMcpStore.getState().mcpConfigs.find((candidate) => candidate.catalogPluginId === atlassian.id)!;
    expect(useMcpStore.getState().envSecrets[created.id]).toMatchObject({
      JIRA_URL: "https://example.atlassian.net",
      CONFLUENCE_URL: "https://example.atlassian.net/wiki",
      JIRA_USERNAME: "user@example.com",
      CONFLUENCE_USERNAME: "user@example.com",
      JIRA_API_TOKEN: "test-token",
      CONFLUENCE_API_TOKEN: "test-token",
    });
  });

  it("returns a verified plugin to untrusted MCP protections when its package is edited", async () => {
    const verifiedConfig: McpServerConfig = {
      id: "verified-memory",
      name: "Memory Knowledge Graph",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-memory"],
      enabled: true,
      trustLevel: "trusted",
      catalogPluginId: "memory",
    };
    useMcpStore.setState({
      mcpConfigs: [verifiedConfig],
      serverStatuses: { [verifiedConfig.id]: "connected" },
      enabledServerIds: new Set([verifiedConfig.id]),
    });

    await useMcpStore.getState().updateMcpConfig(verifiedConfig.id, {
      args: ["-y", "unverified-memory-server"],
    });

    expect(useMcpStore.getState().mcpConfigs[0]).toMatchObject({ trustLevel: "untrusted" });
    expect(useMcpStore.getState().mcpConfigs[0].catalogPluginId).toBeUndefined();
    expect(mocks.invoke).toHaveBeenCalledWith("mcp_stop_server", { serverId: verifiedConfig.id });
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

  it("lets a connection form own error presentation without a duplicate toast", async () => {
    useUIStore.setState({ toasts: [] });
    mocks.invoke.mockRejectedValue(new Error("Connection failed"));
    await useMcpStore.getState().connectServer(config.id, { notify: false });
    expect(useMcpStore.getState().serverStatuses[config.id]).toBe("error");
    expect(useUIStore.getState().toasts).toHaveLength(0);
  });

  it("interpolates argument placeholders and un-enables failed server on error", async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "mcp_start_server") {
        return Promise.reject(new Error("Handshake failed: process exited"));
      }
      return Promise.resolve(undefined);
    });

    const preset = {
      id: "postgres-preset",
      name: "PostgreSQL Database",
      description: "Postgres database",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-postgres", "<DATABASE_URL>"],
      envKeys: ["DATABASE_URL"],
    };

    const result = await useMcpStore.getState().addMcpConfigWithSecrets(preset, {
      DATABASE_URL: "postgresql://localhost:5432/mydb",
    });

    expect(result).toBe(false);
    const created = useMcpStore.getState().mcpConfigs.find((c) => c.name === preset.name);
    expect(created).toBeDefined();
    expect(created?.args).toEqual(["-y", "@modelcontextprotocol/server-postgres", "postgresql://localhost:5432/mydb"]);
    expect(created).toMatchObject({ trustLevel: "untrusted" });
    expect(created?.catalogPluginId).toBeUndefined();
    // Since connection failed, server should NOT remain in enabledServerIds
    expect(useMcpStore.getState().enabledServerIds.has(created!.id)).toBe(false);
    expect(useMcpStore.getState().serverStatuses[created!.id]).toBe("error");
  });
});
