# AGENTS.md

Sythoria — Desktop AI chat app. Tauri v2 (Rust) + React 19 (TypeScript). Connects to OpenAI-compatible APIs with SSE streaming, WebSocket, and agentic tool loop (web search + URL fetch).

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
  App.tsx               # Wires 4 Zustand stores to components
  index.css             # Tailwind v4 @theme, CSS vars, animations, markdown styles
  types/index.ts        # Core types + config helpers
  store/
    useChatStore.ts     # Conversations, streaming, generation state, init/send/retry
    useModelStore.ts    # Models, temperature, API keys, health checks, stream management
    useSearchStore.ts   # Search configs, search toggle
    useUIStore.ts       # View, theme, sidebar, toasts, loading, rename modal
    helpers.ts          # Cross-store action helpers (avoids circular deps)
  services/
    toolLoop.ts         # Agentic tool loop: search_query + fetch_url (max 5 steps)
  config/
    constants.ts        # MAX_INPUT_LENGTH, DEFAULT_TEMPERATURE, ID_LENGTH, etc.
    providerPresets.ts  # OpenAI, Gemini, Ollama, NVIDIA NIM, OpenRouter, Custom
    searchPresets.ts    # Google, SearXNG, Firecrawl, Custom
  hooks/
    useScrollPosition.ts
    useDebounce.ts
  utils/
    storage.ts          # Tauri store + keychain + Zod validation + localStorage fallback
    validation.ts       # Zod schemas, URL validation, API key validation
    generateId.ts       # crypto.randomUUID().slice(0, 8)
    parseApiError.ts    # AppError JSON -> user messages
    logger.ts           # Console + Tauri plugin-log
  components/
    Sidebar.tsx         # Conversation list, search, date grouping, actions
    ChatArea.tsx        # Messages, markdown, streaming, generation state, sources
    InputBar.tsx        # Text input, model selector, search toggle, send/stop
    Settings.tsx        # Dark mode, models, search configs, API keys, temperature, title config
    StartScreen.tsx     # Onboarding
    ScrollToBottomButton.tsx
    ui/                 # Modal, Spinner, Switch, Toast, ErrorBoundary
src-tauri/src/
  main.rs               # sythoria_lib::run()
  lib.rs                # 19 Tauri commands, AppError, keychain storage
  stream_parser.rs      # SSE parsing, reasoning normalization, stream events with streamId
  ws_handler.rs         # WebSocket: types, SessionManager, reconnect (1s–30s, max 5)
  search/
    mod.rs              # SearchResult, UrlContent, URL validation (blocks private IPs), tests
    google.rs / searxng.rs / firecrawl.rs / custom.rs
```

## State (4 Zustand stores)

- **useChatStore**: `conversations`, `activeId`, `isStreaming`, `generationState` (idle/thinking/searching/fetching/responding/error), `init()`, `sendMessage()`, `retryLastMessage()`, `stopStreaming()`, `exportChat()`
- **useModelStore**: `models`, `selectedModel`, `temperature` (0–2, default 0.7), `apiKeys`, `modelStatuses`, `titleConfig`, health checks (5min interval), stream listeners with streamId
- **useSearchStore**: `searchConfigs`, `activeSearchId`, `isSearchEnabled`, `performSearch()`, `fetchUrlContent()`
- **useUIStore**: `view`, `theme`, `sidebarOpen`, `hasStarted`, `loading`, `toasts`, rename modal

## Data Flow

**SSE**: `sendMessage()` → `invoke("chat_stream", { streamId })` → Rust emits `chat-stream-chunk`/`chat-stream-done` → store appends content. Cancel via `cancel_chat_stream`.

**Tool loop**: If search enabled → `sendWithToolLoop()` → iterative `chat_completion_tools` (max 5 steps) → executes `search_query`/`fetch_url` tool calls → collects sources → final assistant message.

**WebSocket**: `invoke("ws_chat")` → Rust reconnects with exponential backoff → emits `ws-message`/`ws-connected`/`ws-closed`/`ws-error`.

## Key Types

```typescript
interface Message {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  toolCall?: { id: string; name: "search_query" | "fetch_url"; arguments: Record<string, string> };
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
type GenerationState = "idle" | "thinking" | "searching" | "fetching" | "responding" | "error";
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
```

## Tauri Commands

| Command                                             | Purpose                                      |
| --------------------------------------------------- | -------------------------------------------- |
| `load_config` / `save_config`                       | Model configs (app data dir `config.json`)   |
| `load_search_config` / `save_search_config`         | Search configs (`search_config.json`)        |
| `load_api_keys` / `save_api_keys_cmd`               | API keys → OS keychain (keyring)             |
| `load_search_api_keys` / `save_search_api_keys_cmd` | Search API keys → OS keychain                |
| `chat_completion`                                   | Non-streaming completion                     |
| `chat_stream`                                       | SSE streaming (streamId, cancelable)         |
| `cancel_chat_stream`                                | Cancel active stream                         |
| `chat_completion_tools` / `chat_stream_tools`       | Completion with tool support                 |
| `generate_title`                                    | Auto-generate conversation title             |
| `check_api`                                         | Health-check GET /models                     |
| `web_search`                                        | Web search (google/searxng/firecrawl/custom) |
| `fetch_url_content`                                 | Extract readable text from URL               |
| `ws_chat` / `ws_authenticate`                       | WebSocket chat + auth                        |

## Storage

| Data           | Location                                                      |
| -------------- | ------------------------------------------------------------- |
| Conversations  | Tauri plugin-store (`sythoria-conversations`)                 |
| Model configs  | App data dir `config.json` (keys in OS keychain)              |
| API keys       | OS keychain (service: `com.sythoria.sythoria-desktop`)        |
| Search configs | Tauri plugin-store + app data dir `search_config.json`        |
| Theme          | Tauri plugin-store (`sythoria-theme`) + localStorage fallback |

## Notes

- **Tailwind v4**: `@theme` directive, `@import "tailwindcss"` — no `tailwind.config.js`
- **Font**: DM Sans (UI), JetBrains Mono (code) via Google Fonts
- **Dark mode default**: checks `sythoria-theme` in localStorage, then `prefers-color-scheme`
- **CSS theming**: `:root` / `.dark` custom properties mapped to Tailwind `@theme` tokens
- **Stream cancellation**: Each stream has a `streamId`; `cancel_chat_stream` aborts mid-stream
- **URL security**: Rust `search/mod.rs` blocks private IPs, metadata endpoints (169.254.169.254), localhost
- **Keychain**: `keyring-core` with platform backends (macOS Keychain, Windows Credential Manager, Linux keyutils)
- **Vite chunks**: `markdown`, `react`, `vendor` manual splits
- **ESLint 9 flat config** in `eslint.config.js`
- **Prettier**: double quotes, 2-space indent, trailing commas, 120 print width
- **TS strict**: `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`
