import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  saveSearchConfigs: vi.fn(),
  saveFetchConfigs: vi.fn(),
  saveSearchApiKeys: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../utils/storage", () => ({
  saveSearchConfigs: mocks.saveSearchConfigs,
  saveFetchConfigs: mocks.saveFetchConfigs,
  saveSearchApiKeys: mocks.saveSearchApiKeys,
}));

import type { FetchApiConfig, SearchApiConfig } from "../types";
import { useSearchStore } from "./useSearchStore";

const search: SearchApiConfig = {
  id: "search-1",
  name: "Search",
  provider: "google",
  baseUrl: "https://example.com",
  maxResults: 5,
  enabled: true,
};

const fetchConfig: FetchApiConfig = {
  id: "fetch-1",
  name: "Fetch",
  provider: "jina",
  enabled: true,
};

describe("useSearchStore enabled config selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockResolvedValue("[]");
    useSearchStore.setState({
      searchConfigs: [search],
      activeSearchId: search.id,
      isSearchEnabled: true,
      searchApiKeys: {},
      fetchConfigs: [fetchConfig],
      activeFetchId: fetchConfig.id,
    });
  });

  it("clears disabled search and fetch selections", () => {
    useSearchStore.getState().updateSearchConfig(search.id, { enabled: false });
    useSearchStore.getState().updateFetchConfig(fetchConfig.id, { enabled: false });

    expect(useSearchStore.getState().activeSearchId).toBeNull();
    expect(useSearchStore.getState().isSearchEnabled).toBe(false);
    expect(useSearchStore.getState().activeFetchId).toBeNull();
  });

  it("rejects selecting or executing a disabled search config", async () => {
    useSearchStore.getState().updateSearchConfig(search.id, { enabled: false });
    useSearchStore.getState().setActiveSearchId(search.id);

    await expect(useSearchStore.getState().performSearch("query", search, "key")).resolves.toEqual([]);
    expect(useSearchStore.getState().activeSearchId).toBeNull();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
