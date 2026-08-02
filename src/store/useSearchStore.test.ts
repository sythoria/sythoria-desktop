import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FetchApiConfig, SearchApiConfig } from "../types";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../utils/storage", () => ({
  saveSearchConfigs: vi.fn(),
  saveFetchConfigs: vi.fn(),
  saveSearchApiKeys: vi.fn(),
}));
vi.mock("./useUIStore", () => ({ useUIStore: { getState: () => ({ addToast: mocks.toast }) } }));

import { useSearchStore } from "./useSearchStore";

describe("useSearchStore", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.toast.mockReset();
    useSearchStore.setState({
      searchConfigs: [],
      activeSearchId: null,
      isSearchEnabled: false,
      searchApiKeys: {},
      fetchConfigs: [],
      activeFetchId: null,
    });
  });

  it("passes explicit local-network trust to native search", async () => {
    mocks.invoke.mockResolvedValue("[]");
    const config: SearchApiConfig = {
      id: "local-search",
      name: "Local",
      provider: "searxng",
      baseUrl: "http://127.0.0.1:8080/search",
      maxResults: 5,
      enabled: true,
      allowLocalNetwork: true,
    };

    await useSearchStore.getState().performSearch("query", config, "secret");

    const payload = JSON.parse(mocks.invoke.mock.calls[0][1].config as string) as SearchApiConfig;
    expect(payload).toMatchObject({ allowLocalNetwork: true, apiKey: "secret" });
  });

  it("passes explicit local-network trust to native URL fetching", async () => {
    mocks.invoke.mockResolvedValue(JSON.stringify({ url: "http://example.test", content: "ok", status: "ok" }));
    const config: FetchApiConfig = {
      id: "local-fetch",
      name: "Local fetch",
      provider: "firecrawl",
      baseUrl: "http://127.0.0.1:3002",
      enabled: true,
      allowLocalNetwork: true,
    };
    useSearchStore.setState({
      fetchConfigs: [config],
      activeFetchId: config.id,
      searchApiKeys: { [config.id]: "key" },
    });

    await useSearchStore.getState().fetchUrlContent("https://example.test");

    const nativeArgs = mocks.invoke.mock.calls[0][1] as { config: string };
    expect(JSON.parse(nativeArgs.config)).toEqual({
      baseUrl: config.baseUrl,
      apiKey: "key",
      allowLocalNetwork: true,
    });
  });
});
