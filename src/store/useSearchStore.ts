import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { SearchApiConfig, FetchApiConfig, SearchResult, UrlContent } from "../types";
import { saveSearchConfigs, saveFetchConfigs, saveSearchApiKeys } from "../utils/storage";
import { logError, logWarn, logInfo } from "../utils/logger";
import { parseApiError } from "../utils/parseApiError";
import { validateSearchConfig, validateFetchConfig } from "../utils/validation";
import { useUIStore } from "./useUIStore";
import { debounce } from "../utils/debounce";

const debouncedSaveSearchConfigs = debounce((configs: SearchApiConfig[]) => {
  saveSearchConfigs(configs);
}, 500);

const debouncedSaveSearchApiKeys = debounce((keys: Record<string, string>) => {
  saveSearchApiKeys(keys);
}, 500);

const debouncedSaveFetchConfigs = debounce((configs: FetchApiConfig[]) => {
  saveFetchConfigs(configs);
}, 500);

const debouncedLogSearchUpdate = debounce((name: string, fields: string[]) => {
  logInfo("search", `Search config updated: "${name}"`, {
    details: `Updated fields: ${fields.join(", ")}`,
  });
}, 500);

interface SearchState {
  searchConfigs: SearchApiConfig[];
  activeSearchId: string | null;
  isSearchEnabled: boolean;
  searchApiKeys: Record<string, string>;

  fetchConfigs: FetchApiConfig[];
  activeFetchId: string | null;

  addSearchConfig: () => void;
  updateSearchConfig: (id: string, updates: Partial<SearchApiConfig>) => void;
  deleteSearchConfig: (id: string) => void;
  setActiveSearchId: (id: string | null) => void;
  toggleSearchEnabled: (enabled: boolean) => void;

  addFetchConfig: () => void;
  updateFetchConfig: (id: string, updates: Partial<FetchApiConfig>) => void;
  deleteFetchConfig: (id: string) => void;
  setActiveFetchId: (id: string | null) => void;

  performSearch: (query: string, config: SearchApiConfig, apiKey: string) => Promise<SearchResult[]>;
  fetchUrlContent: (url: string, format?: string) => Promise<UrlContent>;
}

export const useSearchStore = create<SearchState>((set, get) => ({
  searchConfigs: [],
  activeSearchId: null,
  isSearchEnabled: false,
  searchApiKeys: {},
  fetchConfigs: [],
  activeFetchId: null,

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
    debouncedSaveSearchConfigs.cancel();
    saveSearchConfigs(updated.map(({ apiKey: _apiKey, ...rest }) => rest as SearchApiConfig));
    logInfo("search", `Search API added: "${newConfig.name}" (${newConfig.provider})`, {
      details: `Provider: ${newConfig.provider}, Base URL: ${newConfig.baseUrl}`,
    });
    useUIStore.getState().addToast("Search API added — configure its details", "info");
  },

  updateSearchConfig: (id, updates) => {
    const { searchConfigs, searchApiKeys } = get();
    const updatedConfigs = searchConfigs.map((c) => (c.id === id ? { ...c, ...updates } : c));
    const enabledConfigs = updatedConfigs.filter((config) => config.enabled);
    const currentActiveId = get().activeSearchId;
    const activeSearchId = enabledConfigs.some((config) => config.id === currentActiveId)
      ? currentActiveId
      : (enabledConfigs[0]?.id ?? null);
    set({
      searchConfigs: updatedConfigs,
      activeSearchId,
      isSearchEnabled: enabledConfigs.length > 0 ? get().isSearchEnabled : false,
    });

    if (updates.apiKey !== undefined) {
      const newKeys = { ...searchApiKeys, [id]: updates.apiKey! };
      set({ searchApiKeys: newKeys });
      debouncedSaveSearchApiKeys(newKeys);
    }

    const configsWithoutKeys = updatedConfigs.map(({ apiKey: _apiKey, ...rest }) => rest as SearchApiConfig);
    debouncedSaveSearchConfigs(configsWithoutKeys);

    const updatedConfig = updatedConfigs.find((c) => c.id === id);
    if (updatedConfig && Object.keys(updates).length > 0) {
      debouncedLogSearchUpdate(updatedConfig.name, Object.keys(updates));
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
      activeSearchId: activeSearchId === id ? (updated.find((config) => config.enabled)?.id ?? null) : activeSearchId,
      searchApiKeys: newKeys,
      isSearchEnabled: updated.some((config) => config.enabled) ? get().isSearchEnabled : false,
    });
    debouncedSaveSearchConfigs.cancel();
    debouncedSaveSearchApiKeys.cancel();
    saveSearchConfigs(updated.map(({ apiKey: _apiKey, ...rest }) => rest as SearchApiConfig));
    saveSearchApiKeys(newKeys);
    logInfo("search", `Search API deleted: "${config?.name ?? id}"`, {});
    useUIStore.getState().addToast("Search API deleted", "info");
  },

  setActiveSearchId: (id) =>
    set({ activeSearchId: id && get().searchConfigs.some((config) => config.id === id && config.enabled) ? id : null }),
  toggleSearchEnabled: (enabled) =>
    set({
      isSearchEnabled: enabled && get().activeSearchId !== null && get().searchConfigs.some((config) => config.enabled),
    }),

  performSearch: async (query, config, _apiKey) => {
    const currentConfig = get().searchConfigs.find((candidate) => candidate.id === config.id);
    if (!currentConfig?.enabled || get().activeSearchId !== config.id || !get().isSearchEnabled) {
      logWarn("search", `Blocked search through disabled config: "${config.name}"`, {});
      return [];
    }
    try {
      logInfo("search", `Searching: "${query}"`, {
        details: `Provider: ${config.provider}, Config: "${config.name}"`,
      });
      const configPayload = { ...config, apiKey: undefined };
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

  addFetchConfig: () => {
    const newConfig: FetchApiConfig = {
      id: "fetch-" + Date.now(),
      name: "New Fetch API",
      provider: "firecrawl",
      baseUrl: "",
      apiKey: "",
      enabled: true,
    };
    const validation = validateFetchConfig(newConfig);
    if (!validation.success) {
      const firstError = validation.error.issues[0]?.message ?? "Invalid fetch config";
      logWarn("search", `Fetch config validation failed: ${firstError}`, {
        action: "Fix the fetch provider configuration in Settings > Web Search.",
      });
      useUIStore.getState().addToast(`Validation: ${firstError}`, "error");
      return;
    }
    const { fetchConfigs } = get();
    const updated = [...fetchConfigs, newConfig];
    set({ fetchConfigs: updated, activeFetchId: newConfig.id });
    debouncedSaveFetchConfigs.cancel();
    saveFetchConfigs(updated.map(({ apiKey: _apiKey, ...rest }) => rest as FetchApiConfig));
    logInfo("search", `Fetch API added: "${newConfig.name}" (${newConfig.provider})`, {});
    useUIStore.getState().addToast("Fetch API added — configure its details", "info");
  },

  updateFetchConfig: (id, updates) => {
    const { fetchConfigs, searchApiKeys } = get();
    const updatedConfigs = fetchConfigs.map((c) => (c.id === id ? { ...c, ...updates } : c));
    const enabledConfigs = updatedConfigs.filter((config) => config.enabled);
    const currentActiveId = get().activeFetchId;
    set({
      fetchConfigs: updatedConfigs,
      activeFetchId: enabledConfigs.some((config) => config.id === currentActiveId)
        ? currentActiveId
        : (enabledConfigs[0]?.id ?? null),
    });

    if (updates.apiKey !== undefined) {
      const newKeys = { ...searchApiKeys, [id]: updates.apiKey! };
      set({ searchApiKeys: newKeys });
      debouncedSaveSearchApiKeys(newKeys);
    }

    const configsWithoutKeys = updatedConfigs.map(({ apiKey: _apiKey, ...rest }) => rest as FetchApiConfig);
    debouncedSaveFetchConfigs(configsWithoutKeys);
  },

  deleteFetchConfig: (id) => {
    const { fetchConfigs, activeFetchId, searchApiKeys } = get();
    const config = fetchConfigs.find((c) => c.id === id);
    const updated = fetchConfigs.filter((c) => c.id !== id);
    const newKeys = { ...searchApiKeys };
    delete newKeys[id];
    set({
      fetchConfigs: updated,
      activeFetchId: activeFetchId === id ? (updated.find((config) => config.enabled)?.id ?? null) : activeFetchId,
      searchApiKeys: newKeys,
    });
    debouncedSaveFetchConfigs.cancel();
    debouncedSaveSearchApiKeys.cancel();
    saveFetchConfigs(updated.map(({ apiKey: _apiKey, ...rest }) => rest as FetchApiConfig));
    saveSearchApiKeys(newKeys);
    logInfo("search", `Fetch API deleted: "${config?.name ?? id}"`, {});
    useUIStore.getState().addToast("Fetch API deleted", "info");
  },

  setActiveFetchId: (id) =>
    set({ activeFetchId: id && get().fetchConfigs.some((config) => config.id === id && config.enabled) ? id : null }),

  fetchUrlContent: async (url, format) => {
    try {
      logInfo("search", `Fetching URL: ${url}`, {
        details: format ? `Format: ${format}` : undefined,
      });

      const { fetchConfigs, activeFetchId } = get();

      const activeConfig = activeFetchId ? fetchConfigs.find((c) => c.id === activeFetchId && c.enabled) : null;

      let provider: string | undefined;
      let configPayload: string | undefined;
      let configId: string | undefined;

      if (activeConfig) {
        provider = activeConfig.provider;
        configId = activeConfig.id;
        configPayload = JSON.stringify({ baseUrl: activeConfig.baseUrl });
      }

      const raw = await invoke<string>("fetch_url_content", {
        url,
        provider,
        config: configPayload,
        configId,
        format,
      });

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
