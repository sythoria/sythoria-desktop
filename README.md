# Sythoria 🚀

Sythoria is a premium, desktop-native AI chat client and agent workspace. Built with **Tauri v2 (Rust)** and **React 19 (TypeScript)**, Sythoria delivers a secure, local, and visually stunning workspace for connecting to local and cloud-based LLM APIs.

Unlike generic chat clients, Sythoria is built for developers, incorporating advanced agentic sandboxing, comparative model grids, and interactive side-by-side web artifacts.

---

## Key Features 🌟

- **Multi-Model Comparison Grid Mode**: Compare responses from up to 4 LLMs side-by-side. Includes synchronized scrolling across all virtualized viewports so you can easily review different model generations.
- **Git Worktree Sandbox Isolation**: Securely execute file-modifying tools and agent instructions. Sythoria spawns an isolated Git worktree under your system's temp directory, letting you inspect changes and view diff cards before applying or discarding them.
- **Split-Screen Web Preview (Artifacts)**: A Claude-like side-by-side preview panel. Prompt on the left and see interactive HTML, CSS, JavaScript, or Markdown artifacts rendered instantly on the right.
- **Interactive Clarifying Questions**: Supports structured `<question>` XML blocks in model outputs, rendering clean radio option cards. Click to answer, and Sythoria handles the prompt submission automatically.
- **Model Presets & Secure Keychain**: Supports OpenAI, Anthropic, Gemini, Ollama, OpenRouter, and custom endpoints. All API keys and environment secrets are encrypted and stored in your operating system's native keychain.
- **Agentic Tool Loop (Web Search + MCP)**: Run complex multi-step agent loops. Integrates web search (Google, SearXNG, Firecrawl), webpage readers, and Std/SSE/HTTP Model Context Protocol (MCP) servers.
- **Advanced Logging & Privacy Controls**: Monitor app behavior using the real-time Settings Log Viewer. Complete data security features allow you to toggle data writes and local log histories.

---

## Architecture & Technology Stack 🛠️

- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Motion (Framer Motion)
- **State Management**: Zustand (5 decoupled stores for Chat, Models, Search, MCP, and UI)
- **Virtualized Rendering**: React Virtuoso (handles thousands of messages efficiently)
- **Backend**: Tauri v2, Rust (tokio, keyring-core, rmcp for MCP servers, scraper)
- **Theming**: Curated HSL color palette mapping, default dark mode, responsive panels

---

## Getting Started 💻

### Prerequisites

- **Node.js**: v20 or newer
- **Rust**: Stable toolchain (cargo, rustc)
- **Git**

### Installation

1.  Clone the repository:

    ```bash
    git clone https://github.com/sythoria/sythoria-desktop.git
    cd sythoria-desktop
    ```

2.  Install dependencies:

    ```bash
    npm install
    ```

3.  Run the application in development mode:
    ```bash
    npm run tauri dev
    ```

### Available Commands

| Command                      | Purpose                                                      |
| :--------------------------- | :----------------------------------------------------------- |
| `npm run tauri dev`          | Launch the app in Tauri development window (Vite, port 1420) |
| `npm run tauri build`        | Compile the production-ready Tauri desktop bundle            |
| `npm run dev`                | Launch the web frontend server only (without Tauri shell)    |
| `npm run build`              | Compile the frontend static build (`tsc && vite build`)      |
| `npm run test`               | Run frontend tests (Vitest + JSDOM)                          |
| `npm run lint`               | Run ESLint check                                             |
| `npm run typecheck`          | Run TypeScript check (`tsc --noEmit`)                        |
| `npm run format:check`       | Prettier formatter verification                              |
| `cd src-tauri && cargo test` | Run Rust unit tests                                          |

---

## Contributing 🤝

We welcome contributions from the community! To contribute:

1.  **Fork** the repository and create your feature branch:
    ```bash
    git checkout -b feature/amazing-feature
    ```
2.  **Commit** your changes following semantic guidelines. Sythoria uses Husky and `lint-staged` to enforce code formatting (`prettier`) and linting (`eslint --fix`) rules automatically on commit.
3.  **Test** your changes locally:
    - Make sure typescript compiles: `npm run typecheck`
    - Run tests: `npm run test` and `cd src-tauri && cargo test`
4.  **Push** to your branch and open a **Pull Request** explaining your implementation details.

---

## License 📄

This project is licensed under the MIT License - see the LICENSE file for details.
