# Stores

Keep Zustand stores and their tests in the folder that owns the state domain.

- `chat/` owns conversations and conversation lifecycle transitions.
- `providers/` owns model, search, and MCP connection state.
- `workspace/` owns project, Git, and knowledge state.
- `ui/` owns application view and keyboard shortcut state.
- `platform/` owns appshot, skill, and Whisper state.
- `shared/` holds helpers that coordinate more than one store.

Keep each store's tests beside it.
