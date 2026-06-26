import { z } from "zod";
import { invoke } from "@tauri-apps/api/core";
import { Store } from "@tauri-apps/plugin-store";
import type { Conversation, TitleGenerationConfig, ModelConfig, Project, ProjectPermission } from "../types";
import { DEFAULT_TITLE_SYSTEM_PROMPT } from "../types";
import { logError, logInfo, logWarn } from "./logger";
import { ThemeConfig, DEFAULT_THEME_CONFIG } from "../config/themePresets";
import { DEFAULT_MAX_TOOL_STEPS } from "../config/constants";

const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  permissions: z.enum(["read", "write", "full"]),
  excludePatterns: z.array(z.string()).optional(),
  systemPromptOverride: z.string().optional(),
  modelOverride: z.string().optional(),
  isAutoCommitEnabled: z.boolean().optional(),
  autoCommitMsgTemplate: z.string().optional(),
});

const ProjectsArraySchema = z.array(ProjectSchema);

const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()),
});

const McpImageContentSchema = z.object({
  mimeType: z.string(),
  data: z.string(),
});

const ToolCallResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  content: z.string(),
  images: z.array(McpImageContentSchema).optional(),
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
  projectId: z.string().optional(),
});

const CustomThemeConfigSchema = z.object({
  preset: z.string(),
  background: z.string(),
  foreground: z.string(),
  accent: z.string(),
});

const ThemeConfigSchema = z.object({
  mode: z.enum(["light", "dark", "system"]),
  lightTheme: CustomThemeConfigSchema,
  darkTheme: CustomThemeConfigSchema,
});

export const DownloadedThemesSchema = z.object({
  light: z.record(z.string(), CustomThemeConfigSchema),
  dark: z.record(z.string(), CustomThemeConfigSchema),
});

export type DownloadedThemes = z.infer<typeof DownloadedThemesSchema>;

const ThemeSchema = z.union([z.enum(["light", "dark", "system"]), ThemeConfigSchema]);

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

const KeybindActionSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  defaultCombo: z.string(),
  currentCombo: z.string(),
});

export const KeybindsSchema = z.record(z.string(), KeybindActionSchema);
export type KeybindsData = z.infer<typeof KeybindsSchema>;

const CONVERSATIONS_KEY = "sythoria-conversations";
const PROJECTS_KEY = "sythoria-projects";
const PROJECTS_ENABLED_KEY = "sythoria-projects-enabled";
const PROJECTS_DEFAULT_PERMISSION_KEY = "sythoria-projects-default-permission";
const THEME_KEY = "sythoria-theme";
const API_KEYS_KEY = "sythoria-api-keys";
const SEARCH_CONFIGS_KEY = "sythoria-search-configs";
const SEARCH_API_KEYS_KEY = "sythoria-search-api-keys";
const TITLE_CONFIG_KEY = "sythoria-title-config";
const MCP_CONFIGS_KEY = "sythoria-mcp-configs";
const MCP_ENABLED_SERVERS_KEY = "sythoria-enabled-mcp-chat-servers";
const GIT_CONFIG_KEY = "sythoria-git-config";
const APPSHOT_CONFIG_KEY = "sythoria-appshots-config";
const HAS_STARTED_KEY = "sythoria-has-started";
const ANIMATIONS_DISABLED_KEY = "sythoria-animations-disabled";
const DOWNLOADED_THEMES_KEY = "sythoria-downloaded-themes";
const KEYBINDS_KEY = "sythoria-keybinds";
const ZOOM_LEVEL_KEY = "sythoria-zoom-level";
const ALWAYS_ON_TOP_KEY = "sythoria-always-on-top";
const CLOSE_TO_TRAY_KEY = "sythoria-close-to-tray";
const LAUNCH_ON_STARTUP_KEY = "sythoria-launch-on-startup";
const SEND_MESSAGE_SHORTCUT_KEY = "sythoria-send-message-shortcut";
const CLEAR_INPUT_ON_ESCAPE_KEY = "sythoria-clear-input-on-escape";
const BASE_TEXT_SIZE_KEY = "sythoria-base-text-size";
const AUTO_UPDATE_CHECKING_KEY = "sythoria-auto-update-checking";
const SYSTEM_PROMPT_KEY = "sythoria-system-prompt";
const SHOW_CONTEXT_WINDOW_KEY = "sythoria-show-context-window";
const MAX_TOOL_STEPS_KEY = "sythoria-max-tool-steps";
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
    await store.save();
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

export async function loadProjects(): Promise<Project[]> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(PROJECTS_KEY);
    if (raw) {
      const result = ProjectsArraySchema.safeParse(raw);
      if (result.success) return result.data as Project[];
    }
  } catch (e) {
    logError("storage", "Failed to load projects", { error: e });
  }
  return [];
}

export async function saveProjects(projects: Project[]): Promise<void> {
  try {
    const store = await getStore();
    await store.set(PROJECTS_KEY, projects);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save projects", { error: e });
  }
}

export async function loadTheme(): Promise<ThemeConfig> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(THEME_KEY);
    const result = ThemeSchema.safeParse(raw);
    if (result.success) {
      const data = result.data;
      if (typeof data === "string") {
        return {
          ...DEFAULT_THEME_CONFIG,
          mode: data as "light" | "dark" | "system",
        };
      }
      return data;
    }
  } catch (e) {
    logError("storage", "Failed to load theme from secure store", {
      error: e,
      action: "Using system theme preference as fallback.",
    });
  }
  const fallback = localStorage.getItem(THEME_KEY);
  let parsedFallback: unknown = fallback;
  if (fallback && (fallback.startsWith("{") || fallback.startsWith("["))) {
    try {
      parsedFallback = JSON.parse(fallback);
    } catch {
      // ignore
    }
  }
  const result = ThemeSchema.safeParse(parsedFallback);
  if (result.success) {
    const data = result.data;
    if (typeof data === "string") {
      return {
        ...DEFAULT_THEME_CONFIG,
        mode: data as "light" | "dark" | "system",
      };
    }
    return data;
  }
  return DEFAULT_THEME_CONFIG;
}

export async function saveTheme(theme: ThemeConfig): Promise<void> {
  try {
    const store = await getStore();
    await store.set(THEME_KEY, theme);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save theme to secure store", {
      error: e,
      action: "Theme may not persist across sessions. Try restarting the app.",
    });
    localStorage.setItem(THEME_KEY, JSON.stringify(theme));
  }
}

export async function loadDownloadedThemes(): Promise<DownloadedThemes> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(DOWNLOADED_THEMES_KEY);
    const result = DownloadedThemesSchema.safeParse(raw);
    if (result.success) return result.data;
  } catch (e) {
    logError("storage", "Failed to load downloaded themes from secure store", { error: e });
  }
  const fallback = localStorage.getItem(DOWNLOADED_THEMES_KEY);
  if (fallback) {
    try {
      const parsed = JSON.parse(fallback);
      const result = DownloadedThemesSchema.safeParse(parsed);
      if (result.success) return result.data;
    } catch {
      // Ignore parsing errors and fall back to empty theme sets
    }
  }
  return { light: {}, dark: {} };
}

export async function saveDownloadedThemes(themes: DownloadedThemes): Promise<void> {
  try {
    const store = await getStore();
    await store.set(DOWNLOADED_THEMES_KEY, themes);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save downloaded themes to secure store", { error: e });
    localStorage.setItem(DOWNLOADED_THEMES_KEY, JSON.stringify(themes));
  }
}

export async function loadKeybinds(): Promise<KeybindsData | null> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(KEYBINDS_KEY);
    const result = KeybindsSchema.safeParse(raw);
    if (result.success) return result.data;
  } catch (e) {
    logError("storage", "Failed to load keybinds from secure store", { error: e });
  }
  const fallback = localStorage.getItem(KEYBINDS_KEY);
  if (fallback) {
    try {
      const parsed = JSON.parse(fallback);
      const result = KeybindsSchema.safeParse(parsed);
      if (result.success) return result.data;
    } catch {
      // Ignore parsing errors and fall back
    }
  }
  return null;
}

export async function saveKeybinds(keybinds: KeybindsData): Promise<void> {
  try {
    const store = await getStore();
    await store.set(KEYBINDS_KEY, keybinds);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save keybinds to secure store", { error: e });
    localStorage.setItem(KEYBINDS_KEY, JSON.stringify(keybinds));
  }
}

export async function loadZoomLevel(): Promise<number> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(ZOOM_LEVEL_KEY);
    if (typeof raw === "number") return raw;
  } catch (e) {
    logError("storage", "Failed to load zoom level from secure store", { error: e });
  }
  const fallback = localStorage.getItem(ZOOM_LEVEL_KEY);
  if (fallback) {
    const num = parseFloat(fallback);
    if (!isNaN(num)) return num;
  }
  return 1.0;
}

export async function saveZoomLevel(level: number): Promise<void> {
  try {
    const store = await getStore();
    await store.set(ZOOM_LEVEL_KEY, level);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save zoom level to secure store", { error: e });
    localStorage.setItem(ZOOM_LEVEL_KEY, level.toString());
  }
}

export function applyZoom(level: number) {
  if (typeof document === "undefined") return;
  (document.body.style as CSSStyleDeclaration & { zoom?: string }).zoom = level.toString();
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
    await store.save();
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
    await store.save();
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
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save hasStarted to store", { error: e });
  }
}

export async function loadAnimationsDisabled(): Promise<boolean> {
  try {
    const store = await getStore();
    const raw = await store.get<boolean>(ANIMATIONS_DISABLED_KEY);
    if (raw === true) return true;
  } catch (e) {
    logError("storage", "Failed to load animationsDisabled from store", { error: e });
  }
  return false;
}

export async function saveAnimationsDisabled(disabled: boolean): Promise<void> {
  try {
    const store = await getStore();
    await store.set(ANIMATIONS_DISABLED_KEY, disabled);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save animationsDisabled to store", { error: e });
  }
}

export interface GitConfig {
  repoPath: string;
  isAutoCommitEnabled: boolean;
  isAiCommitMsgEnabled: boolean;
  isPreCommitEnabled: boolean;
  overrideIdentity: boolean;
  gitName: string;
  gitEmail: string;
}

const GitConfigSchema = z.object({
  repoPath: z.string().default(""),
  isAutoCommitEnabled: z.boolean().default(false),
  isAiCommitMsgEnabled: z.boolean().default(true),
  isPreCommitEnabled: z.boolean().default(true),
  overrideIdentity: z.boolean().default(false),
  gitName: z.string().default("Sythoria AI"),
  gitEmail: z.string().default("assistant@sythoria.local"),
});

export interface AppshotConfig {
  enabled: boolean;
  captureFolder: string;
  hotkey: string;
  imageFormat: string;
  imageQuality: number;
  delaySeconds: number;
  autoCleanEnabled: boolean;
  autoCleanType: "count" | "size" | "age";
  autoCleanValue: number;
  includeCursor: boolean;
  hideWindowOnCapture: boolean;
  screenCapturePromptShown: boolean;
}

const AppshotConfigSchema = z.object({
  enabled: z.boolean().default(true),
  captureFolder: z.string().default(""),
  hotkey: z.string().default("Alt+Shift+S"),
  imageFormat: z.string().default("png"),
  imageQuality: z.number().default(85),
  delaySeconds: z.number().default(0),
  autoCleanEnabled: z.boolean().default(false),
  autoCleanType: z.enum(["count", "size", "age"]).default("count"),
  autoCleanValue: z.number().default(50),
  includeCursor: z.boolean().default(false),
  hideWindowOnCapture: z.boolean().default(true),
  screenCapturePromptShown: z.boolean().default(false),
});

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
          await store.save();
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
    await store.save();
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

export async function loadAlwaysOnTop(): Promise<boolean> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(ALWAYS_ON_TOP_KEY);
    if (typeof raw === "boolean") return raw;
  } catch (e) {
    logError("storage", "Failed to load always on top setting", { error: e });
  }
  const fallback = localStorage.getItem(ALWAYS_ON_TOP_KEY);
  if (fallback !== null) return fallback === "true";
  return false;
}

export async function saveAlwaysOnTop(value: boolean): Promise<void> {
  try {
    const store = await getStore();
    await store.set(ALWAYS_ON_TOP_KEY, value);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save always on top setting", { error: e });
  }
  localStorage.setItem(ALWAYS_ON_TOP_KEY, String(value));
}

export async function loadCloseToTray(): Promise<boolean> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(CLOSE_TO_TRAY_KEY);
    if (typeof raw === "boolean") return raw;
  } catch (e) {
    logError("storage", "Failed to load close to tray setting", { error: e });
  }
  const fallback = localStorage.getItem(CLOSE_TO_TRAY_KEY);
  if (fallback !== null) return fallback === "true";
  return false;
}

export async function saveCloseToTray(value: boolean): Promise<void> {
  try {
    const store = await getStore();
    await store.set(CLOSE_TO_TRAY_KEY, value);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save close to tray setting", { error: e });
  }
  localStorage.setItem(CLOSE_TO_TRAY_KEY, String(value));
}

export async function loadLaunchOnStartup(): Promise<boolean> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(LAUNCH_ON_STARTUP_KEY);
    if (typeof raw === "boolean") return raw;
  } catch (e) {
    logError("storage", "Failed to load launch on startup setting", { error: e });
  }
  const fallback = localStorage.getItem(LAUNCH_ON_STARTUP_KEY);
  if (fallback !== null) return fallback === "true";
  return false;
}

export async function saveLaunchOnStartup(value: boolean): Promise<void> {
  try {
    const store = await getStore();
    await store.set(LAUNCH_ON_STARTUP_KEY, value);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save launch on startup setting", { error: e });
  }
  localStorage.setItem(LAUNCH_ON_STARTUP_KEY, String(value));
}

export async function loadSendMessageShortcut(): Promise<"enter" | "ctrl-enter"> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(SEND_MESSAGE_SHORTCUT_KEY);
    if (raw === "enter" || raw === "ctrl-enter") return raw;
  } catch (e) {
    logError("storage", "Failed to load send message shortcut setting", { error: e });
  }
  const fallback = localStorage.getItem(SEND_MESSAGE_SHORTCUT_KEY);
  if (fallback === "enter" || fallback === "ctrl-enter") return fallback;
  return "enter";
}

export async function saveSendMessageShortcut(value: "enter" | "ctrl-enter"): Promise<void> {
  try {
    const store = await getStore();
    await store.set(SEND_MESSAGE_SHORTCUT_KEY, value);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save send message shortcut setting", { error: e });
  }
  localStorage.setItem(SEND_MESSAGE_SHORTCUT_KEY, value);
}

export async function loadClearInputOnEscape(): Promise<boolean> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(CLEAR_INPUT_ON_ESCAPE_KEY);
    if (typeof raw === "boolean") return raw;
  } catch (e) {
    logError("storage", "Failed to load clear input on escape setting", { error: e });
  }
  const fallback = localStorage.getItem(CLEAR_INPUT_ON_ESCAPE_KEY);
  if (fallback !== null) return fallback === "true";
  return false;
}

export async function saveClearInputOnEscape(value: boolean): Promise<void> {
  try {
    const store = await getStore();
    await store.set(CLEAR_INPUT_ON_ESCAPE_KEY, value);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save clear input on escape setting", { error: e });
  }
  localStorage.setItem(CLEAR_INPUT_ON_ESCAPE_KEY, String(value));
}

export async function loadBaseTextSize(): Promise<"small" | "medium" | "large" | "xlarge"> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(BASE_TEXT_SIZE_KEY);
    if (raw === "small" || raw === "medium" || raw === "large" || raw === "xlarge") return raw;
  } catch (e) {
    logError("storage", "Failed to load base text size setting", { error: e });
  }
  const fallback = localStorage.getItem(BASE_TEXT_SIZE_KEY);
  if (fallback === "small" || fallback === "medium" || fallback === "large" || fallback === "xlarge") return fallback;
  return "medium";
}

export async function saveBaseTextSize(value: "small" | "medium" | "large" | "xlarge"): Promise<void> {
  try {
    const store = await getStore();
    await store.set(BASE_TEXT_SIZE_KEY, value);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save base text size setting", { error: e });
  }
  localStorage.setItem(BASE_TEXT_SIZE_KEY, value);
}

export async function loadAutoUpdateChecking(): Promise<boolean> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(AUTO_UPDATE_CHECKING_KEY);
    if (typeof raw === "boolean") return raw;
  } catch (e) {
    logError("storage", "Failed to load auto update checking setting", { error: e });
  }
  const fallback = localStorage.getItem(AUTO_UPDATE_CHECKING_KEY);
  if (fallback !== null) return fallback === "true";
  return true;
}

export async function saveAutoUpdateChecking(value: boolean): Promise<void> {
  try {
    const store = await getStore();
    await store.set(AUTO_UPDATE_CHECKING_KEY, value);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save auto update checking setting", { error: e });
  }
  localStorage.setItem(AUTO_UPDATE_CHECKING_KEY, String(value));
}

export async function loadSystemPrompt(): Promise<string> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(SYSTEM_PROMPT_KEY);
    if (typeof raw === "string") return raw;
  } catch (e) {
    logError("storage", "Failed to load system prompt", { error: e });
  }
  const fallback = localStorage.getItem(SYSTEM_PROMPT_KEY);
  if (fallback !== null) return fallback;
  return "";
}

export async function saveSystemPrompt(value: string): Promise<void> {
  try {
    const store = await getStore();
    await store.set(SYSTEM_PROMPT_KEY, value);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save system prompt", { error: e });
  }
  localStorage.setItem(SYSTEM_PROMPT_KEY, value);
}

export async function loadShowContextWindow(): Promise<boolean> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(SHOW_CONTEXT_WINDOW_KEY);
    if (typeof raw === "boolean") return raw;
  } catch (e) {
    logError("storage", "Failed to load show context window setting", { error: e });
  }
  const fallback = localStorage.getItem(SHOW_CONTEXT_WINDOW_KEY);
  if (fallback !== null) return fallback === "true";
  return false;
}

export async function saveShowContextWindow(value: boolean): Promise<void> {
  try {
    const store = await getStore();
    await store.set(SHOW_CONTEXT_WINDOW_KEY, value);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save show context window setting", { error: e });
  }
  localStorage.setItem(SHOW_CONTEXT_WINDOW_KEY, String(value));
}

export async function loadMaxToolSteps(): Promise<number> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(MAX_TOOL_STEPS_KEY);
    if (typeof raw === "number") return raw;
  } catch (e) {
    logError("storage", "Failed to load max tool steps setting", { error: e });
  }
  const fallback = localStorage.getItem(MAX_TOOL_STEPS_KEY);
  if (fallback !== null) {
    const num = parseInt(fallback, 10);
    if (!isNaN(num)) return num;
  }
  return DEFAULT_MAX_TOOL_STEPS;
}

export async function saveMaxToolSteps(value: number): Promise<void> {
  try {
    const store = await getStore();
    await store.set(MAX_TOOL_STEPS_KEY, value);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save max tool steps setting", { error: e });
  }
  localStorage.setItem(MAX_TOOL_STEPS_KEY, String(value));
}

const DEFAULT_GIT_CONFIG: GitConfig = {
  repoPath: "",
  isAutoCommitEnabled: false,
  isAiCommitMsgEnabled: true,
  isPreCommitEnabled: true,
  overrideIdentity: false,
  gitName: "Sythoria AI",
  gitEmail: "assistant@sythoria.local",
};

export async function loadGitConfig(): Promise<GitConfig> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(GIT_CONFIG_KEY);
    if (raw) {
      const result = GitConfigSchema.safeParse(raw);
      if (result.success) return { ...DEFAULT_GIT_CONFIG, ...result.data };
      logWarn("storage", "Stored Git config failed validation, resetting", {
        details: result.error?.message,
        action: "Git configuration was reset to defaults. Re-configure in Settings > Git.",
      });
    }
  } catch (e) {
    logError("storage", "Failed to load Git config from secure store", {
      error: e,
      action: "Using default Git settings.",
    });
  }
  return { ...DEFAULT_GIT_CONFIG };
}

export async function saveGitConfig(config: GitConfig): Promise<void> {
  try {
    const store = await getStore();
    await store.set(GIT_CONFIG_KEY, config);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save Git config to secure store", {
      error: e,
      action: "Git configuration settings may not persist.",
    });
  }
}

const DEFAULT_APPSHOT_CONFIG: AppshotConfig = {
  enabled: true,
  captureFolder: "",
  hotkey: "Alt+Shift+S",
  imageFormat: "png",
  imageQuality: 85,
  delaySeconds: 0,
  autoCleanEnabled: false,
  autoCleanType: "count",
  autoCleanValue: 50,
  includeCursor: false,
  hideWindowOnCapture: true,
  screenCapturePromptShown: false,
};

export async function loadAppshotConfig(): Promise<AppshotConfig> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(APPSHOT_CONFIG_KEY);
    if (raw) {
      const result = AppshotConfigSchema.safeParse(raw);
      if (result.success) return { ...DEFAULT_APPSHOT_CONFIG, ...result.data } as AppshotConfig;
      logWarn("storage", "Stored Appshots config failed validation, resetting", {
        details: result.error?.message,
        action: "Appshots configuration was reset to defaults. Re-configure in Settings > Appshots.",
      });
    }
  } catch (e) {
    logError("storage", "Failed to load Appshots config from secure store", {
      error: e,
      action: "Using default Appshots settings.",
    });
  }
  return { ...DEFAULT_APPSHOT_CONFIG };
}

export async function saveAppshotConfig(config: AppshotConfig): Promise<void> {
  try {
    const store = await getStore();
    await store.set(APPSHOT_CONFIG_KEY, config);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save Appshots config to secure store", {
      error: e,
      action: "Appshots configuration settings may not persist.",
    });
  }
}

export async function clearStoreData(): Promise<void> {
  try {
    const store = await getStore();
    await store.clear();
    await store.save();
  } catch (e) {
    logError("storage", "Failed to clear store data", { error: e });
  }
}

export async function loadProjectsEnabled(): Promise<boolean> {
  try {
    const store = await getStore();
    const val = await store.get<boolean>(PROJECTS_ENABLED_KEY);
    return val ?? false; // default disabled
  } catch (e) {
    logError("storage", "Failed to load projects enabled status", { error: e });
    return false;
  }
}

export async function saveProjectsEnabled(enabled: boolean): Promise<void> {
  try {
    const store = await getStore();
    await store.set(PROJECTS_ENABLED_KEY, enabled);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save projects enabled status", { error: e });
  }
}

export async function loadProjectsDefaultPermission(): Promise<ProjectPermission> {
  try {
    const store = await getStore();
    const val = await store.get<string>(PROJECTS_DEFAULT_PERMISSION_KEY);
    if (val === "read" || val === "write" || val === "full") {
      return val as ProjectPermission;
    }
  } catch (e) {
    logError("storage", "Failed to load projects default permission", { error: e });
  }
  return "read"; // default read
}

export async function saveProjectsDefaultPermission(perm: ProjectPermission): Promise<void> {
  try {
    const store = await getStore();
    await store.set(PROJECTS_DEFAULT_PERMISSION_KEY, perm);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save projects default permission", { error: e });
  }
}

export async function loadEnabledMcpServers(): Promise<string[]> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(MCP_ENABLED_SERVERS_KEY);
    if (Array.isArray(raw)) {
      return raw.filter((item): item is string => typeof item === "string");
    }
  } catch (e) {
    logError("storage", "Failed to load enabled MCP servers from secure store", { error: e });
  }
  return [];
}

export async function saveEnabledMcpServers(enabledIds: string[]): Promise<void> {
  try {
    const store = await getStore();
    await store.set(MCP_ENABLED_SERVERS_KEY, enabledIds);
    await store.save();
  } catch (e) {
    logError("storage", "Failed to save enabled MCP servers to secure store", { error: e });
  }
}
