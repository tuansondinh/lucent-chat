# Studio Review

Date: 2026-03-28

Scope: `apps/studio`

## Assumptions

- Remote/PWA clients having full filesystem access is intentional. Based on that clarification, I am not treating unrestricted remote `set-pane-root` as a correctness bug.
- This review is focused on Studio, not the entire monorepo.

## Findings

Status: resolved in the current working tree.

### P1: Remote bridge exposed raw settings and bypassed validation

The Electron IPC path sanitizes settings for the renderer and validates incoming writes:

- [`apps/studio/src/main/ipc-handlers.ts:174`](/Users/sonwork/Workspace/voice-bridge-desktop/apps/studio/src/main/ipc-handlers.ts#L174)
- [`apps/studio/src/main/ipc-handlers.ts:178`](/Users/sonwork/Workspace/voice-bridge-desktop/apps/studio/src/main/ipc-handlers.ts#L178)
- [`apps/studio/src/main/ipc-handlers.ts:472`](/Users/sonwork/Workspace/voice-bridge-desktop/apps/studio/src/main/ipc-handlers.ts#L472)

The remote bridge does not. It returns `settingsService.get()` directly and persists `settingsService.save(...)` directly:

- [`apps/studio/src/main/index.ts:329`](/Users/sonwork/Workspace/voice-bridge-desktop/apps/studio/src/main/index.ts#L329)
- [`apps/studio/src/main/index.ts:330`](/Users/sonwork/Workspace/voice-bridge-desktop/apps/studio/src/main/index.ts#L330)
- [`apps/studio/src/main/server.ts:102`](/Users/sonwork/Workspace/voice-bridge-desktop/apps/studio/src/main/server.ts#L102)
- [`apps/studio/src/main/server.ts:103`](/Users/sonwork/Workspace/voice-bridge-desktop/apps/studio/src/main/server.ts#L103)

Impact:

- PWA clients can read secrets such as `tavilyApiKey`.
- Remote callers can write settings payloads that the desktop path would reject.
- The remote and Electron trust models diverge for the same logical API.

Implemented fix:

- Route remote `get-settings` through the same sanitization used by Electron.
- Route remote `set-settings` through the same validation path before saving.

### P1: Skill execution was wired to orchestrator events that were never emitted (RESOLVED)

**Status: Resolved by skill system simplification**

The skill system previously used `cmd:skill-execute` IPC handler with `SkillExecutor` and `SkillRegistry` classes for multi-step execution with progress tracking. This has been removed and replaced with a simpler approach:

**What was removed:**
- `SkillRegistry` class (main process) — no longer validates or registers skills
- `SkillExecutor` class (main process) — no longer chains steps or emits progress events
- `SkillProgressBlock` component (renderer) — no longer renders skill progress UI
- `cmd:skill-execute` and `cmd:skill-abort` IPC handlers
- `SkillBlock` and `SkillStepState` types from renderer store
- Store actions: `addSkillBlock`, `updateSkillStep`, `finalizeSkillBlock`
- Preload bridge methods: `skillExecute`, `skillAbort`, `onSkillProgress`, `onSkillComplete`
- Multi-step skill execution and progress event wiring

**What changed:**
- Skills are now discovered at runtime via `cmd:skill-list` which scans `~/.lc/agent/skills/` (global) and `.lc/skills/` (project-local) directly via filesystem
- `/skill-name` in chat is sent as a regular message to the agent
- The agent handles skill invocation via the Skill tool (in `packages/pi-coding-agent/src/core/skills.ts`)
- User-facing config directory renamed from `.pi` to `.lc` (piConfig in `packages/pi-coding-agent/package.json`)

**What still works:**
- Skill autocomplete dropdown in ChatInput (floats above input with max-height)
- Skills section in CommandPalette (Cmd+K) — sends `/skill-name` messages
- Skills tab in Settings — sources from `cmd:skill-list`
- Bundled skills in `src/resources/skills/` and `apps/studio/src/resources/skills/`

**Impact:**
- Simplified architecture with no complex event-waiting or step-chaining in main process
- Skills are now handled entirely by the agent's LLM reasoning and tooling system
- Reduced complexity: no state machines, no progress tracking, no orchestrator integration
- User-facing skill discovery and invocation unchanged

## Notes

- I ran `npm run test:all` in `apps/studio`. The suite is already red in several unrelated areas, so these findings were established primarily by code inspection rather than by a clean test baseline.
