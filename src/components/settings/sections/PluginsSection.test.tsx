import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

import { PluginsSection } from "./PluginsSection";
import { useMcpStore } from "../../../store/useMcpStore";
import { useUIStore } from "../../../store/useUIStore";

describe("PluginsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMcpStore.setState({
      mcpConfigs: [],
      serverStatuses: {},
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

    expect(screen.getByText(/1-Click Connect with GitHub/i)).toBeInTheDocument();
    expect(screen.getByText(/Or enter a Personal Access Token manually/i)).toBeInTheDocument();

    // Click manual token toggle
    fireEvent.click(screen.getByText(/Or enter a Personal Access Token manually/i));

    expect(screen.getByText("GitHub Personal Access Token")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("ghp_...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Authorize GitHub/i })).toBeInTheDocument();
  });

  it("opens modal for Linear and displays 1-Click OAuth", () => {
    render(<PluginsSection />);

    const linearCard = screen.getByTestId("plugin-card-linear");
    fireEvent.click(linearCard);

    expect(screen.getByText(/1-Click Connect with Linear/i)).toBeInTheDocument();
    expect(screen.getByText(/Or enter a Personal API Key manually/i)).toBeInTheDocument();

    // Click manual token toggle
    fireEvent.click(screen.getByText(/Or enter a Personal API Key manually/i));

    expect(screen.getByText("Linear Personal API Key")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("lin_api_...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Authorize Linear/i })).toBeInTheDocument();
  });

  it("opens modal for Google Drive and displays 1-Click OAuth with manual fallback", () => {
    render(<PluginsSection />);

    const gdriveCard = screen.getByTestId("plugin-card-google-drive");
    fireEvent.click(gdriveCard);

    expect(screen.getByText(/1-Click Connect with Google/i)).toBeInTheDocument();
    expect(screen.getByText(/Or enter Service Account \/ credentials manually/i)).toBeInTheDocument();

    // Click manual token toggle
    fireEvent.click(screen.getByText(/Or enter Service Account \/ credentials manually/i));

    expect(screen.getByText(/Google Service Account Credentials/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("/path/to/credentials.json")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Authorize Google Drive/i })).toBeInTheDocument();
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

    const revokeButton = screen.getByRole("button", { name: /Revoke access for Linear/i });
    expect(revokeButton).toBeInTheDocument();

    fireEvent.click(revokeButton);

    await waitFor(() => {
      expect(useUIStore.getState().toasts).toContainEqual(
        expect.objectContaining({
          message: "Revoked access for Linear",
          variant: "info",
        }),
      );
    });
  });
});
