import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
});
