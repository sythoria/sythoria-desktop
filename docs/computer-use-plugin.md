# Computer Use plugin

The Featured category starts with **Computer Use**, powered by [Open Computer Use](https://github.com/ifuryst/open-codex-computer-use). Existing plugins remain in their functional categories.

## Requirements and setup

The preset pins the npm package to `open-computer-use@0.3.6` and uses its native nine-tool MCP server (`npx -y open-computer-use@0.3.6 mcp`). Sythoria does not invoke the upstream Codex installers or change another client's configuration.

Open Computer Use needs Node.js 18+ with npm, an x86_64 or ARM64 computer, and a signed-in graphical desktop:

- **macOS:** version 14+. Grant Accessibility and Screen Recording to **Open Computer Use**, rather than to Sythoria or Terminal. The package's `doctor` command opens its app-scoped onboarding when permissions are missing and reports their current state. A successful exit alone does not mean permissions are granted. If macOS requests a restart, quit and reopen Open Computer Use before checking again.
- **Linux:** Python 3, PyGObject, AT-SPI2, GTK 3 introspection, and an accessible D-Bus desktop session. On Ubuntu/Debian, install `python3-gi gir1.2-atspi-2.0 gir1.2-gtk-3.0 at-spi2-core`. This setup requires the current session's display, `XDG_RUNTIME_DIR`, and `DBUS_SESSION_BUS_ADDRESS`; it deliberately rejects headless/SSH environments instead of attempting upstream session discovery. Screenshots and coordinate operations remain compositor-dependent on Wayland.
- **Windows:** Windows PowerShell, UI Automation, and a signed-in desktop session. Elevated apps and secure desktop prompts may be inaccessible from an ordinary session.

Opening setup checks local prerequisites without downloading or starting Computer Use. **Set up & check** explicitly prepares the pinned package, validates its native capabilities, and opens macOS onboarding if needed. Connect remains disabled until diagnostics pass. Native connection performs the same checks again, including connections requested from the MCP settings panel. Initial downloads have a bounded two-minute timeout; users can retry after fixing network or permission problems. Setup output is bounded and diagnostics remain in native logs.

Computer Use stays running while connected so element references belong to one MCP session. It is not automatically connected on startup or transparently restarted after a stale connection; reconnect explicitly in Plugins & Apps. On Linux, only the exact bundled command receives the necessary desktop session variables. Other MCP servers retain the existing restricted environment.

After connecting, insert Computer Use from the composer tool menu in the intended chat. The model should list apps, read fresh app state, and use element indices from that state before acting; indices must not be guessed or reused after substantial UI changes. Image-input models are recommended for tasks involving screenshots. App text and screenshots returned by tools may be sent to the selected AI provider. The plugin controls real desktop apps; setup readiness cannot guarantee every application or operating-system protected surface supports automation.

## Research sources

Verified September 30, 2026 against upstream commit `93b817501e0b9fa04fba155face2630bfcd0322e` and the [published npm package](https://www.npmjs.com/package/open-computer-use/v/0.3.6):

- [README: platforms, macOS requirements, MCP configuration](https://github.com/ifuryst/open-codex-computer-use/blob/main/README.md)
- [npm distribution: platforms and runtime dependencies](https://github.com/ifuryst/open-codex-computer-use/blob/main/scripts/npm/build-packages.mjs)
- [Launcher: Node requirements and capabilities JSON](https://github.com/ifuryst/open-codex-computer-use/blob/main/scripts/node-repl/open-computer-use-cli.mjs)
- [macOS doctor: app-scoped permissions](https://github.com/ifuryst/open-codex-computer-use/blob/main/apps/OpenComputerUse/Sources/OpenComputerUse/MacOSAppAgentProxy.swift)
- [Permission diagnostics output](https://github.com/ifuryst/open-codex-computer-use/blob/main/packages/OpenComputerUseKit/Sources/OpenComputerUseKit/Permissions.swift)
- [Linux dependencies and session requirements](https://github.com/ifuryst/open-codex-computer-use/blob/main/apps/OpenComputerUseLinux/runtime.py)
- [Windows runtime dependencies](https://github.com/ifuryst/open-codex-computer-use/blob/main/apps/OpenComputerUseWindows/runtime.ps1)
- [Recommended tool workflow](https://github.com/ifuryst/open-codex-computer-use/blob/main/skills/open-computer-use/SKILL.md)
