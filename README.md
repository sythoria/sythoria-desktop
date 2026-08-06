<div align="center">
  <img src="https://sythoria.com/logonobg.png" alt="Sythoria Logo" width="120" />

# Sythoria

**The private interface for every model.**

[![Version](https://img.shields.io/badge/version-0.4.2-blue.svg)](https://github.com/sythoria/sythoria-desktop/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](#getting-started)
[![Tech Stack](https://img.shields.io/badge/stack-Tauri%20%7C%20Rust%20%7C%20React%20%7C%20TypeScript-purple.svg)](#architecture)

[Download Latest Release](https://github.com/sythoria/sythoria-desktop/releases/latest) •
[Website](https://sythoria.com) •
[Documentation](https://sythoria.com/docs)
</div>

---

Sythoria is a desktop client for chatting with local and hosted language models. It combines standard chat functionality with model comparison, web and MCP tools, voice input, and project-aware coding workflows.

The application runs on Tauri, with a Rust backend handling provider requests. There is no Sythoria-hosted model service and no telemetry. You must provide your own API credentials or connect to a local Ollama instance.

## Features

- **Multi-Provider Chat**: Stream responses from OpenAI, Anthropic, Gemini, Ollama, NVIDIA NIM, OpenRouter, and custom OpenAI-compatible endpoints.
- **Model Comparison**: Run the same prompt against up to four different models simultaneously in a synchronized view.
- **Agentic Tool Loop**: Provide models with access to web search, page fetching, MCP (Model Context Protocol) servers, and project workspace tools.
- **Project Workspaces**: Grant models `read`, `write`, or `full` access to a designated directory. For Git repositories, file changes are isolated in a temporary worktree, allowing you to review edits before applying them.
- **Artifact Previews**: Render HTML and SVG artifacts in a sandboxed split pane with opt-in network access.
- **Voice & Attachments**: Attach images and files, capture the screen, and dictate using local `whisper.cpp` models or a cloud transcription endpoint.
- **Encrypted Local Storage**: Conversations and configuration files are protected with AES-256-GCM domain-separated encryption.

## Supported Connections

| Capability   | Built-in Options                                                            |
| ------------ | --------------------------------------------------------------------------- |
| **Models**   | OpenAI, Anthropic, Gemini, Ollama, NVIDIA NIM, OpenRouter, custom endpoints |
| **Search**   | Google Custom Search, SearXNG, Firecrawl                                    |
| **Fetching** | Firecrawl, Jina Reader                                                      |
| **MCP**      | `stdio`, `SSE`, and Streamable HTTP transports                              |
| **Voice**    | Local `whisper.cpp` models or cloud endpoints                               |

Model presets can be modified. You can override the endpoint URL, model ID, context size, output limits, temperature, system prompts, and reasoning levels.

## Data Boundaries

Sythoria operates within the following boundaries:

- **API Keys**: Stored in authenticated local encryption derived from one root key in the operating system credential vault. Decryption stays in Rust, and Sythoria does not sync keys to an external server.
- **Prompt Routing**: The Rust backend connects directly to the provider endpoint you configure.
- **Telemetry**: The application does not collect analytics or tracking data.
- **Workspace Security**: Project edits and commits require explicit user approval unless `full` access is granted. Shell commands always require a native confirmation dialog.
- **Network Boundaries**: Outbound endpoints are strictly validated. Private and local IPs are blocked by default and require an explicit per-provider opt-in.

## Getting Started

### Installation (Linux)

Use the universal installer script for Debian, Ubuntu, Fedora, Arch, and other Linux distributions:

```bash
curl -fsSL https://raw.githubusercontent.com/sythoria/sythoria-desktop/main/install.sh | bash
```

For **Windows** and **macOS**, download the latest installer from the [Releases page](https://github.com/sythoria/sythoria-desktop/releases/latest).

### Local Development

#### Requirements

- Node.js 20+ and npm
- Rust stable (`rustup`)
- Git
- Native build dependencies for Tauri (e.g., C++ Build Tools & WebView2 on Windows; Xcode Command Line Tools on macOS; WebKitGTK on Linux). See [CONTRIBUTING.md](CONTRIBUTING.md#local-development-setup) for details.

#### Run the Application

```bash
git clone https://github.com/sythoria/sythoria-desktop.git
cd sythoria-desktop
npm install
npm run tauri dev
```

_Note: Go to **Settings > Models** on first launch to add a provider and select a model. Running `npm run dev` starts the web frontend only and lacks backend integration._

#### Build an Installer

```bash
npm run tauri build
```

## Architecture

```text
InputBar / ChatArea
        |
useChatStore (Zustand)
        +-- Direct Chat -> Tauri Command -> Provider SSE Stream
        +-- Tool Loop   -> Search / Fetch / MCP / Skills / Subagents / Project Tools
                                      |
                              Rust validation and I/O
```

- **Frontend**: React 19 and TypeScript. State is managed by Zustand across distinct stores (Conversations, Models, Search, MCP, Projects, Git, UI, Voice, Capture, Keybinds).
- **Backend**: Rust via Tauri. Manages network requests, SSE/WebSocket parsing, OS keychain access, AES-256-GCM storage, MCP transports, Git worktree boundaries, file I/O, screen capture, and audio recording.

## Development Commands

| Command                      | Purpose                                        |
| ---------------------------- | ---------------------------------------------- |
| `npm run tauri dev`          | Run Vite on port 1420 and open the desktop app |
| `npm run dev`                | Run the frontend only                          |
| `npm run build`              | Type-check and build the frontend              |
| `npm run tauri build`        | Build the native desktop bundles               |
| `npm run test`               | Run the Vitest test suite                      |
| `npm run lint`               | Run ESLint                                     |
| `npm run format:check`       | Check Prettier formatting                      |
| `cd src-tauri && cargo test` | Run the Rust backend tests                     |

## License

Sythoria is available under the [MIT License](LICENSE). Third-party components remain subject to their respective licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
