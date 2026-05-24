import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { SearchApiConfig, SearchResult, UrlContent } from "../types";
import { saveSearchConfigs, saveSearchApiKeys } from "../utils/storage";
import { logError } from "../utils/logger";
import { parseApiError } from "../utils/parseApiError";
import { validateSearchConfig } from "../utils/validation";
import { useUIStore } from "./useUIStore";

interface SearchState {
  searchConfigs: SearchApiConfig[];
  activeSearchId: string | null;
  isSearchEnabled: boolean;
  searchApiKeys: Record<string, string>;

  addSearchConfig: () => void;
  updateSearchConfig: (id: string, updates: Partial<SearchApiConfig>) => void;
  deleteSearchConfig: (id: string) => void;
  setActiveSearchId: (id: string | null) => void;
  toggleSearchEnabled: (enabled: boolean) => void;
  performSearch: (query: string, config: SearchApiConfig, apiKey: string) => Promise<SearchResult[]>;
  fetchUrlContent: (url: string) => Promise<UrlContent>;
}

export const useSearchStore = create<SearchState>((set, get) => ({
  searchConfigs: [],
  activeSearchId: null,
  isSearchEnabled: false,
  searchApiKeys: {},

  addSearchConfig: () => {
    const newConfig: SearchApiConfig = {
      id: "search-" + Date.now(),
      name: "New Search API",
      provider: "google",
      baseUrl: "https://www.googleapis.com/customsearch/v1",
      apiKey: "",
      cx: "",
      maxResults: 5,
      enabled: true,
    };
    const validation = validateSearchConfig(newConfig);
    if (!validation.success) {
      const firstError = validation.error.issues[0]?.message ?? "Invalid search config";
      useUIStore.getState().addToast(`Validation: ${firstError}`, "error");
      return;
    }
    const { searchConfigs } = get();
    const updated = [...searchConfigs, newConfig];
    set({ searchConfigs: updated, activeSearchId: newConfig.id });
    saveSearchConfigs(updated.map(({ apiKey: _apiKey, ...rest }) => rest as SearchApiConfig));
    useUIStore.getState().addToast("Search API added — configure its details", "info");
  },

  updateSearchConfig: (id, updates) => {
    const { searchConfigs, searchApiKeys } = get();
    const updatedConfigs = searchConfigs.map((c) => (c.id === id ? { ...c, ...updates } : c));
    set({ searchConfigs: updatedConfigs });

    if (updates.apiKey !== undefined) {
      const newKeys = { ...searchApiKeys, [id]: updates.apiKey! };
      set({ searchApiKeys: newKeys });
      saveSearchApiKeys(newKeys);
    }

    const configsWithoutKeys = updatedConfigs.map(({ apiKey: _apiKey, ...rest }) => rest as SearchApiConfig);
    saveSearchConfigs(configsWithoutKeys);

    if (!updatedConfigs.find((c) => c.id === get().activeSearchId) && updatedConfigs.length > 0) {
      set({ activeSearchId: updatedConfigs[0].id });
    }
  },

  deleteSearchConfig: (id) => {
    const { searchConfigs, activeSearchId, searchApiKeys } = get();
    const updated = searchConfigs.filter((c) => c.id !== id);
    const newKeys = { ...searchApiKeys };
    delete newKeys[id];
    set({
      searchConfigs: updated,
      activeSearchId: activeSearchId === id ? (updated[0]?.id ?? null) : activeSearchId,
      searchApiKeys: newKeys,
    });
    saveSearchConfigs(updated.map(({ apiKey: _apiKey, ...rest }) => rest as SearchApiConfig));
    saveSearchApiKeys(newKeys);
    useUIStore.getState().addToast("Search API deleted", "info");
  },

  setActiveSearchId: (id) => set({ activeSearchId: id }),
  toggleSearchEnabled: (enabled) => set({ isSearchEnabled: enabled }),

  performSearch: async (query, config, apiKey) => {
    try {
      const configPayload = { ...config, apiKey };
      const raw = await invoke<string>("web_search", {
        provider: config.provider,
        query,
        config: JSON.stringify(configPayload),
        configId: config.id,
      });
      return JSON.parse(raw) as SearchResult[];
    } catch (err) {
      logError("Search failed", err);
      useUIStore.getState().addToast(parseApiError(err), "error");
      return [];
    }
  },

  fetchUrlContent: async (url) => {
    try {
      const raw = await invoke<string>("fetch_url_content", { url });
      return JSON.parse(raw) as UrlContent;
    } catch (err) {
      logError("Fetch URL failed", err);
      return { url, title: "", content: `Error: ${parseApiError(err)}`, status: "error", error: parseApiError(err) };
    }
  },
}));
