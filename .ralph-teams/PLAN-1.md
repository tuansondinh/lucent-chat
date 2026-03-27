# Plan #1: Comprehensive Test Suite for Studio

Plan ID: #1
Generated: 2026-03-27
Updated: 2026-03-27 (v3 compact)
Platform: web
Status: approved

## Overview
Test suite for Studio (Electron + React). Keep `node:test` for main, add vitest for renderer.

**Non-goals:** UI primitives, visual regression, 100% coverage.

## Phases

### Phase 1: Infrastructure + Services — complexity: standard ✅
- [x] Add vitest + @testing-library/react + happy-dom; create Electron mock boundary
- [x] `FileService` — path traversal, TOCTOU symlink swap, binary/unicode/oversized files
- [x] `SessionService` — malformed `.jsonl`, broken symlinks, delete active session
- [x] `AuthService` — token storage, OAuth fail/timeout/concurrent flows
- [x] `GitService` — detached HEAD, nested repos, binary/rename diffs, corrupt repo
- [x] `VoiceService` — Python probe, startup timeout, crash/restart
- [x] `TerminalManager` — global `main` key, idempotent create/destroy, leaked listeners
- [x] `ProcessManager` — crash loops, restart backoff, shutdown during restart

### Phase 2: Orchestrator + Pane + IPC — complexity: standard ✅
- [x] Orchestrator — 8 states (idle→listening→transcribing→queued→generating→speaking→playback_pending→aborted), `followUp` bypass, lock races, abort after `agent_end`
- [x] `PaneManager` — destroy during generation, restart during turn, root change watcher cleanup
- [x] `FileWatchService` — 120ms debounce, root change, watcher failure
- [x] IPC contracts — every `window.bridge` method + `on*`/`off*` event pair, unknown paneId, destroyed window
- [x] Settings/auth — validation, `restartAllAgents()` side effects
- [x] Main entry — startup wiring, app relaunch state persistence

### Phase 3: Renderer — complexity: standard — parallel-group: A
- [ ] Stores: `pane-store`, `file-tree-store` — CRUD, session switch, multi-pane isolation
- [ ] `ChatPane` + `ChatMessage` + `ChatInput` — streaming, disabled states, tool calls
- [ ] `App` — multi-pane create/close/focus, keyboard shortcuts
- [ ] `Sidebar` + `StatusBar` — session list, agent health
- [ ] `FileTree` + `FileViewer` — git status, diff view
- [ ] `Settings` + `Onboarding` — form validation, auth fail UI
- [ ] `Terminal` — xterm wiring, resize
- [ ] Event listener cleanup on unmount

### Phase 4: CI + Coverage — complexity: simple
- [ ] Parallel test execution, coverage gates (80% branch services, 100% IPC contract)
- [ ] Document Electron mock boundary, smoke scenarios

## Acceptance Criteria
- [ ] 80%+ branch coverage on main services
- [ ] 100% IPC contract coverage (methods + events)
- [ ] All 8 Orchestrator states + races tested
- [ ] Pane lifecycle races tested
- [ ] CI runs without Electron runtime

## Verification
Tool: Playwright (Electron mode)
- [Launch → Chat → Response]
- [Multi-pane create/close]
- [Session switch during generation]
- [App relaunch → restored state]
