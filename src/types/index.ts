export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface UrlContent {
  url: string;
  title: string;
  content: string;
  status: string;
  error?: string;
}

export type AttachmentKind = "image" | "text";

export interface Attachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: AttachmentKind;
  /** Images: `data:image/...;base64,...` — used for both preview and API image_url parts. */
  dataUrl?: string;
  /** Text files: decoded content injected into the prompt. */
  textContent?: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  toolCall?: { id: string; name: string; arguments: Record<string, string> };
  toolResult?: {
    id: string;
    name: string;
    content: string;
    images?: McpImageContent[];
    diffSummary?: {
      added: number;
      deleted: number;
      isNew?: boolean;
      filename?: string;
    };
  };
  sources?: { title: string; url: string }[];
  attachments?: Attachment[];
}

export interface Conversation {
  id: string;
  title: string;
  timestamp: Date;
  messages: Message[];
  model: string;
  projectId?: string;
  pendingWorktree?: {
    path: string;
    branch: string;
  };
  isPinned?: boolean;
  // Subagent fields
  parentId?: string;
  role?: string;
  isSubagent?: boolean;
  status?: "running" | "idle" | "error" | "completed";
}

export type ProjectPermission = "read" | "write" | "full";

export interface Project {
  id: string;
  name: string;
  path: string;
  permissions: ProjectPermission;
  excludePatterns?: string[];
  systemPromptOverride?: string;
  modelOverride?: string;
  isAutoCommitEnabled?: boolean;
  autoCommitMsgTemplate?: string;
}

export interface ModelConfig {
  id: string;
  name: string;
  apiBase: string;
  apiKey: string;
  modelId: string;
  provider?: string;
  enabled?: boolean;
  supportsImages?: boolean;
  contextSize?: number;
  maxOutputTokens?: number;
  temperature?: number;
  systemPromptOverride?: string;
}

export type SearchProvider = "google" | "searxng" | "firecrawl" | "custom";

export interface SearchApiConfig {
  id: string;
  name: string;
  provider: SearchProvider;
  baseUrl: string;
  apiKey?: string;
  cx?: string;
  maxResults: number;
  enabled: boolean;
}

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

export type GenerationState = "idle" | "thinking" | "searching" | "fetching" | "responding" | "mcp_executing" | "error";

export type McpTransport = "stdio" | "sse" | "streamable-http";

/**
 * MCP server configuration.
 *
 * For `stdio` transport:
 *   - `command` is the **program/executable only** (e.g. `npx`, `uvx`,
 *     `/usr/local/bin/python`). Do NOT include arguments here — put them in
 *     `args`. The UI validates that the executable resolves on PATH.
 *   - `args` is the **full ordered argument list** (e.g.
 *     `["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/project"]`).
 *     Each entry is passed to the process verbatim, so paths with spaces are
 *     safe as a single array element (no shell quoting needed).
 *
 * Legacy configs stored a full command line in `command`; those are migrated
 * to program + args on load by `migrateMcpConfigs`.
 */
export interface McpServerConfig {
  id: string;
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  baseUrl?: string;
  apiKey?: string;
  enabled: boolean;
  trustLevel?: "trusted" | "untrusted";
  allowLocalNetwork?: boolean;
}

/** Result of probing whether a stdio command resolves to an executable. */
export interface ExecutableCheck {
  found: boolean;
  /** Resolved absolute path, if found. */
  path?: string;
  /** Best-effort `--version` output (first line), if available. */
  version?: string;
  /** Human-readable status suitable for showing inline in the UI. */
  message: string;
}

export interface McpTool {
  name: string;
  namespacedName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  serverId: string;
  serverName: string;
}

export interface McpImageContent {
  mimeType: string;
  data: string;
}

export interface McpToolResult {
  content: string;
  isError: boolean;
  images?: McpImageContent[];
}

export type McpServerStatus = "disconnected" | "connecting" | "connected" | "error";

export const DEFAULT_TITLE_SYSTEM_PROMPT =
  "Generate a concise, descriptive title (max 5 words) for a conversation that started with the following user message. Respond with only the title text, no quotes or explanations.\n\nUser message:\n{{userMessage}}";

export interface TitleGenerationConfig {
  enabled: boolean;
  modelId: string;
  systemPrompt: string;
}

export const STATUS_COLORS: Record<ConnectionStatus, string> = {
  disconnected: "bg-zinc-500",
  connecting: "bg-amber-400 animate-pulse",
  connected: "bg-emerald-500",
  error: "bg-red-500",
};

export const MCP_STATUS_COLORS: Record<McpServerStatus, string> = {
  disconnected: "bg-zinc-500",
  connecting: "bg-amber-400 animate-pulse",
  connected: "bg-emerald-500",
  error: "bg-red-500",
};

export const MCP_STATUS_LABELS: Record<McpServerStatus, string> = {
  disconnected: "Disconnected",
  connecting: "Connecting\u2026",
  connected: "Connected",
  error: "Error",
};

export type ModelStatuses = Record<string, ConnectionStatus>;

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  content: string;
}
