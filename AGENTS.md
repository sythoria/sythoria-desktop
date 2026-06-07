# AGENTS.md

Sythoria — Desktop AI chat app. Tauri v2 (Rust) + React 19 (TypeScript). Connects to OpenAI-compatible APIs with SSE streaming, WebSocket, and agentic tool loop (web search + MCP + URL fetch).

## Commands

| Command                      | Purpose                              |
| ---------------------------- | ------------------------------------ |
| `npm run tauri dev`          | Dev (Vite + Tauri window, port 1420) |
| `npm run tauri build`        | Production build                     |
| `npm run dev`                | Frontend only                        |
| `npm run build`              | `tsc && vite build`                  |
| `npm run test`               | Vitest (jsdom)                       |
| `npm run test:watch`         | Vitest watch                         |
| `npm run lint`               | ESLint                               |
| `npm run typecheck`          | `tsc --noEmit`                       |
| `npm run format:check`       | Prettier check                       |
| `cd src-tauri && cargo test` | Rust tests                           |

Pre-commit: Husky + lint-staged (`eslint --fix` + `prettier --write`).

## Directory Structure

```
src/
  main.tsx              # Entry: theme init, ErrorBoundary > App
  App.tsx               # Wires 5 Zustand stores to components
  index.css             # Tailwind v4 @theme, CSS vars, animations, markdown styles, motion tokens
  types/index.ts        # Core types + config helpers
  types/log.ts          # LogEntry, LogLevel, LogSource
  store/
    useChatStore.ts     # Conversations, streaming, generation state, init/send/retry, hasStarted
    useModelStore.ts    # Models, temperature, API keys, health checks, stream management
    useSearchStore.ts   # Search configs, search toggle
    useMcpStore.ts      # MCP server configs, connections, available tools, env secrets
    useUIStore.ts       # View, theme, sidebar, toasts, loading, rename modal, log buffer/filters
    helpers.ts          # Cross-store action helpers
    index.ts            # Centralized store exports
  services/
    toolLoop.ts         # Agentic tool loop: search_query + fetch_url + MCP tools (max 5 steps)
  config/
    constants.ts        # MAX_INPUT_LENGTH, DEFAULT_TEMPERATURE, ID_LENGTH, etc.
    providerPresets.ts  # OpenAI, Gemini, Ollama, NVIDIA NIM, OpenRouter, Custom
    searchPresets.ts    # Google, SearXNG, Firecrawl, Custom
    mcpPresets.ts       # MCP transport presets (stdio, sse, streamable-http)
  hooks/
    useScrollPosition.ts
    useDebounce.ts
    use-safe-motion.ts  # useSafeMotion, useSafeScale, useSafeSlideX (respects prefers-reduced-motion)
  utils/
    storage.ts          # Tauri store + keychain + Zod validation + localStorage fallback + MCP configs
    validation.ts       # Zod schemas, URL validation, API key validation, MCP config validation
    generateId.ts       # crypto.randomUUID().slice(0, 8)
    parseApiError.ts    # AppError JSON -> user messages with category, retryability, suggested actions
    logger.ts           # Structured logging: logInfo, logWarn, logError (syncs to UI store, Tauri plugin-log)
  lib/
    motion-tokens.ts    # Animation tokens, springs, and motion config (reduced motion / low-end detection)
  components/
    Sidebar.tsx         # Conversation list, search, date grouping, actions
    ChatArea.tsx        # Messages, markdown, streaming, generation state, sources
    InputBar.tsx        # Text input, model selector, search toggle, send/stop
    Settings.tsx        # Dark mode, models, search configs, API keys, temperature, title config, MCP servers, log viewer
    StartScreen.tsx     # Onboarding with motion entrance animations
    ScrollToBottomButton.tsx
    ui/                 # Modal, Spinner, Switch, Toast, ErrorBoundary, MotionButton
src-tauri/src/
  main.rs               # sythoria_lib::run()
  lib.rs                # Tauri commands (~27), AppError, keychain storage, MCP config/env keychain ops
  stream_parser.rs      # SSE parsing, reasoning normalization, stream events with streamId
  ws_handler.rs         # WebSocket: types, SessionManager, reconnect (1s–30s, max 5)
  mcp/
    mod.rs              # McpServerConfig, McpToolInfo, McpToolResult, McpServerStatus, McpServerHandle, McpToolRequest, McpServerManager
    client.rs           # MCP client: connect/disconnect servers (stdio/SSE/streamable-http), call tools, rmcp integration
  search/
    mod.rs              # SearchResult, UrlContent, URL validation (blocks private IPs), tests
    google.rs / searxng.rs / firecrawl.rs / custom.rs
```

## State (5 Zustand stores)

- **useChatStore**: `conversations`, `activeId`, `isStreaming`, `generationState` (idle/thinking/searching/fetching/responding/**mcp_executing**/error), `init()`, `sendMessage()`, `retryLastMessage()`, `stopStreaming()`, `exportChat()`, `hasStarted`
- **useModelStore**: `models`, `selectedModel`, `temperature` (0–2, default 0.7), `apiKeys`, `modelStatuses`, `titleConfig`, health checks (5min interval), stream listeners with streamId
- **useSearchStore**: `searchConfigs`, `activeSearchId`, `isSearchEnabled`, `performSearch()`, `fetchUrlContent()`
- **useMcpStore**: `mcpConfigs`, `envSecrets`, `serverStatuses` (disconnected/connecting/connected/error), `availableTools`, `enabledServerIds`, `addMcpConfig()`, `updateMcpConfig()`, `deleteMcpConfig()`, `connectServer()`, `disconnectServer()`, `connectAllEnabled()`, `callTool()`, `toggleServerEnabled()`, `getEnabledTools()`, `setEnvSecrets()`
- **useUIStore**: `view`, `theme`, `sidebarOpen`, `sidebarCollapsed`, `hasStarted`, `isConfigLoaded`, `loading`, `toasts`, `showRenameModal`, `logBuffer`, `logFilterSource` (general/chat/model/search/mcp/storage/stream/all), `logFilterLevel` (all/info/warn/error), rename modal

## Tool Loop (MCP + Search)

- **`buildToolDefinitions(mcpTools, includeSearch)`**: Merges native tools (search_query, fetch_url) with MCP tools. MCP tools use `namespacedName` (`serverName__toolName`) and are prefixed with `[MCP: serverName]` in descriptions.
- **`buildToolSystemPrompt(mcpTools)`**: Injects MCP tool descriptions into the system prompt.
- **`sendWithToolLoop()`**: If search or MCP is enabled, runs iterative `chat_completion_tools` (max 5 steps). MCP tool calls execute via `mcpCallTool(serverId, toolName, args)`, returning structured `{ content, isError }`.
- Tool loop state: `generationState` switches dynamically through `thinking` → `searching`/`fetching`/`mcp_executing` → `responding` or `error`.

## Logging System

- **logInfo(source, message, opts)**, **logWarn(source, message, opts)**, **logError(source, message, opts)** — write to console, Tauri plugin-log, and a bounded in-memory log buffer (`MAX_LOGS = 500`).
- **Sources**: `general`, `chat`, `model`, `search`, `mcp`, `storage`, `stream`
- Logs are synced to `useUIStore.logBuffer` via `requestAnimationFrame` for batched UI updates.
- **Error parsing** (`parseApiError.ts`): Returns structured `ParsedError` with `message`, `action`, `category`, `retryable`, and `rawDetail`. Includes dedicated `userFriendlyMcpError()` for MCP-specific failures (auth, spawn, timeout, handshake, connection refused).

## Motion System

- **`motion-tokens.ts`**: Defines `duration`, `easing`, `distance`, `scale` tokens and `springs` (snappy, gentle, bouncy, instant, release).
- **`motionConfig`**: Detects `prefers-reduced-motion` and low-end hardware (hardwareConcurrency <= 4) to disable non-essential animations.
- **`use-safe-motion.ts`**: Provides `useSafeMotion`, `useSafeScale`, `useSafeSlideX` hooks that respect reduced-motion preferences.
- **MotionButton**: Reusable `motion.button` with scale tap/hover effects.
- Components (Sidebar, ChatArea, InputBar, Settings, StartScreen, Modal, Switch, Toast) use motion tokens for consistent entrance/exit/transitions.

## Data Flow

**SSE**: `sendMessage()` → `invoke("chat_stream", { streamId })` → Rust emits `chat-stream-chunk`/`chat-stream-done` → store appends content. Cancel via `cancel_chat_stream`.

**Tool loop**: If search or MCP enabled → `sendWithToolLoop()` → iterative `chat_completion_tools` (max 5 steps) → executes `search_query`/`fetch_url`/MCP tool calls → collects sources → final assistant message.

**WebSocket**: `invoke("ws_chat")` → Rust reconnects with exponential backoff → emits `ws-message`/`ws-connected`/`ws-closed`/`ws-error`.

**MCP**: `connectServer()` → `invoke("mcp_start_server", { config, envSecrets })` → Rust spawns MCP client (stdio/SSE/streamable-http) via `rmcp` → returns tools → stored in `availableTools`. Disconnect via `mcp_stop_server`. Tool calls via `mcp_call_tool`.

## Key Types

```typescript
interface Message {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  toolCall?: { id: string; name: string; arguments: Record<string, string> };
  toolResult?: { id: string; name: string; content: string };
  sources?: { title: string; url: string }[];
}
interface Conversation {
  id: string;
  title: string;
  timestamp: Date;
  messages: Message[];
  model: string;
}
interface ModelConfig {
  id: string;
  name: string;
  apiBase: string;
  apiKey: string;
  modelId: string;
  provider?: string;
  enabled?: boolean;
}
type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";
type GenerationState = "idle" | "thinking" | "searching" | "fetching" | "responding" | "mcp_executing" | "error";
type SearchProvider = "google" | "searxng" | "firecrawl" | "custom";
interface SearchApiConfig {
  id: string;
  name: string;
  provider: SearchProvider;
  baseUrl: string;
  apiKey?: string;
  cx?: string;
  maxResults: number;
  enabled: boolean;
}

// MCP
type McpTransport = "stdio" | "sse" | "streamable-http";
interface McpServerConfig {
  id: string;
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  baseUrl?: string;
  apiKey?: string;
  enabled: boolean;
}
interface McpTool {
  name: string;
  namespacedName: string; // "serverName__toolName"
  description: string;
  inputSchema: Record<string, unknown>;
  serverId: string;
  serverName: string;
}
interface McpToolResult {
  content: string;
  isError: boolean;
}
type McpServerStatus = "disconnected" | "connecting" | "connected" | "error";

// Logging
type LogLevel = "info" | "warn" | "error";
type LogSource = "general" | "chat" | "model" | "search" | "mcp" | "storage" | "stream";
interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  source: LogSource;
  message: string;
  details?: string;
  action?: string;
}
```

## Tauri Commands

| Command                                             | Purpose                                            |
| --------------------------------------------------- | -------------------------------------------------- |
| `load_config` / `save_config`                       | Model configs (app data dir `config.json`)         |
| `load_search_config` / `save_search_config`         | Search configs (`search_config.json`)              |
| `load_api_keys` / `save_api_keys_cmd`               | API keys → OS keychain (keyring)                   |
| `load_search_api_keys` / `save_search_api_keys_cmd` | Search API keys → OS keychain                      |
| `chat_completion`                                   | Non-streaming completion                           |
| `chat_stream`                                       | SSE streaming (streamId, cancelable)               |
| `cancel_chat_stream`                                | Cancel active stream                               |
| `chat_completion_tools` / `chat_stream_tools`       | Completion with tool support                       |
| `generate_title`                                    | Auto-generate conversation title                   |
| `check_api`                                         | Health-check GET /models                           |
| `web_search`                                        | Web search (google/searxng/firecrawl/custom)       |
| `fetch_url_content`                                 | Extract readable text from URL                     |
| `ws_chat` / `ws_authenticate`                       | WebSocket chat + auth                              |
| `load_mcp_config` / `save_mcp_config`               | MCP server configs (`mcp_config.json`)             |
| `load_mcp_env_secrets` / `save_mcp_env_secrets_cmd` | MCP env secrets → OS keychain                      |
| `mcp_start_server`                                  | Connect to an MCP server (returns available tools) |
| `mcp_stop_server`                                   | Disconnect an MCP server                           |
| `mcp_list_tools`                                    | List tools for a connected MCP server              |
| `mcp_call_tool`                                     | Call a tool on a connected MCP server              |

## Storage

| Data            | Location                                                      |
| --------------- | ------------------------------------------------------------- |
| Conversations   | Tauri plugin-store (`sythoria-conversations`)                 |
| Model configs   | App data dir `config.json` (keys in OS keychain)              |
| API keys        | OS keychain (service: `com.sythoria.sythoria-desktop`)        |
| Search configs  | Tauri plugin-store + app data dir `search_config.json`        |
| MCP configs     | Tauri plugin-store (`sythoria-mcp-configs`)                   |
| MCP env secrets | OS keychain (service: `mcp-env`, per-server keys)             |
| Theme           | Tauri plugin-store (`sythoria-theme`) + localStorage fallback |
| hasStarted      | Tauri plugin-store (`sythoria-has-started`)                   |

## Notes

- **Tailwind v4**: `@theme` directive, `@import "tailwindcss"` — no `tailwind.config.js`.
- **Font**: DM Sans (UI), JetBrains Mono (code) via Google Fonts.
- **Dark mode default**: checks `sythoria-theme` in localStorage, then `prefers-color-scheme`.
- **CSS theming**: `:root` / `.dark` custom properties mapped to Tailwind `@theme` tokens.
- **Stream cancellation**: Each stream has a `streamId`; `cancel_chat_stream` aborts mid-stream.
- **URL security**: Rust `search/mod.rs` blocks private IPs, metadata endpoints (169.254.169.254), localhost.
- **Keychain**: `keyring-core` with platform backends (macOS Keychain, Windows Credential Manager, Linux keyutils).
- **MCP support**: Uses `rmcp` crate. Supports stdio (spawn child), SSE, and streamable HTTP transports. Environment variables for MCP servers are stored in the OS keychain, per-server.
- **Vite chunks**: `markdown`, `react`, `vendor` manual splits.
- **ESLint 9 flat config** in `eslint.config.js`.
- **Prettier**: double quotes, 2-space indent, trailing commas, 120 print width.
- **TS strict**: `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`.
- **Motion system**: Respects `prefers-reduced-motion`. Disables animations on low-end devices. All motion tokens live in `src/lib/motion-tokens.ts`.
- **Log system**: Max 500 logs in buffer. Synced to `useUIStore` via `requestAnimationFrame`. Viewable in Settings > Logs. Tauri plugin-log integration for native logs.
- **Sidebar**: Collapsible (toggle via `useUIStore.toggleSidebarCollapsed()`). Motion-animated expand/collapse. Responsive behavior for mobile sidebar.
