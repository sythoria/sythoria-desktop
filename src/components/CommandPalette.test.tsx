import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  newChat: vi.fn(),
  setShowCommandPalette: vi.fn(),
  setView: vi.fn(),
  setActiveSection: vi.fn(),
  checkForUpdates: vi.fn().mockResolvedValue(undefined),
  zoomIn: vi.fn(),
  zoomOut: vi.fn(),
  zoomReset: vi.fn(),
}));

vi.mock("../store/useUIStore", () => ({
  useUIStore: () => ({
    showCommandPalette: true,
    setShowCommandPalette: mocks.setShowCommandPalette,
    setView: mocks.setView,
    setActiveSection: mocks.setActiveSection,
    checkForUpdates: mocks.checkForUpdates,
  }),
}));

vi.mock("../store/useChatStore", () => ({
  useChatStore: {
    getState: () => ({ newChat: mocks.newChat }),
  },
}));

vi.mock("../store/useKeybindStore", () => ({
  useKeybindStore: () => ({
    zoomIn: mocks.zoomIn,
    zoomOut: mocks.zoomOut,
    zoomReset: mocks.zoomReset,
  }),
}));

import { CommandPalette } from "./CommandPalette";

describe("CommandPalette", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a conversation through the canonical chat action", async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);

    await user.click(screen.getByRole("button", { name: /new conversation/i }));

    expect(mocks.newChat).toHaveBeenCalledOnce();
    expect(mocks.setView).not.toHaveBeenCalled();
    expect(mocks.setShowCommandPalette).toHaveBeenCalledWith(false);
  });

  it("runs the shared update checker", async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);

    await user.click(screen.getByRole("button", { name: /check for updates/i }));

    expect(mocks.checkForUpdates).toHaveBeenCalledWith(false);
    expect(mocks.setShowCommandPalette).toHaveBeenCalledWith(false);
  });
});
