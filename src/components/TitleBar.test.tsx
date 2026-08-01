import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  checkForUpdates: vi.fn().mockResolvedValue(undefined),
  getVersion: vi.fn().mockResolvedValue("0.4.1"),
  setActiveId: vi.fn(),
  setView: vi.fn(),
  setActiveSection: vi.fn(),
  toggleCommandPalette: vi.fn(),
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: mocks.getVersion,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
  }),
}));

vi.mock("../store/useKeybindStore", () => ({
  useKeybindStore: () => ({
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    zoomReset: vi.fn(),
  }),
}));

vi.mock("../store/useChatStore", () => ({
  useChatStore: {
    getState: () => ({ setActiveId: mocks.setActiveId }),
  },
}));

vi.mock("../store/useUIStore", () => ({
  useUIStore: {
    getState: () => ({
      checkForUpdates: mocks.checkForUpdates,
      setView: mocks.setView,
      setActiveSection: mocks.setActiveSection,
      toggleCommandPalette: mocks.toggleCommandPalette,
    }),
  },
}));

import { TitleBar } from "./TitleBar";

describe("TitleBar application menu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getVersion.mockResolvedValue("0.4.1");
  });

  it("shows the runtime app version and runs the real updater check", async () => {
    const user = userEvent.setup();
    render(<TitleBar />);

    await user.click(screen.getByRole("menuitem", { name: "Sythoria" }));

    expect(await screen.findByRole("menuitem", { name: "Version 0.4.1" })).toBeInTheDocument();

    await user.click(screen.getByRole("menuitem", { name: "Check for Updates" }));

    expect(mocks.getVersion).toHaveBeenCalledOnce();
    expect(mocks.checkForUpdates).toHaveBeenCalledWith(false);
  });
});
