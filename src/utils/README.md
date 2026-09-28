# Utilities

Keep pure helpers and their tests in the narrowest matching domain folder.

- `attachments/` handles attachment parsing and serialization.
- `conversations/` handles message helpers plus conversation import/export.
- `formatting/` handles display formatting, highlighting, and token estimates.
- `i18n/` owns locale dictionaries and the translation hook.
- `network/` handles URL, endpoint, and API error helpers.
- `security/` handles redaction and input validation.
- `storage/` bridges encrypted persistence and migrations.
- `system/` holds IDs, logging, debounce, and scroll locking.
- `workspace/` handles project links, diffs, and workspace change summaries.

Keep tests next to the utility they cover.
