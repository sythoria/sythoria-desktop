import { z } from "zod";
import { invoke } from "@tauri-apps/api/core";
import { Store } from "@tauri-apps/plugin-store";
import type { Conversation, TitleGenerationConfig, ModelConfig } from "../types";
import { DEFAULT_TITLE_SYSTEM_PROMPT } from "../types";
import { logError, logInfo, logWarn } from "./logger";

const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()),
});

const ToolCallResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  content: z.string(),
});

const SourceSchema = z.object({
  title: z.string(),
  url: z.string(),
});

const AttachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  mimeType: z.string(),
  size: z.number(),
  kind: z.enum(["image", "text"]),
  dataUrl: z.string().optional(),
  textContent: z.string().optional(),
});

const MessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant", "tool"]),
  content: z.string(),
  timestamp: z.coerce.date(),
  isStreaming: z.boolean().optional(),
  toolCall: ToolCallSchema.optional(),
  toolResult: ToolCallResultSchema.optional(),
  sources: z.array(SourceSchema).optional(),
  attachments: z.array(AttachmentSchema).optional(),
});

const ConversationSchema = z.object({
  id: z.string(),
  title: z.string().default("Untitled"),
  timestamp: z.coerce.date(),
  messages: z.array(MessageSchema),
  model: z.string().default(""),
});

const ThemeSchema = z.enum(["light", "dark"]);

const ApiKeysSchema = z.record(z.string(), z.string());

const SearchConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.enum(["google", "searxng", "firecrawl", "custom"]),
  baseUrl: z.string(),
  apiKey: z.string().optional(),
  cx: z.string().optional(),
  maxResults: z.number(),
  enabled: z.boolean(),
});

const SearchConfigsArraySchema = z.array(SearchConfigSchema);

const CONVERSATIONS_KEY = "sythoria-conversations";
const THEME_KEY = "sythoria-theme";
const API_KEYS_KEY = "sythoria-api-keys";
const SEARCH_CONFIGS_KEY = "sythoria-search-configs";
const SEARCH_API_KEYS_KEY = "sythoria-search-api-keys";
const TITLE_CONFIG_KEY = "sythoria-title-config";
const MCP_CONFIGS_KEY = "sythoria-mcp-configs";
const HAS_STARTED_KEY = "sythoria-has-started";
const STORE_FILE = "sythoria-store.json";

let storeInstance: Store | null = null;

async function getStore(): Promise<Store> {
  if (!storeInstance) {
    storeInstance = await Store.load(STORE_FILE);
  }
  return storeInstance;
}

function parseConversations(raw: unknown): Conversation[] {
  if (!Array.isArray(raw)) {
    logWarn("storage", "Stored conversations failed validation: expected array, resetting", {
      action: "This is usually caused by corrupted data. Your conversations will start fresh.",
    });
    return [];
  }
  const valid: Conversation[] = [];
  for (const item of raw) {
    const result = ConversationSchema.safeParse(item);
    if (result.success) {
      valid.push(result.data as Conversation);
    } else {
      logWarn("storage", "Skipping invalid conversation", {
        details: result.error.message,
        action: "One conversation had invalid data and was skipped. The rest are intact.",
      });
    }
  }
  return valid;
}

export async function loadConversations(): Promise<Conversation[]> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(CONVERSATIONS_KEY);
    if (raw) return parseConversations(raw);
  } catch (e) {
    logError("storage", "Failed to load conversations from secure store", {
      error: e,
      action: "Falling back to localStorage. If conversations are missing, try restarting the app.",
    });
    const fallback = localStorage.getItem(CONVERSATIONS_KEY);
    if (fallback) {
      try {
        return parseConversations(JSON.parse(fallback));
      } catch (e2) {
        logError("storage", "Failed to parse conversations from localStorage", {
          error: e2,
          action: "Conversations data may be corrupted. Try clearing app data.",
        });
      }
    }
  }
  return [];
}

export async function saveConversations(conversations: Conversation[]): Promise<void> {
  try {
    const store = await getStore();
    await store.set(CONVERSATIONS_KEY, conversations);
  } catch (e) {
    logError("storage", "Failed to save conversations to secure store", {
      error: e,
      action: "Falling back to localStorage. Data may not persist across sessions.",
    });
    try {
      localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(conversations));
    } catch (e2) {
      logError("storage", "Failed to save conversations to localStorage", {
        error: e2,
        action: "Storage is full or unavailable. Try clearing old conversations.",
      });
    }
  }
}

export async function loadTheme(): Promise<"light" | "dark"> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(THEME_KEY);
    const result = ThemeSchema.safeParse(raw);
    if (result.success) return result.data;
  } catch (e) {
    logError("storage", "Failed to load theme from secure store", {
      error: e,
      action: "Using system theme preference as fallback.",
    });
  }
  const fallback = localStorage.getItem(THEME_KEY);
  const result = ThemeSchema.safeParse(fallback);
  if (result.success) return result.data;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export async function saveTheme(theme: "light" | "dark"): Promise<void> {
  try {
    const store = await getStore();
    await store.set(THEME_KEY, theme);
  } catch (e) {
    logError("storage", "Failed to save theme to secure store", {
      error: e,
      action: "Theme may not persist across sessions. Try restarting the app.",
    });
    localStorage.setItem(THEME_KEY, theme);
  }
}

export async function loadApiKeys(): Promise<Record<string, string>> {
  try {
    const raw = await invoke<unknown>("load_api_keys");
    const result = ApiKeysSchema.safeParse(raw);
    if (result.success && Object.keys(result.data).length > 0) return result.data;
  } catch (e) {
    logError("storage", "Failed to load API keys from keychain", {
      error: e,
      action: "Check that the app has keychain access. You may need to re-enter your API keys in Settings > Models.",
    });
  }

  try {
    const store = await getStore();
    const legacyRaw = await store.get<unknown>(API_KEYS_KEY);
    const legacy = ApiKeysSchema.safeParse(legacyRaw);
    if (legacy.success && Object.keys(legacy.data).length > 0) {
      await saveApiKeys(legacy.data);
      await store.delete(API_KEYS_KEY);
      return legacy.data;
    }
    if (legacyRaw) {
      if (!legacy.success)
        logWarn("storage", "Stored API keys failed validation, resetting", {
          details: legacy.error?.message,
          action: "API keys were corrupted. Please re-enter them in Settings > Models.",
        });
      await store.delete(API_KEYS_KEY);
    }
  } catch (e) {
    logError("storage", "Failed to migrate legacy API keys", {
      error: e,
      action: "Could not migrate old API keys from store. Re-enter them in Settings > Models.",
    });
  }
  return {};
}

export async function saveApiKeys(keys: Record<string, string>): Promise<void> {
  try {
    await invoke("save_api_keys_cmd", { keys });
  } catch (e) {
    logError("storage", "Failed to save API keys to keychain", {
      error: e,
      action: "API keys may not persist. Try re-entering them in Settings > Models.",
    });
  }
}

export async function loadSearchConfigs(): Promise<import("../types").SearchApiConfig[] | null> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(SEARCH_CONFIGS_KEY);
    if (raw) {
      const result = SearchConfigsArraySchema.safeParse(raw);
      if (result.success) return result.data as import("../types").SearchApiConfig[];
      logWarn("storage", "Stored search configs failed validation", {
        details: result.error?.message,
        action: "Search provider configs were corrupted. Please re-configure them in Settings > Search.",
      });
    }
  } catch (e) {
    logError("storage", "Failed to load search configs from secure store", {
      error: e,
      action: "Search configuration could not be loaded. Re-configure in Settings > Search.",
    });
  }
  return null;
}

export async function saveSearchConfigs(configs: import("../types").SearchApiConfig[]): Promise<void> {
  try {
    const store = await getStore();
    await store.set(SEARCH_CONFIGS_KEY, configs);
  } catch (e) {
    logError("storage", "Failed to save search configs to secure store", {
      error: e,
      action: "Search configuration may not persist. Try re-entering in Settings > Search.",
    });
  }
}

export async function clearConversations(): Promise<void> {
  try {
    const store = await getStore();
    await store.delete(CONVERSATIONS_KEY);
  } catch (e) {
    logError("storage", "Failed to clear conversations from secure store", {
      error: e,
      action: "Conversations may still be stored. Try restarting and clearing again.",
    });
  }
  localStorage.removeItem(CONVERSATIONS_KEY);
}

export async function loadSearchApiKeys(): Promise<Record<string, string>> {
  try {
    const raw = await invoke<unknown>("load_search_api_keys");
    const result = ApiKeysSchema.safeParse(raw);
    if (result.success && Object.keys(result.data).length > 0) return result.data;
  } catch (e) {
    logError("storage", "Failed to load search API keys from keychain", {
      error: e,
      action: "Re-enter your search API keys in Settings > Search.",
    });
  }

  try {
    const store = await getStore();
    const legacyRaw = await store.get<unknown>(SEARCH_API_KEYS_KEY);
    const legacy = ApiKeysSchema.safeParse(legacyRaw);
    if (legacy.success && Object.keys(legacy.data).length > 0) {
      await saveSearchApiKeys(legacy.data);
      await store.delete(SEARCH_API_KEYS_KEY);
      return legacy.data;
    }
    if (legacyRaw) {
      if (!legacy.success)
        logWarn("storage", "Stored search API keys failed validation, resetting", {
          details: legacy.error?.message,
          action: "Search API keys were corrupted. Please re-enter them in Settings > Search.",
        });
      await store.delete(SEARCH_API_KEYS_KEY);
    }
  } catch (e) {
    logError("storage", "Failed to migrate legacy search API keys", {
      error: e,
      action: "Could not migrate old search API keys. Re-enter them in Settings > Search.",
    });
  }
  return {};
}

export async function saveSearchApiKeys(keys: Record<string, string>): Promise<void> {
  try {
    await invoke("save_search_api_keys_cmd", { keys });
  } catch (e) {
    logError("storage", "Failed to save search API keys to keychain", {
      error: e,
      action: "Search API keys may not persist. Re-enter them in Settings > Search.",
    });
  }
}

const TitleConfigSchema = z.object({
  enabled: z.boolean().default(true),
  modelId: z.string().default("__same__"),
  systemPrompt: z.string().default(DEFAULT_TITLE_SYSTEM_PROMPT),
});

const DEFAULT_TITLE_CONFIG: TitleGenerationConfig = {
  enabled: true,
  modelId: "__same__",
  systemPrompt: DEFAULT_TITLE_SYSTEM_PROMPT,
};

export async function loadTitleConfig(): Promise<TitleGenerationConfig> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(TITLE_CONFIG_KEY);
    if (raw) {
      const result = TitleConfigSchema.safeParse(raw);
      if (result.success) return { ...DEFAULT_TITLE_CONFIG, ...result.data };
      logWarn("storage", "Stored title config failed validation, resetting", {
        details: result.error?.message,
        action: "Title generation settings were reset to defaults. Re-configure in Settings.",
      });
    }
  } catch (e) {
    logError("storage", "Failed to load title config from secure store", {
      error: e,
      action: "Using default title generation settings.",
    });
  }
  return { ...DEFAULT_TITLE_CONFIG };
}

export async function saveTitleConfig(config: TitleGenerationConfig): Promise<void> {
  try {
    const store = await getStore();
    await store.set(TITLE_CONFIG_KEY, config);
  } catch (e) {
    logError("storage", "Failed to save title config to secure store", {
      error: e,
      action: "Title generation settings may not persist.",
    });
  }
}

export async function loadHasStarted(): Promise<boolean> {
  try {
    const store = await getStore();
    const raw = await store.get<boolean>(HAS_STARTED_KEY);
    if (raw === true) return true;
  } catch (e) {
    logError("storage", "Failed to load hasStarted from store", { error: e });
  }
  return false;
}

export async function saveHasStarted(started: boolean): Promise<void> {
  try {
    const store = await getStore();
    await store.set(HAS_STARTED_KEY, started);
  } catch (e) {
    logError("storage", "Failed to save hasStarted to store", { error: e });
  }
}

const McpServerConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  transport: z.enum(["stdio", "sse", "streamable-http"]),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  enabled: z.boolean(),
});

const McpConfigsArraySchema = z.array(McpServerConfigSchema);

/**
 * Migrates legacy stdio MCP configs to the program-only `command` + `args[]`
 * format. Older versions stored the entire command line in `command` (e.g.
 * `"npx -y @modelcontextprotocol/server-filesystem"`); the new contract keeps
 * the executable in `command` and every argument in `args`.
 *
 * Idempotent: configs whose `command` is already a single token are returned
 * unchanged. Only stdio configs with a multi-token `command` are rewritten.
 */
export function migrateMcpConfigs(configs: import("../types").McpServerConfig[]): import("../types").McpServerConfig[] {
  return configs.map((c) => {
    if (c.transport !== "stdio") return c;
    const raw = (c.command ?? "").trim();
    if (!raw) return c;

    // Single token — already in the new format (or a bare executable name).
    const tokens = raw.split(/\s+/);
    if (tokens.length <= 1) return c;

    const [program, ...commandArgs] = tokens;
    const existingArgs = c.args ?? [];
    // Merge the args extracted from the command line with any explicitly-set
    // args. Drop duplicate `-y`/`--yes` that the old npx heuristic auto-added.
    const merged = [...commandArgs, ...existingArgs];
    const dedupedYes = dedupAutoYes(merged);

    return { ...c, command: program, args: dedupedYes };
  });
}

/** Keeps the first `-y`/`--yes` and drops subsequent duplicates. */
function dedupAutoYes(args: string[]): string[] {
  let seenYes = false;
  return args.filter((a) => {
    if (a === "-y" || a === "--yes") {
      if (seenYes) return false;
      seenYes = true;
    }
    return true;
  });
}

export async function loadMcpConfigs(): Promise<import("../types").McpServerConfig[] | null> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(MCP_CONFIGS_KEY);
    if (raw) {
      const result = McpConfigsArraySchema.safeParse(raw);
      if (result.success) {
        const migrated = migrateMcpConfigs(result.data as import("../types").McpServerConfig[]);
        // Persist the migrated form so subsequent loads are clean.
        if (JSON.stringify(migrated) !== JSON.stringify(result.data)) {
          await store.set(MCP_CONFIGS_KEY, migrated);
          logInfo("storage", "Migrated MCP configs to program + args format", {
            details: `${migrated.length} server(s) processed`,
          });
        }
        return migrated;
      }
      logWarn("storage", "Stored MCP configs failed validation", {
        details: result.error?.message,
        action: "MCP server configs were corrupted. Re-configure in Settings > MCP Servers.",
      });
    }
  } catch (e) {
    logError("storage", "Failed to load MCP configs from secure store", {
      error: e,
      action: "MCP server configuration could not be loaded. Re-configure in Settings > MCP Servers.",
    });
  }
  return null;
}

export async function saveMcpConfigs(configs: import("../types").McpServerConfig[]): Promise<void> {
  try {
    const store = await getStore();
    await store.set(MCP_CONFIGS_KEY, configs);
  } catch (e) {
    logError("storage", "Failed to save MCP configs to secure store", {
      error: e,
      action: "MCP server config may not persist. Re-configure in Settings > MCP Servers.",
    });
  }
}

export async function loadMcpEnvSecrets(): Promise<Record<string, Record<string, string>>> {
  try {
    const raw = await invoke<unknown>("load_mcp_env_secrets");
    const result = z.record(z.string(), z.record(z.string(), z.string())).safeParse(raw);
    if (result.success && Object.keys(result.data).length > 0) return result.data;
  } catch (e) {
    logError("storage", "Failed to load MCP env secrets from keychain", {
      error: e,
      action: "MCP environment secrets could not be loaded. Re-enter them in Settings > MCP Servers.",
    });
  }
  return {};
}

export async function saveMcpEnvSecrets(secrets: Record<string, Record<string, string>>): Promise<void> {
  try {
    await invoke("save_mcp_env_secrets_cmd", { secrets });
  } catch (e) {
    logError("storage", "Failed to save MCP env secrets to keychain", {
      error: e,
      action: "MCP environment secrets may not persist. Re-enter them in Settings > MCP Servers.",
    });
  }
}

export async function loadModelConfigs(): Promise<ModelConfig[] | null> {
  try {
    const raw = await invoke<string>("load_config");
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed as ModelConfig[];
      }
    }
  } catch (e) {
    logError("storage", "Failed to load config from system", {
      error: e,
      action: "Model configuration could not be loaded. Re-configure in Settings > Models.",
    });
  }
  return null;
}

export async function saveModelConfigs(configs: ModelConfig[]) {
  try {
    await invoke("save_config", { config: JSON.stringify(configs) });
  } catch (e) {
    logError("storage", "Failed to save config to system", {
      error: e,
      action: "Model configuration may not persist. Re-enter in Settings > Models.",
    });
  }
}
