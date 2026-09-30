import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../utils/externalUrl", () => ({
  openExternalUrl: vi.fn().mockResolvedValue(true),
}));

import { PluginsSection } from "./PluginsSection";
import { useMcpStore } from "../../../store/useMcpStore";
import { useUIStore } from "../../../store/useUIStore";
import { openExternalUrl } from "../../../utils/externalUrl";
import { invoke } from "@tauri-apps/api/core";
import { PLUGINS_CATALOG } from "../../../config/pluginsCatalog";

describe("PluginsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMcpStore.setState({
      mcpConfigs: [],
      serverStatuses: {},
      serverErrors: {},
      envSecrets: {},
      enabledServerIds: new Set(),
    });
    useUIStore.setState({
      toasts: [],
    });
  });

  it("renders section header, search bar, and category buttons", () => {
    render(<PluginsSection />);

    expect(screen.getByText(/Plugins & Apps/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Search 50\+ plugins/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Featured/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Developer/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Productivity/i })).toBeInTheDocument();
  });

  it("renders catalog cards with brand titles", () => {
    render(<PluginsSection />);

    expect(screen.getByTestId("plugin-card-github")).toBeInTheDocument();
    expect(screen.getByTestId("plugin-card-notion")).toBeInTheDocument();
    expect(screen.getByTestId("plugin-card-slack")).toBeInTheDocument();
    expect(screen.getByTestId("plugin-card-linear")).toBeInTheDocument();
  });

  it("opens the MCP package link without opening setup and shows it in setup", () => {
    render(<PluginsSection />);

    const sourceLink = screen.getByRole("button", { name: "View MCP package for GitHub" });
    fireEvent.click(sourceLink);
    expect(openExternalUrl).toHaveBeenCalledWith("https://www.npmjs.com/package/%40modelcontextprotocol/server-github");
    expect(screen.queryByText(/Continue with GitHub/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("plugin-card-github"));
    expect(screen.getAllByRole("button", { name: "View MCP package for GitHub" })).toHaveLength(2);
    expect(screen.getByText("MCP package: @modelcontextprotocol/server-github")).toBeInTheDocument();
  });

  it("filters plugins when typing in the search bar", () => {
    render(<PluginsSection />);

    const searchInput = screen.getByPlaceholderText(/Search 50\+ plugins/i);
    fireEvent.change(searchInput, { target: { value: "Linear" } });

    expect(screen.getByTestId("plugin-card-linear")).toBeInTheDocument();
    expect(screen.queryByTestId("plugin-card-spotify")).not.toBeInTheDocument();
  });

  it("opens modal when clicking on a card", () => {
    render(<PluginsSection />);

    const githubCard = screen.getByTestId("plugin-card-github");
    fireEvent.click(githubCard);

    expect(screen.getByText(/Continue with GitHub/i)).toBeInTheDocument();
    expect(screen.getByText(/Or enter a Personal Access Token manually/i)).toBeInTheDocument();

    // Click manual token toggle
    fireEvent.click(screen.getByText(/Or enter a Personal Access Token manually/i));

    expect(screen.getByText("GitHub Personal Access Token")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("ghp_...")).toBeInTheDocument();
    expect(screen.getByText("Connect GitHub", { selector: "span" })).toBeInTheDocument();
  });

  it("opens modal for Linear and displays 1-Click OAuth", () => {
    render(<PluginsSection />);

    const linearCard = screen.getByTestId("plugin-card-linear");
    fireEvent.click(linearCard);

    expect(screen.getByText(/Continue with Linear/i)).toBeInTheDocument();
    expect(screen.getByText(/Or enter a Personal API Key manually/i)).toBeInTheDocument();

    // Click manual token toggle
    fireEvent.click(screen.getByText(/Or enter a Personal API Key manually/i));

    expect(screen.getByText("Linear Personal API Key")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("lin_api_...")).toBeInTheDocument();
    expect(screen.getByText("Connect Linear", { selector: "span" })).toBeInTheDocument();
  });

  it("keeps Google credentials editable and shows one inline validation error", async () => {
    render(<PluginsSection />);

    const gdriveCard = screen.getByTestId("plugin-card-google-drive");
    fireEvent.click(gdriveCard);

    expect(screen.getByText(/Continue with Google/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Google Client Secret/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Import JSON/i)[0]).toBeInTheDocument();
    expect(screen.getAllByText(/Google Cloud setup/i)[0]).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/GOCSPX-.../i)).toBeInTheDocument();

    // Click Get Credentials
    const getCredsBtn = screen.getByRole("button", { name: /Google Cloud setup/i });
    fireEvent.click(getCredsBtn);
    expect(openExternalUrl).toHaveBeenCalledWith("https://console.cloud.google.com/apis/credentials");

    // Click Connect without entering secret -> triggers pre-flight error
    const connectBtn = screen.getByRole("button", { name: /Continue with Google/i });
    await waitFor(() => expect(connectBtn).not.toBeDisabled());
    fireEvent.click(connectBtn);
    expect(await screen.findByText(/Import a Google Desktop app credentials file/i)).toBeInTheDocument();

    expect(screen.getByLabelText("Google Client ID")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/GOCSPX-.../i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Try Again|Edit Credentials|Service Account/i }),
    ).not.toBeInTheDocument();
    expect(useUIStore.getState().toasts).toHaveLength(0);
  });

  it("reuses the saved Google client without loading masked plugin secrets", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ clientId: "shared.apps.googleusercontent.com" });
    render(<PluginsSection />);
    fireEvent.click(screen.getByTestId("plugin-card-google-drive"));
    await waitFor(() =>
      expect(screen.getByLabelText("Google Client ID")).toHaveValue("shared.apps.googleusercontent.com"),
    );
    expect(screen.getByPlaceholderText(/GOCSPX-.../i)).toHaveValue("");
    expect(screen.getByText(/Google OAuth client is encrypted and shared/i)).toBeInTheDocument();
  });

  it("keeps Google setup editable when MCP startup fails after account consent", async () => {
    const plugin = PLUGINS_CATALOG.find((item) => item.id === "google-drive")!;
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_google_oauth_client") return { clientId: "client.apps.googleusercontent.com" };
      if (command === "start_google_oauth_listener") return 49152;
      if (command === "wait_google_oauth_callback") return { code: "code" };
      if (command === "google_exchange_token") return { access_token: "token" };
      if (command === "save_google_mcp_tokens") return { grantId: "grant" };
      return undefined;
    });
    const connect = vi.spyOn(useMcpStore.getState(), "addMcpConfigWithSecrets").mockImplementation(async () => {
      useMcpStore.setState({
        mcpConfigs: [
          { id: "drive", catalogPluginId: plugin.id, name: plugin.preset.name, transport: "stdio", enabled: true },
        ],
        serverStatuses: { drive: "error" },
      });
      return false;
    });
    render(<PluginsSection />);
    fireEvent.click(screen.getByTestId("plugin-card-google-drive"));
    const button = screen.getByRole("button", { name: "Continue with Google" });
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Google authorization completed, but the plugin could not start",
    );
    expect(screen.getByLabelText("Google Client ID")).toHaveValue("client.apps.googleusercontent.com");
    expect(useUIStore.getState().toasts).toHaveLength(0);
    connect.mockRestore();
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  it("requires Spotify client setup and uses OAuth for the only connect action", () => {
    render(<PluginsSection />);
    fireEvent.click(screen.getByTestId("plugin-card-spotify"));
    expect(screen.getByLabelText(/Spotify Client ID/)).toBeInTheDocument();
    expect(screen.getByText(/add exactly http:\/\/127.0.0.1:8888\/callback/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continue with Spotify/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Authorize Spotify/ })).not.toBeInTheDocument();
  });

  it("opens Canva setup from its connect action and validates credentials before starting", async () => {
    render(<PluginsSection />);
    fireEvent.click(screen.getByTitle("Connect Canva"));
    expect(screen.getByLabelText(/Canva MCP Client ID/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Canva MCP Client Secret/)).toBeInTheDocument();
    expect(screen.getByText(/Canva requires an approved MCP app/)).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith("mcp_start_server", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "Continue with Canva" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter Canva MCP Client ID");
    expect(invoke).not.toHaveBeenCalledWith("mcp_start_server", expect.anything());
  });

  it("keeps Canva authorization visible while connecting and shows a single inline failure", async () => {
    const connect = vi.spyOn(useMcpStore.getState(), "addMcpConfigWithSecrets");
    let finish: ((value: boolean) => void) | undefined;
    connect.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    render(<PluginsSection />);
    fireEvent.click(screen.getByTestId("plugin-card-canva"));
    fireEvent.change(screen.getByLabelText(/Canva MCP Client ID/), { target: { value: "client" } });
    fireEvent.change(screen.getByLabelText(/Canva MCP Client Secret/), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue with Canva" }));
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for browser authorization");
    expect(screen.getByRole("button", { name: "Connecting..." })).toBeDisabled();
    finish?.(false);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not connect Canva");
    expect(screen.getByLabelText(/Canva MCP Client ID/)).toHaveValue("client");
    expect(useUIStore.getState().toasts).toHaveLength(0);
    connect.mockRestore();
  });

  it("renders installed plugins ribbon and revokes access when cross button is clicked", async () => {
    useMcpStore.setState({
      mcpConfigs: [
        {
          id: "linear-mcp-1",
          name: "Linear",
          transport: "stdio",
          command: "npx",
          args: ["-y", "linear-mcp-server"],
          enabled: true,
          trustLevel: "untrusted",
        },
      ],
      serverStatuses: {
        "linear-mcp-1": "connected",
      },
      enabledServerIds: new Set(["linear-mcp-1"]),
    });

    render(<PluginsSection />);

    expect(screen.getByText(/Installed Plugins \(1\)/i)).toBeInTheDocument();
    expect(screen.getByTitle("Configure Linear")).toBeInTheDocument();

    const revokeButton = screen.getByRole("button", { name: /Disconnect Linear/i });
    expect(revokeButton).toBeInTheDocument();

    fireEvent.click(revokeButton);

    await waitFor(() => {
      expect(useUIStore.getState().toasts).toContainEqual(
        expect.objectContaining({
          message: "Disconnected Linear",
          variant: "info",
        }),
      );
    });
  });
});
