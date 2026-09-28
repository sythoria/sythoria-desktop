# Components

Component files are grouped by the part of the app they serve. Keep tests next to the component they cover.

- `chat/` contains the main conversation, composer, comparison, and response components.
- `workspace/` contains the auxiliary panel, project review, file tree, and workspace change components.
- `layout/` contains the application shell, navigation, start screen, and title bar.
- `overlays/` contains global command and project/link dialogs.
- `settings/` contains settings sections and settings-only controls.
- `ui/` contains reusable interface primitives shared across the app.

Place a new component in the narrowest folder that matches its responsibility. Promote it to `ui/` when it is genuinely shared across unrelated parts of the app.
