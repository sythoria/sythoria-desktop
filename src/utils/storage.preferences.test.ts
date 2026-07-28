import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

describe("encrypted preferences", () => {
  beforeEach(() => {
    vi.resetModules();
    invokeMock.mockReset();
    const values = new Map<string, string>();
    const storage = {
      get length() {
        return values.size;
      },
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => [...values.keys()][index] ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, String(value)),
    };
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: storage,
    });
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "load_encrypted_preferences") return {};
      if (command === "mutate_encrypted_preferences") return {};
      throw new Error(`Unexpected command: ${command}`);
    });
  });

  it("migrates a legacy browser preference before deleting its plaintext copy", async () => {
    localStorage.setItem("sythoria-theme", "dark");
    const { loadTheme } = await import("./storage");

    await expect(loadTheme()).resolves.toMatchObject({ mode: "dark" });
    expect(localStorage.getItem("sythoria-theme")).toBeNull();
    expect(invokeMock).toHaveBeenCalledWith(
      "mutate_encrypted_preferences",
      expect.objectContaining({
        sets: expect.objectContaining({ "sythoria-theme": "dark" }),
      }),
    );
  });

  it("persists new preferences only through the encrypted backend", async () => {
    const { saveUiLayoutSettings } = await import("./storage");

    await saveUiLayoutSettings({ sidebarWidth: 320, isAuxSummaryPinned: true });

    expect(localStorage.length).toBe(0);
    expect(invokeMock).toHaveBeenCalledWith("mutate_encrypted_preferences", {
      sets: {
        "sythoria-sidebar-width": 320,
        "sythoria-aux-summary-pinned": true,
      },
      deletes: [],
      clear: false,
    });
  });
});
