# AGENTS.md — Sythoria Codebase Guide

## Project Overview

Sythoria is a desktop AI chat application built with **Tauri v2** (Rust backend) and **React 19** (TypeScript frontend). It connects to OpenAI-compatible API endpoints (OpenAI, Anthropic, Google Gemini, Ollama, NVIDIA NIM, OpenRouter, or custom) and supports both HTTP streaming (SSE) and WebSocket-based chat with automatic reconnection. Conversations and model configurations are persisted locally.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript 5.8, Vite 7 |
| Styling | Tailwind CSS 4 (via `@tailwindcss/vite` plugin), CSS custom properties for theming, glassmorphism effects |
| Markdown Rendering | `react-markdown` + `remark-gfm` |
| Icons | `lucide-react` |
| Desktop Shell | Tauri v2 (`@tauri-apps/api`, `@tauri-apps/cli`) |
| Backend (Rust) | `tokio` (async runtime), `reqwest` (HTTP client with streaming), `tokio-tungstenite` (WebSocket), `serde`/`serde_json`, `chrono`, `uuid` |
| Fonts | Inter (UI), JetBrains Mono (code blocks) — loaded via Google Fonts |

## Directory Structure

```
Sythoria/
├── index.html                 # Vite entry HTML — loads fonts, mounts #root
├── package.json               # Node scripts & dependencies
├── vite.config.ts             # Vite config: React plugin, Tailwind plugin, Tauri dev server (port 1420)
├── tsconfig.json              # TypeScript config (ES2020, strict, react-jsx)
├── tsconfig.node.json         # TS config for Node/Vite files
├── public/                    # Static assets served by Vite
│   ├── tauri.svg
│   └── vite.svg
├── dist/                      # Built frontend output (gitignored in practice)
├── src/                       # ── FRONTEND (React + TypeScript) ──
│   ├── main.tsx               # React entry point — initializes theme, renders <App />
│   ├── App.tsx                # Root component — all state management, event listeners, chat logic
│   ├── App.css                # (Unused/legacy)
│   ├── index.css              # Global styles — Tailwind import, CSS custom properties (light/dark themes),
│   │                          #   animations, glassmorphism utilities, markdown-body styles
│   ├── vite-env.d.ts          # Vite type declarations
│   ├── assets/
│   │   └── react.svg
│   ├── types/
│   │   └── index.ts           # Core TypeScript types (Message, Conversation, ModelConfig, ConnectionStatus)
│   │                          #   + config persistence helpers (loadModelConfigs, saveModelConfigs)
│   ├── hooks/
│   │   └── useWebSocket.ts    # Hook for WebSocket chat via Tauri invoke (currently uses ConnectionContext)
│   ├── contexts/              # React Context providers (available but NOT wired into App.tsx currently)
│   │   ├── ChatContext.tsx     # ChatProvider — conversation CRUD, localStorage persistence
│   │   ├── ConnectionContext.tsx # ConnectionProvider — WebSocket connection status via Tauri events
│   │   └── UIContext.tsx       # UIProvider — view state, sidebar, theme toggling
│   └── components/
│       ├── Sidebar.tsx        # Left sidebar — conversation list, search, grouping by date, delete/rename
│       ├── ChatArea.tsx       # Main chat display — message bubbles, markdown rendering, streaming cursor,
│       │                      #   empty state with suggestion cards, connection status indicator
│       ├── InputBar.tsx       # Bottom input bar — auto-resizing textarea, model selector dropdown, send button
│       ├── Settings.tsx       # Settings page — dark mode toggle, model management (add/edit/delete),
│       │                      #   provider presets (OpenAI, Anthropic, Gemini, Ollama, NVIDIA NIM, OpenRouter),
│       │                      #   API key management (show/hide), temperature slider
│       ├── StartScreen.tsx    # Welcome/onboarding screen shown on first launch
│       └── ui/
│           └── Modal.tsx      # Reusable modal components: Modal, ConfirmModal, RenameChatModal
├── src-tauri/                 # ── BACKEND (Rust / Tauri) ──
│   ├── Cargo.toml             # Rust dependencies (tauri 2, reqwest, tokio, tokio-tungstenite, serde, etc.)
│   ├── build.rs               # Tauri build script
│   ├── tauri.conf.json        # Tauri config — app identifier, window size (1440×900), CSP, build commands
│   ├── icons/                 # App icons for all platforms (png, ico, icns)
│   ├── gen/                   # Auto-generated Tauri schemas
│   └── src/
│       ├── main.rs            # Rust entry point — calls sythoria_lib::run()
│       ├── lib.rs             # Core Tauri commands:
│       │                      #   - load_config: reads config.json from app data dir
│       │                      #   - save_config: writes config.json to app data dir
│       │                      #   - chat_completion: non-streaming OpenAI-compatible API call
│       │                      #   - chat_stream: SSE streaming — emits "chat-stream-chunk" / "chat-stream-done"
│       │                      #   - ws_chat: WebSocket chat with reconnection (delegates to ws_handler)
│       │                      #   - ws_authenticate: HTTP auth endpoint for WebSocket servers
│       │                      #   - run(): Tauri builder, registers all commands
│       └── ws_handler.rs      # WebSocket connection handler:
│                              #   - WsConfig, ChatWsMessage, TypingEvent, WsEvent types
│                              #   - SessionManager: session tracking with broadcast events
│                              #   - WebSocketConnection: exponential backoff reconnection (1s–30s, max 5 retries)
│                              #   - ws_chat_stream: main WS loop with auth/config frames, 30s timeout
│                              #   - send_typing_event: sends typing indicator frames
│                              #   - Unit tests for serialization, backoff, session management
```

## Architecture

### Frontend-Backend Communication

The frontend communicates with the Rust backend exclusively through **Tauri's IPC**:

1. **`invoke()` calls** — Frontend calls Rust commands directly:
   - `invoke("chat_stream", { apiUrl, apiKey, model, messages, temperature })` — Starts an SSE stream
   - `invoke("load_config")` / `invoke("save_config", { config })` — Config persistence
   - `invoke("ws_chat", { url, apiKey, model })` — WebSocket chat
   - `invoke("ws_authenticate", { username, apiKey, serverUrl })` — Authentication

2. **Tauri events** — Rust emits events that the frontend listens to via `listen()`:
   - `chat-stream-chunk` — SSE chunk received (string payload)
   - `chat-stream-done` — Stream finished
   - `ws-message` — WebSocket message received
   - `ws-connected` / `ws-closed` / `ws-error` / `ws-reconnecting` — Connection lifecycle

### State Management

Currently, **all state lives in `App.tsx`** using React `useState` hooks. The `contexts/` directory defines `ChatProvider`, `ConnectionProvider`, and `UIProvider` but they are **not yet wired into the component tree**. App.tsx manages:

- `conversations: Conversation[]` — All chat conversations (persisted to `localStorage` under `sythoria-conversations`)
- `activeId: string | null` — Currently selected conversation
- `models: ModelConfig[]` — Model endpoint configs (persisted to Tauri app data dir via `load_config`/`save_config`)
- `selectedModel: string` — Active model ID
- `temperature: number` — Generation temperature (0–2)
- `connectionStatus: ConnectionStatus` — WebSocket connection state
- `isStreaming: boolean` — Whether an SSE response is in progress
- `view: "chat" | "settings"` — Current view
- `sidebarOpen: boolean` — Mobile sidebar toggle
- Rename modal state

### Data Flow (SSE Streaming)

1. User types message → `InputBar` calls `onSend(text)`
2. `App.handleSend` creates user + assistant messages, sets `isStreaming=true`
3. Calls `invoke("chat_stream", ...)` which hits the OpenAI-compatible API
4. Rust reads the SSE stream, emits `chat-stream-chunk` events with content deltas
5. Frontend listens via `listen("chat-stream-chunk")`, appends content to assistant message
6. On `chat-stream-done`, marks `isStreaming=false` and finalizes the message

### Theme System

- **CSS custom properties** defined in `index.css` under `:root` (light) and `.dark` (dark)
- Dark mode class toggled on `<html>` element
- Theme persisted to `localStorage` under `"theme"` key
- Glassmorphism utility classes: `.glass-panel`, `.glass-sidebar`
- Custom Tailwind theme tokens: `--color-accent`, `--color-chat`, `--color-surface`, etc.

### Config Persistence

- **Model configs**: Stored in Tauri's app data directory as `config.json` (via Rust `load_config`/`save_config` commands)
- **Conversations**: Stored in browser `localStorage` under key `sythoria-conversations`
- **Theme**: Stored in `localStorage` under key `"theme"`

## Commands

```bash
# Development (starts Vite dev server + Tauri window)
npm run tauri dev

# Build for production
npm run tauri build

# Frontend only (without Tauri)
npm run dev          # Vite dev server on port 1420
npm run build        # TypeScript check + Vite build
npm run preview      # Preview production build
```

## Testing

### Rust Backend

Tests are in `src-tauri/src/ws_handler.rs` as `#[cfg(test)]` module:

```bash
cd src-tauri && cargo test
```

Tests cover:
- `ChatWsMessage` serialization/deserialization
- `WsConfig` serialization (with and without API key)
- `TypingEvent` serialization
- `WsEvent` factory methods
- Backoff calculation logic
- Reconnection decision logic
- `SessionManager` CRUD operations

### Frontend

No test framework is currently configured. There are no frontend tests.

## Linting & Type Checking

- **TypeScript strict mode** is enabled (`strict: true`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`)
- No ESLint or Prettier config present — add if needed
- Run type check: `npx tsc --noEmit`

## Key Types (`src/types/index.ts`)

```typescript
interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
}

interface Conversation {
  id: string;
  title: string;
  timestamp: Date;
  messages: Message[];
  model: string;  // ModelConfig.id
}

interface ModelConfig {
  id: string;
  name: string;
  apiBase: string;   // Full API URL (e.g., https://api.openai.com/v1/chat/completions)
  apiKey: string;    // Can be empty for local models (Ollama)
  modelId: string;   // Model identifier (e.g., gpt-4o, claude-3-5-sonnet-20240620)
  provider?: string; // Provider preset label
}

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";
```

## Provider Presets (in Settings.tsx)

| Provider | API Base | Default Model |
|---|---|---|
| OpenAI | `https://api.openai.com/v1/chat/completions` | `gpt-4o` |
| Anthropic | `https://api.anthropic.com/v1/messages` | `claude-3-5-sonnet-20240620` |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions` | `gemini-2.5-pro` |
| Ollama (Local) | `http://localhost:11434/v1/chat/completions` | `llama3.1` |
| NVIDIA NIM | `https://integrate.api.nvidia.com/v1/chat/completions` | `meta/llama-3.3-70b-instruct` |
| OpenRouter | `https://openrouter.ai/api/v1/chat/completions` | `anthropic/claude-3.5-sonnet` |
| Custom | (user-defined) | (user-defined) |

## Tauri Commands (Rust → Frontend)

| Command | Parameters | Returns | Description |
|---|---|---|---|
| `load_config` | (none, uses AppHandle) | `String` | Reads `config.json` from app data dir |
| `save_config` | `config: String` | `()` | Writes JSON config to app data dir |
| `chat_completion` | `api_url, api_key, model, messages, temperature` | `String` | Non-streaming chat completion |
| `chat_stream` | `api_url, api_key, model, messages, temperature` + AppHandle | `String` | SSE streaming (emits `chat-stream-chunk` / `chat-stream-done`) |
| `ws_chat` | `url, api_key, model` + AppHandle | `String` | WebSocket chat with auto-reconnect |
| `ws_authenticate` | `username, api_key, server_url` | `String` | Authenticates with a WS server |

## Important Notes for Agents

- **App.tsx is the monolith**: All state, event listeners, and core logic live in `App.tsx` (~420 lines). The `contexts/` directory has extracted providers but they are **not connected** yet.
- **Two chat modes**: SSE streaming (`chat_stream` command, used for standard OpenAI-compatible APIs) and WebSocket (`ws_chat` command, used for real-time WS servers). The SSE path is the primary/working flow.
- **No routing library**: View switching (`chat` | `settings`) is managed via simple state in App.tsx.
- **No state management library**: Pure React state + localStorage. The context providers in `contexts/` are a step toward extraction but unused.
- **Tauri CSP is disabled** (`"csp": null` in tauri.conf.json) — be cautious if re-enabling.
- **The `useWebSocket` hook** exists but is not actively used in the main chat flow — SSE streaming via `invoke("chat_stream")` is the primary mechanism.
- **Conversation IDs** are generated with `crypto.randomUUID().slice(0, 8)` — 8-character truncated UUIDs.
- **Dark mode is default**: The app checks `localStorage` first, then `prefers-color-scheme`, defaulting to dark.
- **Tailwind v4**: Uses the new `@theme` directive and `@import "tailwindcss"` syntax — not the classic `tailwind.config.js` approach.
- **No CI/CD config** is present in the repository.
