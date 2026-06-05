import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { SearchApiConfig, SearchResult, UrlContent } from "../types";
import { saveSearchConfigs, saveSearchApiKeys } from "../utils/storage";
import { logError, logWarn, logInfo } from "../utils/logger";
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
      logWarn("search", `Search config validation failed: ${firstError}`, {
        action: "Fix the search provider configuration in Settings > Search.",
      });
      useUIStore.getState().addToast(`Validation: ${firstError}`, "error");
      return;
    }
    const { searchConfigs } = get();
    const updated = [...searchConfigs, newConfig];
    set({ searchConfigs: updated, activeSearchId: newConfig.id });
    saveSearchConfigs(updated.map(({ apiKey: _apiKey, ...rest }) => rest as SearchApiConfig));
    logInfo("search", `Search API added: "${newConfig.name}" (${newConfig.provider})`, {
      details: `Provider: ${newConfig.provider}, Base URL: ${newConfig.baseUrl}`,
    });
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

    const updatedConfig = updatedConfigs.find((c) => c.id === id);
    if (updatedConfig && Object.keys(updates).length > 0) {
      logInfo("search", `Search config updated: "${updatedConfig.name}"`, {
        details: `Updated fields: ${Object.keys(updates).join(", ")}`,
      });
    }

    if (!updatedConfigs.find((c) => c.id === get().activeSearchId) && updatedConfigs.length > 0) {
      set({ activeSearchId: updatedConfigs[0].id });
    }
  },

  deleteSearchConfig: (id) => {
    const { searchConfigs, activeSearchId, searchApiKeys } = get();
    const config = searchConfigs.find((c) => c.id === id);
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
    logInfo("search", `Search API deleted: "${config?.name ?? id}"`, {});
    useUIStore.getState().addToast("Search API deleted", "info");
  },

  setActiveSearchId: (id) => set({ activeSearchId: id }),
  toggleSearchEnabled: (enabled) => set({ isSearchEnabled: enabled }),

  performSearch: async (query, config, apiKey) => {
    try {
      logInfo("search", `Searching: "${query}"`, {
        details: `Provider: ${config.provider}, Config: "${config.name}"`,
      });
      const configPayload = { ...config, apiKey };
      const raw = await invoke<string>("web_search", {
        provider: config.provider,
        query,
        config: JSON.stringify(configPayload),
        configId: config.id,
      });
      const results = JSON.parse(raw) as SearchResult[];
      logInfo("search", `Search completed: "${query}"`, {
        details: `${results.length} result(s) from ${config.provider}`,
      });
      return results;
    } catch (err) {
      const parsed = parseApiError(err);
      logError("search", `Search failed for "${query}"`, {
        error: err,
        action: parsed.action,
        details: `Provider: ${config.provider}, Config: "${config.name}". ${parsed.message}`,
      });
      useUIStore.getState().addToast(parsed.message, "error");
      return [];
    }
  },

  fetchUrlContent: async (url) => {
    try {
      logInfo("search", `Fetching URL: ${url}`, {});
      const raw = await invoke<string>("fetch_url_content", { url });
      const content = JSON.parse(raw) as UrlContent;
      if (content.status === "error") {
        logWarn("search", `Fetch URL returned error: ${url}`, {
          details: content.error || "Unknown error",
          action: "Check that the URL is valid and publicly accessible.",
        });
      } else {
        logInfo("search", `Fetched URL successfully: ${url}`, {
          details: `Title: ${content.title || "(none)"}`,
        });
      }
      return content;
    } catch (err) {
      const parsed = parseApiError(err);
      logError("search", `Fetch URL failed: ${url}`, {
        error: err,
        action: parsed.action,
        details: parsed.message,
      });
      return { url, title: "", content: `Error: ${parsed.message}`, status: "error", error: parsed.message };
    }
  },
}));
