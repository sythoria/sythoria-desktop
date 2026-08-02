import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../utils/storage", () => ({
  loadGitConfig: vi.fn().mockResolvedValue({
    repoPath: "",
    isAutoCommitEnabled: false,
    isAiCommitMsgEnabled: true,
    isPreCommitEnabled: true,
    overrideIdentity: false,
    gitName: "Sythoria AI",
    gitEmail: "assistant@sythoria.local",
  }),
  saveGitConfig: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./useProjectStore", () => ({
  useProjectStore: { getState: () => ({ activeProjectId: "project-1", projects: [] }) },
}));

import { useGitStore } from "./useGitStore";

describe("useGitStore", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    useGitStore.setState({ status: null, loading: false, error: null });
  });

  it("represents a non-Git folder as read-only-capable instead of throwing", async () => {
    mocks.invoke.mockResolvedValueOnce(null);

    await expect(useGitStore.getState().verifyPath("C:/documents")).resolves.toBe(false);

    expect(useGitStore.getState().status).toMatchObject({ isRepo: false, path: "C:/documents" });
    expect(useGitStore.getState().error).toBeNull();
  });

  it("surfaces native commit failures without leaving the store loading", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("commit rejected"));

    await expect(useGitStore.getState().commitChanges("test")).rejects.toThrow("commit rejected");

    expect(useGitStore.getState()).toMatchObject({ loading: false, error: "commit rejected" });
  });
});
