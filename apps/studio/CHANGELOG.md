# Changelog

## v2.60.0 / Studio 1.0.0 — 2026-03-30

### Added
- Added SplashScreen for initial application load.
- Added notification sounds via `useNotificationSound`.
- Added new IPC handlers and extended `session-service` logic.
- Added renderer tests for `ChatPane` and `Sidebar`.
- Added settings contract and UI for new preferences.

### Changed
- Updated `App.tsx` and core components (`ChatInput`, `ChatPane`, `Sidebar`, `ChatMessage`) with layout and usability improvements.
- Updated `audio_service.py` and `useVoice` hook for better voice handling.
- Enhanced `agent-bridge.ts` and `interview-ui.ts`.

## v2.59.0 / Studio 0.9.9 — 2026-03-30

### Added
- Added built-in `/clear` and `/compact [instructions]` chat commands directly in the Studio composer.
- Added a visible thinking level control in the pane footer, plus Settings support for `low` / `medium` / `high` reasoning levels.
- Added structured runtime `contextUsage` to RPC `get_state`, allowing the UI to show actual context usage instead of rough heuristics.
- Added live compaction state propagation from the agent to the renderer so the UI can show when context compaction is running.
- Added OpenAI Codex CLI auth discovery via `~/.codex/auth.json` for auth availability and token fallback checks.

### Changed
- Permission badge in the pane footer now collapses to icon-only earlier on medium/smaller widths.
- Permission badge colors were remapped: Auto Mode is now yellow, Accept Edits is now green, and Bypass Permissions remains red.
- Model picker now deduplicates versioned/latest model aliases and prefers the latest entry.
- Sidebar session names now recover better from empty names, group sessions more reliably by project, and refresh after generation finishes so auto-named sessions appear automatically.
- Chat input layout was tightened and simplified for a more compact composer layout.
- Chat message spacing and tool-call presentation were refined for denser, more consistent readability.
- Chrome/background theming now uses a dedicated `--color-bg-chrome` token.
- Runtime model availability now reloads auth storage before filtering configured models, so newly-added credentials appear without restarting the agent.

### Fixed
- Fixed Studio context percentage calculation to use structured runtime state rather than guessing from message count and model family.
- Fixed session/project metadata syncing after new-session actions in both local IPC and remote bridge flows.
- Fixed renderer compaction state updates so auto-compaction start/end events are reflected live in the UI.
- Fixed auth status detection for Codex-style OpenAI credentials stored outside the normal Studio auth file.

### Docs
- Updated `apps/studio/README.md` to document context controls.
- Updated `apps/studio/ARCHITECTURE.md` and root `ARCHITECTURE.md` to describe structured context usage and compaction flow.
