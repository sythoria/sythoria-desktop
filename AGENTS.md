# AGENTS.md

Sythoria — Desktop AI chat app. Tauri v2 (Rust) + React 19 (TypeScript). Connects to OpenAI-compatible APIs & Anthropic with SSE streaming, WebSocket, and agentic tool loop (web search + MCP + URL fetch + Project Workspaces).

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
  App.tsx               # Wires 10 Zustand stores to components, compare mode & tool confirmation
  index.css             # Tailwind v4 @theme, CSS vars, animations, markdown styles, motion tokens
  types/index.ts        # Core types (Message, Conversation, Project, configs) + helpers
  types/log.ts          # LogEntry, LogLevel, LogSource
  store/
    useChatStore.ts     # Conversations, streaming, generation state, compare/pin/worktree, attachments
    useModelStore.ts    # Models, temperature, API keys, health checks, active stream listener Map
    useSearchStore.ts   # Search configs, search toggle
    useMcpStore.ts      # MCP server configs, available tools, env secrets keyring, server statuses
    useUIStore.ts       # View, theme, sidebar, toasts, loading, logs, activeSection, tool confirmations
    useProjectStore.ts  # Project configuration, active project, and worktree overrides
    useKeybindStore.ts  # Customizable keyboard shortcuts and viewport zoom level mapping
    useAppshotStore.ts  # Appshots screen-capture configuration, permissions, and gallery
    useGitStore.ts      # Git repo detection, commits, AI commit messages, auto-commit
    useWhisperStore.ts  # Whisper voice recording controls, preset downloads, and model management
    helpers.ts          # Cross-store action helpers
    index.ts            # Centralized store exports
  services/
    toolLoop.ts         # Agentic tool loop: search_query + fetch_url + MCP + project workspace tools (default limit 25)
  config/
    constants.ts        # MAX_INPUT_LENGTH, DEFAULT_TEMPERATURE, ID_LENGTH, etc.
    providerPresets.ts  # OpenAI, Gemini, Ollama, NVIDIA NIM, OpenRouter, Anthropic, Custom
    searchPresets.ts    # Google, SearXNG, Firecrawl, Custom
    mcpPresets.ts       # MCP transport presets (stdio, sse, streamable-http)
    themePresets.ts     # UI theme settings and default styles
    marketplaceThemes.ts# VS Code themed stylesheets and Marketplace listings
    whisperPresets.ts   # Whisper-compatible GGUF models check/download URLs
  hooks/
    useScrollPosition.ts
    useScrollTracking.ts
    useDebounce.ts
    useAttachments.ts   # File validation, MIME mapping, and size check utilities
    use-safe-motion.ts  # useSafeMotion, useSafeScale, useSafeSlideX (respects prefers-reduced-motion)
  utils/
    storage.ts          # Tauri store + keychain + Zod validation + localStorage fallback + model/project configs
    i18n/                 # Modular BCP 47 locales: en.ts, es.ts, fr.ts, de.ts, zh.ts, ja.ts
    i18n.ts               # Consolidates locales and exports type-safe useTranslation() hook
    validation.ts       # Zod schemas, URL validation, API key validation, MCP config validation
    generateId.ts       # crypto.randomUUID().slice(0, 8)
    parseApiError.ts    # AppError JSON -> user messages with category, retryability, suggested actions
    logger.ts           # Structured logging: logInfo, logWarn, logError (syncs to UI store, Tauri plugin-log)
    attachments.ts      # Base64 serialization, input parsing, attachment metadata generation
    messageParser.ts    # Utility parsing text messages
    highlighter.ts      # Code syntax highlighting
    tokens.ts           # Token estimation/calculation helpers
  lib/
    motion-tokens.ts    # Animation tokens, springs, and motion config (reduced motion / low-end detection)
  components/
    Sidebar.tsx         # Collapsible conversation list, search, date grouping, project selector
    ChatArea.tsx        # Messages, markdown, streaming, comparison columns, worktree approvals, attachments
    InputBar.tsx        # Text input, model selector, search toggle, attachment triggers, send/stop
    Settings.tsx        # Entry component displaying sidebar settings sections
    settings/           # Modular settings panels (Appearance, Keybinds, Whisper, Projects, Mcp, General, logs, etc.)
    StartScreen.tsx     # Onboarding with motion entrance animations
    ScrollToBottomButton.tsx
    ui/                 # Modal, Spinner, Switch, Toast, ErrorBoundary, MotionButton, DragOverlay, ImagePreviewModal
src-tauri/src/
  main.rs               # sythoria_lib::run()
  lib.rs                # Tauri commands (~50+), AppError, keychain storage, initialization, event hooks
  stream_parser.rs      # SSE parsing, reasoning normalization, stream events with streamId
  ws_handler.rs         # WebSocket: types, SessionManager, reconnect (1s–30s, max 5)
  anthropic.rs          # Anthropic Messages API client, stream event mapper, and system prompt formatting
  appshots.rs           # Screen capture, auto-cleanup, permissions check, custom path configuration
  git.rs                # Git status, commits, soft-reset, checkout, worktree creation/apply/discard
  project.rs            # Workspace paths registration, permissions matching, active project mapping
  project_tools.rs      # Workspace native tools (read, write, grep, edit, bash, glob) with validation
  mcp/
    mod.rs              # McpServerConfig, McpToolInfo, McpToolResult, McpServerStatus, McpServerHandle, McpToolRequest, McpServerManager
    client.rs           # MCP client: connect/disconnect servers (stdio/SSE/streamable-http), call tools, rmcp integration
  search/
    mod.rs              # SearchResult, UrlContent, URL validation (blocks private IPs), tests
    google.rs / searxng.rs / firecrawl.rs / custom.rs
```

## State (10 Zustand stores)

- **useChatStore**: `conversations`, `activeId`, `isStreaming`, `generationState` (idle/thinking/searching/fetching/responding/mcp_executing/error), `generationByConversation` (per-conversation state), `compareIds`, `isCompareMode`, `draftAttachments`, `init()`, `sendMessage()`, `retryLastMessage()`, `stopStreaming()`, `togglePinChat()`, `applyPendingWorktree()`, `discardPendingWorktree()`, `setDraftAttachments()`, `setConversationProject()`.
- **useModelStore**: `models`, `selectedModel`, `temperature` (0–2, default 0.7), `maxToolSteps` (user-configurable step limit, default 25), `apiKeys`, `modelStatuses`, `titleConfig`, health checks (5min interval), active stream listener Map (`activeStreamIds`).
- **useSearchStore**: `searchConfigs`, `activeSearchId`, `isSearchEnabled`, `performSearch()`, `fetchUrlContent()`.
- **useMcpStore**: `mcpConfigs`, `envSecrets`, `serverStatuses` (disconnected/connecting/connected/error), `availableTools`, `enabledServerIds`, `addMcpConfig()`, `updateMcpConfig()`, `deleteMcpConfig()`, `connectServer()`, `disconnectServer()`, `connectAllEnabled()`, `callTool()`, `toggleServerEnabled()`, `getEnabledTools()`, `setEnvSecrets()`.
- **useUIStore**: `view`, `theme`, `sidebarOpen`, `sidebarCollapsed`, `loading`, `toasts`, `showRenameModal`, `logBuffer`, `logFilterSource`, `logFilterLevel`, `activeSection` (selected settings panel), `pendingToolConfirmations` (confirmations for dangerous tool execution).
- **useProjectStore**: `projects`, `activeProjectId`, `isProjectsEnabled`, `defaultPermission`, `activeWorktreePath`, `activeWorktreeBranch`, `init()`, `addProject()`, `updateProject()`, `deleteProject()`, `setActiveProject()`, `setWorktree()`, `persistProjects()`.
- **useKeybindStore**: `keybinds`, `zoomLevel` (clamped 0.5–2.0), `isRecording` (keycombo recording state), `initKeybinds()`, `setKeycombo()`, `resetKeycombo()`, `zoomIn()`, `zoomOut()`, `zoomReset()`, `startRecording()`.
- **useAppshotStore**: `config` (auto-clean options, formats, quality), `recentAppshots`, `isCapturing`, `hasPermission`, `init()`, `triggerCapture()`, `captureAndAttachToChat()`, `loadRecentAppshots()`, `deleteAppshot()`, `clearAll()`.
- **useGitStore**: `config` (auto-commit, AI commit messages, pre-commits), `status` (isRepo, branch, dirty files, ahead/behind), `loading`, `init()`, `verifyPath()`, `commitChanges()`, `undoLastCommit()`, `checkoutBranch()`, `getDiff()`, `autoCommitIfNeeded()`.
- **useWhisperStore**: `isVoiceEnabled`, `selectedModelId` (tiny.en, base.en, custom, etc.), `customModelPath`, `language`, `downloadedFiles`, `isDownloading`, `downloadProgress`, `isRecording`, `isTranscribing`, `init()`, `toggleVoiceEnabled()`, `selectModel()`, `downloadModel()`, `cancelDownload()`, `deleteModel()`.

## Tool Loop (MCP + Search + Project Workspaces)

- **`buildToolDefinitions(mcpTools, includeSearch)`**: Merges native search tools (`search_query`, `fetch_url`) and workspace tools (`project_read`, `project_grep`, `project_glob`, etc.) with MCP tools. MCP tools use `namespacedName` (`serverName__toolName`) and are prefixed with `[MCP: serverName]` in descriptions.
- **`buildToolSystemPrompt(mcpTools)`**: Injects MCP and project-specific tool descriptions into the system prompt.
- **`sendWithToolLoop()`**: If search, MCP, or project workspaces are enabled, runs iterative tool execution. Loop step limit is user-configurable (`maxToolSteps`, defaults to 25). MCP tool calls execute via `mcpCallTool(serverId, toolName, args)`, returning structured `{ content, isError, images }`.
- **Git Worktree Isolation**: For write operations in project workspaces, the agent automatically spawns a git worktree (`git_worktree_create`). Subsequent file writes, edits, and commands execute in the context of this isolated path (`worktreePath`) without polluting the main directory. The changes are displayed as a pending worktree in the UI for user review.

## Logging System

- **logInfo(source, message, opts)**, **logWarn(source, message, opts)**, **logError(source, message, opts)** — write to console, Tauri plugin-log, and a bounded in-memory log buffer (`MAX_LOGS = 500`).
- **Sources**: `general`, `chat`, `model`, `search`, `mcp`, `storage`, `stream` (and dynamically `appshots`, `git`).
- Logs are synced to `useUIStore.logBuffer` via `requestAnimationFrame` for batched UI updates.
- **Error parsing** (`parseApiError.ts`): Returns structured `ParsedError` with `message`, `action`, `category`, `retryable`, and `rawDetail`. Includes dedicated `userFriendlyMcpError()` for MCP-specific failures.

## Motion System

- **`motion-tokens.ts`**: Defines `duration`, `easing`, `distance`, `scale` tokens and `springs` (snappy, gentle, bouncy, instant, release).
- **`motionConfig`**: Detects `prefers-reduced-motion` and low-end hardware (hardwareConcurrency <= 4) to disable non-essential animations.
- **`use-safe-motion.ts`**: Provides `useSafeMotion`, `useSafeScale`, `useSafeSlideX` hooks that respect reduced-motion preferences.
- **MotionButton**: Reusable `motion.button` with scale tap/hover effects.

## Data Flow

**SSE**: `sendMessage()` → `invoke("chat_stream", { streamId })` → Rust emits `chat-stream-chunk`/`chat-stream-done` → store appends content. Cancel via `cancel_chat_stream`.

**Tool loop**: Run tool execution (max `maxToolSteps` steps) → executes `search_query`/`fetch_url`/MCP/project workspace tools → collects sources → final assistant message.

**Git Worktree Isolation Flow**: If writing to a project:

1. Tool loop triggers workspace write → backend creates isolated worktree (`git_worktree_create`).
2. Tools (`project_write`, `project_edit`, `project_bash`) execute inside `worktreePath`.
3. Conversation gains `pendingWorktree` details → ChatArea renders a `PendingWorktreeCard` showing diff summaries.
4. User selects **Apply** (`git_worktree_apply`) to merge, or **Discard** (`git_worktree_discard`) to delete.

**Appshots**: Trigger capture (`capture_screen`) → backend saves file and returns token → frontend fetches details (`read_file_from_token`) and maps it to a base64 `Attachment` → appended to chat input.

**Whisper Transcription**: Toggle voice recording (`start_recording` / `stop_recording`) → temporary audio recorded → backend runs `transcribe_audio` against downloaded whisper model → output injected into input text.

## Key Types

```typescript
export interface Attachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: "image" | "text";
  dataUrl?: string;
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
    images?: { mimeType: string; data: string }[];
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
```

## Tauri Commands

| Command                                              | Purpose                                            |
| ---------------------------------------------------- | -------------------------------------------------- |
| `load_config` / `save_config`                        | Model configs (app data dir `config.json`)         |
| `load_network_config` / `save_network_config`        | Network settings (SSL, offline mode, proxy)        |
| `load_search_config` / `save_search_config`          | Search configs (`search_config.json`)              |
| `load_api_keys` / `save_api_keys_cmd`                | API keys → OS keychain (keyring)                   |
| `load_search_api_keys` / `save_search_api_keys_cmd`  | Search API keys → OS keychain                      |
| `chat_completion` / `chat_stream`                    | Standard or streaming text generation              |
| `cancel_chat_stream`                                 | Cancel active stream via `streamId`                |
| `chat_completion_tools` / `chat_stream_tools`        | Completion/Streaming with tool calls enabled       |
| `generate_title`                                     | Auto-generate conversation title                   |
| `check_api` / `check_ollama`                         | Health checks on AI backends                       |
| `web_search` / `fetch_url_content`                   | Native search presets and web page readers         |
| `ws_connect` / `ws_send` / `ws_disconnect`           | WebSocket connection commands                      |
| `load_mcp_config` / `save_mcp_config`                | MCP server configs (`mcp_config.json`)             |
| `mcp_start_server` / `mcp_stop_server`               | Spawn stdio MCP client or connect to SSE/HTTP      |
| `mcp_check_command`                                  | Probes command/args resolution on path             |
| `mcp_list_tools` / `mcp_call_tool`                   | MCP tool discoverability and execution             |
| `select_file_and_get_token`                          | Open dialog to import file, returns secure token   |
| `read_file_from_token`                               | Read local file contents via secure token payload  |
| `download_whisper_model` / `cancel_whisper_download` | Handle Whisper GGUF asset downloading              |
| `check_downloaded_whisper_models`                    | Lists cached local Whisper files                   |
| `transcribe_audio`                                   | Transcribes recorded audio buffer via whisper.cpp  |
| `load_projects` / `save_projects`                    | Workspace configs storage                          |
| `set_active_project` / `set_project_path_override`   | Maps workspace and branch context overrides        |
| `git_detect_repo` / `git_get_status`                 | Identifies local repositories and dirty tracking   |
| `git_create_commit` / `git_undo_last_commit`         | Creates commits, commits with AI msgs, soft-resets |
| `git_worktree_create` / `git_worktree_apply`         | Create isolated workspace paths or apply changes   |
| `git_worktree_discard`                               | Prunes isolated branches and deletes worktree dirs |
| `project_read` / `project_write` / `project_edit`    | Workspace-scoped file tools                        |
| `project_list_dir` / `project_grep` / `project_glob` | Workspace directory traversal and search tools     |
| `project_bash`                                       | Execute system shells inside worktree directory    |
| `capture_screen` / `list_appshots`                   | Take screenshots, query galleries                  |
| `has_screen_capture_permission`                      | Check macOS screen recording permissions           |

## Storage

| Data            | Location                                                         |
| --------------- | ---------------------------------------------------------------- |
| Conversations   | Tauri plugin-store (`sythoria-conversations`)                    |
| Model configs   | App data dir `config.json` (keys in OS keychain)                 |
| API keys        | OS keychain (service: `com.sythoria.sythoria-desktop`)           |
| Projects        | Tauri plugin-store (`sythoria-projects`)                         |
| Search configs  | Tauri plugin-store + app data dir `search_config.json`           |
| MCP configs     | Tauri plugin-store (`sythoria-mcp-configs`)                      |
| MCP API keys    | OS keychain (service: `com.sythoria.sythoria-desktop`)           |
| MCP env secrets | OS keychain (service: `mcp-env`, per-server keys)                |
| Theme           | Tauri plugin-store (`sythoria-theme`) + localStorage fallback    |
| Keybinds        | Tauri plugin-store (`sythoria-keybinds`)                         |
| Appshot Config  | Tauri plugin-store (`sythoria-appshots`)                         |
| Whisper Config  | LocalStorage (`sythoria-whisper-config`)                         |
| Language        | Tauri plugin-store (`sythoria-language`) + LocalStorage fallback |

## Notes

- **Tailwind v4**: `@theme` directive, `@import "tailwindcss"` — no `tailwind.config.js`.
- **VS Code Themes**: Settings > Appearance houses customizable themes fetched from a marketplace, dynamically mapped to stylesheet CSS properties.
- **Git Worktree Isolation**: Highly secure write actions. Modifications execute inside a worktree sandbox before confirmation, preventing accidental main-branch workspace writes.
- **Appshots Permission**: On macOS, screen capture requests the `System Settings` permission only after the user triggers a capture, avoiding startup notification spam.
- **Stream listener Map**: Multiple active completion streams are supported in parallel (useful for Compare Mode layouts) using a thread-safe listener Map mapped by conversation IDs.
- **Keychain**: `keyring-core` with platform backends (macOS Keychain, Windows Credential Manager, Linux keyutils).
- **ESLint 9 flat config** in `eslint.config.js`.
- **Prettier**: double quotes, 2-space indent, trailing commas, 120 print width.
- **Motion system**: Respects `prefers-reduced-motion` and disables animations on low-end devices.
- **Internationalization (i18n)**: Implements dynamic locale switching for BCP 47 language keys (`en`, `es`, `fr`, `de`, `zh`, `ja`) with an automatic English fallback. State is saved persistently and updates `document.documentElement.lang`. Dictionaries are structured as modular files under `src/utils/i18n/` to keep code footprint minimal and simplify adding new locales.
