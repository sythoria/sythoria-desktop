# Sythoria

Sythoria is a desktop client for chatting with local and hosted language models. It combines everyday chat with model comparison, web and MCP tools, voice input, and project-aware coding workflows.

The app runs on Tauri and talks to providers from the Rust backend. There is no Sythoria-hosted model service: add your own API credentials or connect to a local Ollama instance.

## What it can do

- Stream responses from OpenAI, Anthropic, Gemini, Ollama, NVIDIA NIM, OpenRouter, and custom OpenAI-compatible endpoints.
- Run the same prompt against as many as four models in a synchronized comparison view.
- Give models tools for web search, page fetching, MCP servers, reusable skills, subagents, and project workspaces.
- Read, search, edit, and run commands in a registered project with explicit `read`, `write`, or `full` permissions.
- Preview HTML and SVG artifacts in a sandboxed split pane. Network access is off until you enable it for that preview.
- Attach images and text files, capture the screen, and dictate with local Whisper models or a cloud transcription endpoint.
- Render Markdown, GFM tables, math, highlighted code, reasoning sections, sources, tool calls, and interactive questions.
- Keep separate chats, temporary chats, project chats, pinned conversations, and exported transcripts.

## Connections

| Capability    | Built-in options                                                                   |
| ------------- | ---------------------------------------------------------------------------------- |
| Models        | OpenAI, Anthropic, Google Gemini, Ollama, NVIDIA NIM, OpenRouter, custom endpoints |
| Web search    | Google Custom Search, SearXNG, Firecrawl                                           |
| Page fetching | Firecrawl, Jina Reader                                                             |
| MCP           | stdio, SSE, and Streamable HTTP transports                                         |
| Voice input   | Local `whisper.cpp` models or a configurable cloud endpoint                        |

Model presets are starting points, not a fixed allowlist. You can change the endpoint, model ID, context size, output limit, temperature, system prompt, and reasoning level where the provider supports it.

## Project workspaces

A project connects a conversation to a directory on your machine. The permission level controls which tools are exposed:

- `read` allows listing, globbing, grepping, reading, and Git inspection.
- `write` adds file edits and commits, with confirmation before changes are made.
- `full` adds shell access and removes the extra edit and commit prompt. Shell commands still require native confirmation. Use it only with projects and models you trust.

For a Git repository, Sythoria creates a temporary worktree before the agent loop starts. File changes and commands run there, and the chat shows the pending changes for you to apply or discard. The main working tree is left alone until you apply them.

Non-Git projects still use registered-root checks, canonical path validation, exclusions, permissions, and confirmation gates, but they do not have worktree-based rollback.

If a project contains `AGENTS.md`, its instructions are added to the project conversation automatically.

## Getting started

### Requirements

- Node.js 20 or newer and npm
- Rust stable, installed with `rustup`
- Git
- The native build dependencies required by Tauri on your operating system

Windows needs the Microsoft C++ Build Tools and WebView2. macOS needs the Xcode Command Line Tools. On Linux, install the WebKitGTK and system libraries listed in [CONTRIBUTING.md](CONTRIBUTING.md#local-development-setup).

### Run the desktop app

```bash
git clone https://github.com/sythoria/sythoria-desktop.git
cd sythoria-desktop
npm install
npm run tauri dev
```

On first launch, open **Settings > Models**, add a provider, and select a model. API-backed providers need a key; Ollama can use its local endpoint without one.

`npm run dev` starts only the Vite frontend. Chat, storage, MCP, workspace, capture, and voice features require the Tauri desktop shell.

### Build an installer

```bash
npm run tauri build
```

Tauri is configured to produce NSIS installers on Windows, DMG images on macOS 12+, and AppImages on Linux.

## How it is put together

```text
InputBar / ChatArea
        |
useChatStore
        +-- direct chat -> Tauri command -> provider SSE stream
        +-- tool loop   -> search / fetch / MCP / skills / subagents / project tools
                                      |
                              Rust validation and I/O
```

The frontend is React 19 and TypeScript, with Zustand stores split by feature. Tauri commands handle provider requests, streaming parsers, credential storage, MCP transports, project and Git operations, screen capture, audio, and WebSocket sessions.

| Path                       | Responsibility                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/components/`          | Chat UI, comparison columns, settings, previews, and reusable controls                           |
| `src/store/`               | Conversations, models, search, MCP, projects, Git, UI, voice, capture, keybinds, and skills      |
| `src/services/toolLoop.ts` | Tool definitions, agent steps, confirmations, subagents, and result collection                   |
| `src-tauri/src/`           | Native commands, networking, SSE/WebSocket parsing, keychain, MCP, Git, and workspace boundaries |

Normal chats stream provider output directly into the conversation. When search, MCP, or a project is active, the tool loop sends tool definitions with the request, executes returned calls, records their results, and continues until the model finishes or the configured step limit is reached.

## Local data and security

- Model, search, and MCP credentials are stored through the operating system keychain. MCP environment secrets use the same mechanism.
- Conversations, projects, preferences, and non-secret configuration are stored locally with the Tauri store plugin. Some settings use local storage as a fallback.
- The cloud transcription key is currently saved with the voice configuration in local storage, not in the operating system keychain.
- Imported files are represented by short-lived backend tokens instead of exposing arbitrary paths to the webview.
- Project and Git commands are restricted to registered roots and verified worktrees.
- URL fetching rejects blocked hosts and private-address targets; strict SSL, offline mode, and additional host blocks are configurable.
- Untrusted MCP tools require approval until the server or tool is trusted. Project edits and commits require approval at `write` access; `full` access skips that UI gate, while shell commands retain a native confirmation dialog.
- Artifact previews run in a sandboxed iframe. Their network access is opt-in per open preview.

Requests still leave your machine when you use a hosted model, search provider, MCP service, cloud transcription, update check, or network-enabled artifact. Review each service's data policy before sending sensitive material.

## Development commands

| Command                      | Purpose                                        |
| ---------------------------- | ---------------------------------------------- |
| `npm run tauri dev`          | Run Vite on port 1420 and open the desktop app |
| `npm run dev`                | Run the frontend only                          |
| `npm run build`              | Type-check and build the frontend              |
| `npm run tauri build`        | Build the desktop bundles                      |
| `npm run test`               | Run the Vitest suite once                      |
| `npm run test:watch`         | Run Vitest in watch mode                       |
| `npm run lint`               | Run ESLint                                     |
| `npm run typecheck`          | Run TypeScript without emitting files          |
| `npm run format:check`       | Check Prettier formatting                      |
| `cd src-tauri && cargo test` | Run the Rust tests                             |

For branch conventions, platform setup, and pull request checks, see [CONTRIBUTING.md](CONTRIBUTING.md).
