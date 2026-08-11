<div align="center">

<h1>
  Sythoria&nbsp;<img src="./src-tauri/icons/128x128.png" alt="Sythoria app icon" width="72" align="center" />
</h1>

<p>
  <a href="https://github.com/sythoria/sythoria-desktop/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/sythoria/sythoria-desktop?style=flat&amp;label=release&amp;color=5865f2" /></a>
  <a href="#installation"><img alt="Supported platforms: Windows, macOS, and Linux" src="https://img.shields.io/badge/platforms-Windows%20%C2%B7%20macOS%20%C2%B7%20Linux-30363d?style=flat&amp;logo=desktop&amp;logoColor=white" /></a>
  <a href="./src/utils/i18n/"><img alt="Six interface languages" src="https://img.shields.io/badge/interface-6%20languages-30363d?style=flat&amp;logo=googletranslate&amp;logoColor=white" /></a>
  <a href="./LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-30363d?style=flat&amp;logo=opensourceinitiative&amp;logoColor=white" /></a>
  <a href="https://github.com/sythoria/sythoria-desktop/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/sythoria/sythoria-desktop?style=flat&amp;label=stars&amp;color=30363d&amp;logo=github" /></a>
</p>

<p>
  <a href="#architecture"><img alt="Tauri 2" src="https://img.shields.io/badge/Tauri-2-30363d?style=flat&amp;logo=tauri&amp;logoColor=24c8db" /></a>
  <a href="#architecture"><img alt="Rust" src="https://img.shields.io/badge/backend-Rust-30363d?style=flat&amp;logo=rust&amp;logoColor=white" /></a>
  <a href="#architecture"><img alt="React 19" src="https://img.shields.io/badge/React-19-30363d?style=flat&amp;logo=react&amp;logoColor=61dafb" /></a>
  <a href="#architecture"><img alt="TypeScript" src="https://img.shields.io/badge/language-TypeScript-30363d?style=flat&amp;logo=typescript&amp;logoColor=3178c6" /></a>
  <a href="./package.json"><img alt="Coverage enabled" src="https://img.shields.io/badge/coverage-enabled-30363d?style=flat&amp;logo=vitest&amp;logoColor=6e9f18" /></a>
  <a href="#security-and-privacy"><img alt="Encrypted local storage" src="https://img.shields.io/badge/storage-encrypted%20locally-30363d?style=flat&amp;logo=lock&amp;logoColor=white" /></a>
</p>

<p><strong>The private desktop interface for local and hosted AI models.</strong></p>

<p>
  Chat with any provider, compare answers side by side, use web and MCP tools, dictate prompts,<br />
  and let agents work safely inside isolated project worktrees.<br />
  Your keys, conversations, and settings stay encrypted on your device. No account, hosted model service, or telemetry.
</p>

<p>
  <a href="https://github.com/sythoria/sythoria-desktop/releases/latest">Download</a> ·
  <a href="#installation">Install</a> ·
  <a href="#features">Features</a> ·
  <a href="#supported-connections">Connections</a> ·
  <a href="#security-and-privacy">Security</a> ·
  <a href="https://sythoria.com/docs">Documentation</a> ·
  <a href="./CONTRIBUTING.md">Contributing</a>
</p>

<br />

<img src="./public/Sythoriascreenshot.png" alt="Sythoria desktop app showing a new AI chat and project workspace" width="100%" />

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

## Security and Privacy

Sythoria operates within the following boundaries:

- **API Keys**: Stored in authenticated local encryption derived from one root key in the operating system credential vault. Decryption stays in Rust, and Sythoria does not sync keys to an external server.
- **Prompt Routing**: The Rust backend connects directly to the provider endpoint you configure.
- **Telemetry**: The application does not collect analytics or tracking data.
- **Workspace Security**: Project edits and commits require explicit user approval unless `full` access is granted. Shell commands always require a native confirmation dialog.
- **Network Boundaries**: Outbound endpoints are strictly validated. Private and local IPs are blocked by default and require an explicit per-provider opt-in.

## Installation

### Linux

Use the universal installer script for Debian, Ubuntu, Fedora, Arch, and other Linux distributions:

```bash
curl -fsSL https://raw.githubusercontent.com/sythoria/sythoria-desktop/main/install.sh | bash
```

For **Windows** and **macOS**, download the latest installer from the [Releases page](https://github.com/sythoria/sythoria-desktop/releases/latest).

## Getting Started

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
