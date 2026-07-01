# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.3.0] - 2026-07-01

### Added

- **Multi-Model Comparison Grid Mode**: Generalize comparative responses to support up to 4 parallel compared model columns side-by-side with scrollbar synchronization.
- **Split-Screen Workspace Preview**: Active split view displaying chat messages on the left and interactive web/code preview on the right when an artifact is open.
- **Git Worktree Sandbox Isolation**: Divert file changes and terminal tool commands to an isolated temporary Git worktree with staging, change review, and direct workspace Apply/Discard operations.
- **Interactive Clarifying Questions**: Support parsing `<question>` XML blocks in LLM outputs to render interactive cards, allowing users to pick an option that automatically replies to the model.

---

## [0.2.0] - 2026-06-25

### Added

- **Privacy Section in Settings**: Toggle log buffering and diagnostic storage features for improved user data control.
- **Spotlight Window Configuration**: Spotlight capabilities and window properties for fast keyboard activation.
- **Workspace-Restricted Git Commands**: Checkouts, diffs, and commits are restricted to the active workspace registry.
- **FileTokenRegistry**: Secure file path lookup and read/write security boundary delegating access verification to the Tauri backend.

### Fixed

- Sanitized highlighted code outputs using DOMPurify.
- Resolved meta GCP/AWS metadata endpoint lookup validation vulnerabilities in URL fetchers.

---

## [0.1.0] - 2026-06-01

### Added

- Initial release of Sythoria desktop chat application.
- Support for OpenAI-compatible APIs, local Ollama endpoints, and provider presets.
- Web search engines (Google, SearXNG, Firecrawl) and MCP server stdio integration.
- Custom system prompt overrides, app shots capture plugin, and OS keychain API key storage.
