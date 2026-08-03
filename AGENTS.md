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

## Release Workflow

- Use `npm run release:patch`, `npm run release:minor`, or `npm run release:major` to bump every application version together.
- Keep the version bump and release-specific fixes in one dedicated commit named `chore(release): Release <version>`.
- Create an annotated `v<version>` tag on that release commit so the release history stays linear and easy to audit.

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
    useUIStore.ts       # View, theme, layout, toasts, logs, tasks, tool confirmations, native app updates
    useProjectStore.ts  # Project configuration, active project, and worktree overrides
    useKeybindStore.ts  # Customizable keyboard shortcuts and viewport zoom level mapping
    useAppshotStore.ts  # Appshots screen-capture configuration, permissions, and gallery
    useGitStore.ts      # Git repo detection, commits, AI commit messages, auto-commit
    useWhisperStore.ts  # Whisper voice recording controls, preset downloads, and model management
    helpers.ts          # Cross-store action helpers
    index.ts            # Centralized store exports
  services/
    toolLoop.ts         # Agentic tool loop: search_query + fetch_url + MCP + project workspace tools (default limit 25)
    conversationRunContext.ts # Immutable per-run model, project, tool, worktree, attachment, and commit scope
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
    storage.ts          # Encrypted Rust storage bridge, keychain secrets, Zod validation, and legacy migrations
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
docs/
  updater-releases.md   # Updater signing, local-build, release, and test guide
LICENSE                 # MIT license for Sythoria source and distributions
THIRD_PARTY_NOTICES.md  # Direct dependency license summary and notice guidance
src-tauri/src/
  main.rs               # sythoria_lib::run()
  lib.rs                # Tauri commands, AppError, initialization, network policy, window/tray event hooks
  atomic_file.rs        # Crash-safe temporary-file writes with atomic replacement
  secure_storage.rs     # AES-256-GCM domain storage, key derivation, migration, and preference mutation
  stream_parser.rs      # SSE parsing, reasoning normalization, stream events with streamId
  ws_handler.rs         # WebSocket: types, SessionManager, reconnect (1s–30s, max 5)
  anthropic.rs          # Anthropic Messages API client, stream event mapper, and system prompt formatting
  appshots.rs           # Screen capture, auto-cleanup, permissions check, custom path configuration
  git.rs                # Git status, commits, soft-reset, checkout, worktree creation/apply/discard
  project.rs            # Workspace registration, permissions, worktree mapping, compiled root-relative exclusions
  project_tools.rs      # Workspace tools with path validation and exclusion-pruned read/list/grep/glob traversal
  commands/
    config.rs           # Encrypted settings/config commands, keychain secret maps, and full data wipe
    conversations.rs    # Encrypted content-addressed conversation snapshots
  mcp/
    mod.rs              # McpServerConfig, McpToolInfo, McpToolResult, McpServerStatus, McpServerHandle, McpToolRequest, McpServerManager
    client.rs           # MCP client: connect/disconnect servers (stdio/SSE/streamable-http), call tools, rmcp integration
  search/
    mod.rs              # SearchResult, UrlContent, URL validation (blocks private IPs), tests
    google.rs / searxng.rs / firecrawl.rs / custom.rs
```

## State (10 Zustand stores)

- **useChatStore**: `conversations`, `activeId`, `isStreaming`, `generationState` (idle/thinking/searching/fetching/responding/mcp_executing/error), `generationByConversation` (per-conversation state), `compareIds`, `isCompareMode`, `draftAttachments`, `init()`, `sendMessage()`, `retryLastMessage()`, `stopStreaming()`, `deleteConversationTrees()`, `togglePinChat()`, `applyPendingWorktree()`, `discardPendingWorktree()`, `setDraftAttachments()`, `setConversationProject()`. Conversation deletion is descendant-aware and ordered through confirmation rejection, bounded stream/MCP cancellation, worktree cleanup, history mutation, and persistence. Project reassignment and compare teardown are blocked while their conversations own pending worktrees.
- **useModelStore**: `models`, `selectedModel`, `temperature` (0–2, default 0.7), `maxToolSteps` (user-configurable step limit, default 25), `apiKeys`, `modelStatuses`, `titleConfig`, health checks (5min interval), active stream listener Map (`activeStreamIds`).
- **useSearchStore**: `searchConfigs`, `activeSearchId`, `isSearchEnabled`, `performSearch()`, `fetchUrlContent()`.
- **useMcpStore**: `mcpConfigs` (including per-server `trustLevel`, defaulting to untrusted), `envSecrets`, `serverStatuses` (disconnected/connecting/connected/error), `availableTools`, `enabledServerIds`, connection generations that prevent stale connection publication, conversation-scoped active tool-call request IDs, transactional async disable/delete, `addMcpConfig()`, `updateMcpConfig()`, `deleteMcpConfig()`, `connectServer()`, `disconnectServer()`, `connectAllEnabled()`, `callTool()`, `cancelConversationToolCalls()`, `toggleServerEnabled()`, `getEnabledTools()`, `setEnvSecrets()`.
- **useUIStore**: `view`, `theme`, `sidebarOpen`, `sidebarCollapsed`, encrypted `sidebarWidth` / auxiliary-panel layout, `loading`, `toasts`, `showRenameModal`, `logBuffer`, `logFilterSource`, `logFilterLevel`, `activeSection` (selected settings panel), background tasks, `pendingToolConfirmations` (confirmations for dangerous tool execution), and the signed Tauri updater flow (`checkForUpdates()`, `installUpdate()`, download progress).
- **useProjectStore**: `projects`, `activeProjectId`, `isProjectsEnabled`, `defaultPermission`, `activeWorktreePath`, `activeWorktreeBranch`, `init()`, `addProject()`, `updateProject()`, `deleteProject()`, `setActiveProject()`, `setWorktree()`, `persistProjects()`.
- **useKeybindStore**: `keybinds`, `zoomLevel` (clamped 0.5–2.0), `isRecording` (keycombo recording state), `initKeybinds()`, `setKeycombo()`, `resetKeycombo()`, `zoomIn()`, `zoomOut()`, `zoomReset()`, `startRecording()`.
- **useAppshotStore**: `config` (auto-clean options, formats, quality), `recentAppshots`, `isCapturing`, `hasPermission`, `init()`, `triggerCapture()`, `captureAndAttachToChat()`, `loadRecentAppshots()`, `deleteAppshot()`, `clearAll()`.
- **useGitStore**: `config` (auto-commit, AI commit messages, pre-commits), `status` (isRepo, branch, dirty files, ahead/behind), `loading`, `init()`, `verifyPath()`, `commitChanges()`, `undoLastCommit()`, `checkoutBranch()`, `getDiff()`, `autoCommitIfNeeded(scope)`. Automatic commits require an explicit captured project/model/path scope and are serialized per repository.
- **useWhisperStore**: `isVoiceEnabled`, `selectedModelId` (tiny.en, base.en, custom, etc.), `customModelPath`, `language`, `downloadedFiles`, `isDownloading`, `downloadProgress`, `isRecording`, `isTranscribing`, `init()`, `toggleVoiceEnabled()`, `selectModel()`, `downloadModel()`, `cancelDownload()`, `deleteModel()`.

## Tool Loop (MCP + Search + Project Workspaces)

- **`buildToolDefinitions(mcpTools, includeSearch)`**: Merges native search tools (`search_query`, `fetch_url`) and workspace tools (`project_read`, `project_grep`, `project_glob`, etc.) with MCP tools. MCP tools use `namespacedName` (`serverName__toolName`) and are prefixed with `[MCP: serverName]` in descriptions.
- **`buildToolSystemPrompt(mcpTools)`**: Injects MCP and project-specific tool descriptions into the system prompt.
- **`sendWithToolLoop()`**: If search, MCP, or project workspaces are enabled, runs iterative tool execution. Loop step limit is user-configurable (`maxToolSteps`, defaults to 25). Rust requires a native confirmation for every untrusted MCP tool call and issues a 60-second single-use capability bound to server connection, tool, argument hash, and conversation; a server explicitly marked trusted in Settings can execute without a capability. MCP tool calls execute via `mcpCallTool(serverId, toolName, args, conversationId)`, returning structured `{ content, isError, images }`; the conversation scope allows deletion/stop flows to cancel only matching native requests.
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

**Tool loop**: `sendMessage()` snapshots a `ConversationRunContext` from the target conversation → run tool execution (max `maxToolSteps` steps) → executes `search_query`/`fetch_url`/MCP/project workspace tools using that fixed context → collects sources → final assistant message. Compare, retry, resume, and subagent runs keep their originating conversation's project/model context instead of consulting global navigation state.

**Chat deletion**: Discover the selected conversation and all descendant subagents → reject their pending tool confirmations → mark their runs stopped → await bounded stream and conversation-scoped MCP cancellation → discard each unique worktree → atomically remove conversation/history/compare records → persist. If any worktree cannot be discarded, deletion pauses and keeps the failed recovery records. Non-empty temporary chats use this same full-deletion path when the user switches away.

**Git Worktree Isolation Flow**: If writing to a project:

1. Tool loop triggers workspace write → backend creates isolated worktree (`git_worktree_create`).
2. Tools (`project_write`, `project_edit`, `project_bash`) execute inside `worktreePath`.
3. Conversation gains `pendingWorktree` details, including its captured commit scope → ChatArea always renders a recovery card, even when status is empty, committed/binary-only, loading, or unavailable.
4. User selects **Apply** (`git_worktree_apply`) to merge, or **Discard** (`git_worktree_discard`) to delete. Apply compares the staged worktree state to its merge base so committed branch-ahead and uncommitted changes are both preserved, then returns the authoritative AI-changed path list; optional auto-commit runs only afterward and commits only those paths.
5. Project switching/detachment and compare-mode teardown remain blocked until the recovery action completes; legacy detached records recover their project ID from `commitScope`.

**Appshots**: Trigger capture (`capture_screen`) → backend saves file and returns token → frontend fetches details (`read_file_from_token`) and maps it to a base64 `Attachment` → appended to chat input.

**Whisper Transcription**: Toggle voice recording (`start_recording` / `stop_recording`) → temporary audio recorded → backend runs `transcribe_audio` against downloaded whisper model → output injected into input text.

**App Updates**: `checkForUpdates()` uses the Tauri updater plugin against the signed `latest.json` in GitHub Releases → the update modal downloads and installs the verified platform artifact → the process plugin relaunches Sythoria. Release builds require the `TAURI_SIGNING_PRIVATE_KEY` GitHub Actions secret; keep the corresponding private key backed up and never commit it. The macOS `app` bundle target must remain enabled so Tauri creates the `.app.tar.gz` updater artifact in addition to the DMG. See `docs/updater-releases.md` for the signing, release, and test procedure.

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

export interface PendingWorktree {
  path: string;
  branch: string;
  commitScope?: {
    projectId: string;
    projectRoot: string;
    modelId: string;
  };
}

export interface Conversation {
  id: string;
  title: string;
  timestamp: Date;
  messages: Message[];
  model: string;
  projectId?: string;
  pendingWorktree?: PendingWorktree;
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

| Command                                                           | Purpose                                             |
| ----------------------------------------------------------------- | --------------------------------------------------- |
| `load_config` / `save_config`                                     | Encrypted model configs (`models.enc`)              |
| `load_encrypted_preferences` / `mutate_encrypted_preferences`     | Read or atomically mutate encrypted preferences     |
| `load_network_config` / `save_network_config`                     | Authenticated network policy (`network.enc`)        |
| `load_search_config` / `save_search_config`                       | Encrypted search configs (`search.enc`)             |
| `load_api_keys` / `save_api_keys_cmd`                             | API keys → OS keychain (keyring)                    |
| `load_search_api_keys` / `save_search_api_keys_cmd`               | Search API keys → OS keychain                       |
| `load_encrypted_conversations` / `save_encrypted_conversations`   | Read/write encrypted chat snapshots                 |
| `clear_encrypted_conversations`                                   | Delete chat ciphertext and its keychain key         |
| `chat_completion` / `chat_stream`                                 | Standard or streaming text generation               |
| `cancel_chat_stream`                                              | Cancel active stream via `streamId`                 |
| `chat_completion_tools` / `chat_stream_tools`                     | Completion/Streaming with tool calls enabled        |
| `generate_title`                                                  | Auto-generate conversation title                    |
| `check_api` / `check_ollama`                                      | Health checks on AI backends                        |
| `web_search` / `fetch_url_content`                                | Native search presets and web page readers          |
| `ws_connect` / `ws_send` / `ws_disconnect`                        | WebSocket connection commands                       |
| `load_mcp_config` / `save_mcp_config`                             | Encrypted MCP server configs (`mcp.enc`)            |
| `mcp_start_server` / `mcp_stop_server` / `mcp_set_server_enabled` | Spawn, stop, or revoke MCP server execution         |
| `mcp_check_command`                                               | Probes command/args resolution on path              |
| `mcp_list_tools` / `mcp_request_tool_approval` / `mcp_call_tool`  | MCP discovery, native approval, and execution       |
| `mcp_cancel_tool_call`                                            | Cancel one request-scoped MCP tool invocation       |
| `select_file_and_get_token`                                       | Open dialog to import file, returns secure token    |
| `read_file_from_token`                                            | Read local file contents via secure token payload   |
| `download_whisper_model` / `cancel_whisper_download`              | Handle Whisper GGUF asset downloading               |
| `check_downloaded_whisper_models`                                 | Lists cached local Whisper files                    |
| `transcribe_audio`                                                | Transcribes recorded audio buffer via whisper.cpp   |
| `load_projects` / `save_projects`                                 | Workspace configs storage                           |
| `set_active_project` / `set_project_path_override`                | Maps workspace and branch context overrides         |
| `project_run_begin`                                               | Binds a run to the root or a validated worktree     |
| `git_detect_repo` / `git_get_status`                              | Identifies local repositories and dirty tracking    |
| `git_create_commit` / `git_undo_last_commit`                      | Creates commits, commits with AI msgs, soft-resets  |
| `git_worktree_create` / `git_worktree_apply`                      | Create isolated workspace paths or apply changes    |
| `git_worktree_discard`                                            | Prunes isolated branches and deletes worktree dirs  |
| `project_read` / `project_write` / `project_edit`                 | Workspace-scoped file tools                         |
| `project_list_dir` / `project_grep` / `project_glob`              | Workspace directory traversal and search tools      |
| `project_bash`                                                    | Execute system shells inside worktree directory     |
| `capture_screen` / `list_appshots`                                | Take screenshots, query galleries                   |
| `has_screen_capture_permission`                                   | Check macOS screen recording permissions            |
| `wipe_config_files`                                               | Ordered keychain, encrypted-chat, and settings wipe |

## Storage

| Data             | Location                                                          |
| ---------------- | ----------------------------------------------------------------- |
| Conversations    | AES-256-GCM manifest + content-addressed blobs (`conversations/`) |
| Model configs    | AES-256-GCM authenticated `models.enc` (master in OS keychain)    |
| API keys         | OS keychain (service: `com.sythoria.sythoria-desktop`)            |
| Projects         | Authenticated encrypted `projects.enc`                            |
| Network policy   | Authenticated encrypted `network.enc` + keychain presence marker  |
| Search configs   | Authenticated encrypted preferences / `search.enc`                |
| MCP configs      | Authenticated encrypted preferences / `mcp.enc`                   |
| MCP API keys     | OS keychain (service: `com.sythoria.sythoria-desktop`)            |
| MCP env secrets  | OS keychain (service: `mcp-env`, per-server keys)                 |
| Preferences      | Authenticated encrypted `preferences.enc`                         |
| Whisper Config   | Authenticated encrypted preferences (cloud key in OS keychain)    |
| UI/window layout | Authenticated encrypted preferences                               |

## Notes

- **Tailwind v4**: `@theme` directive, `@import "tailwindcss"` — no `tailwind.config.js`.
- **VS Code Themes**: Settings > Appearance houses customizable themes fetched from a marketplace, dynamically mapped to stylesheet CSS properties.
- **Git Worktree Isolation**: Highly secure write actions. Modifications execute inside a worktree sandbox before confirmation, preventing accidental main-branch workspace writes.
- **Project exclusions**: Project patterns use root-relative Git-ignore semantics, cannot use negation, and are enforced before and after canonicalization as well as during list/grep/glob traversal.
- **Appshots Permission**: On macOS, screen capture requests the `System Settings` permission only after the user triggers a capture, avoiding startup notification spam.
- **Stream listener Map**: Multiple active completion streams are supported in parallel (useful for Compare Mode layouts) using a thread-safe listener Map mapped by conversation IDs.
- **Keychain**: `keyring-core` with platform backends (macOS Keychain, Windows Credential Manager, Linux keyutils).
- **Renderer secret boundary**: Persisted keychain values are represented in the WebView only by a fixed masked placeholder. Model, search, title-generation, and MCP connection commands resolve actual credentials natively immediately before use; MCP environment values never cross back into the renderer after storage.
- **Tauri capabilities**: The main window enumerates only the event names, URL schemes, resource cleanup, dialog, updater, logging, and window operations used by the renderer; do not restore broad `core:*:default` or `opener:default` grants.
- **MCP process environment**: Stdio servers start with a cleared environment. They inherit only the documented runtime allowlist in `mcp/client.rs` plus environment variables explicitly configured for that server.
- **Encrypted storage**: Settings use per-domain AES-256-GCM keys derived from an OS-keychain master key. Writes are atomic; legacy plaintext/plugin-store values migrate on read and are removed only after a successful encrypted save.
- **Conversation storage**: Each conversation is an authenticated content-addressed blob behind an encrypted manifest and a separate keychain-backed key; failed saves retain the previous snapshot.
- **Network fail-closed**: If an existing authenticated network policy cannot be loaded, startup enables strict SSL and offline mode instead of silently reverting to permissive defaults.
- **Window state**: Main-window size, position, and maximized state are restored from encrypted preferences. The default window is 1200×780 when no saved geometry exists.
- **Privacy wipe**: The Rust backend deletes indexed keychain secrets before encrypted files, and frontend persistence is suspended during the wipe to prevent data recreation.
- **Logging privacy**: Legacy plaintext log files are removed at startup; runtime Rust logs target stdout at warning level.
- **ESLint 9 flat config** in `eslint.config.js`.
- **Prettier**: double quotes, 2-space indent, trailing commas, 120 print width.
- **Motion system**: Respects `prefers-reduced-motion` and disables animations on low-end devices.
- **Internationalization (i18n)**: Implements dynamic locale switching for BCP 47 language keys (`en`, `es`, `fr`, `de`, `zh`, `ja`) with an automatic English fallback. State is saved persistently and updates `document.documentElement.lang`. Dictionaries are structured as modular files under `src/utils/i18n/` to keep code footprint minimal and simplify adding new locales.
- **Licensing**: Sythoria is MIT-licensed. Contributions are accepted under the same terms, and third-party license information is summarized in `THIRD_PARTY_NOTICES.md`.
