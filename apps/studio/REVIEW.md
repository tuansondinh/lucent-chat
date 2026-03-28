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

### P1: Skill execution was wired to orchestrator events that were never emitted

`cmd:skill-execute` waits for `pane.orchestrator` to emit `'chunk'` and `'done'` in order to resolve each skill step:

- [`apps/studio/src/main/ipc-handlers.ts:394`](/Users/sonwork/Workspace/voice-bridge-desktop/apps/studio/src/main/ipc-handlers.ts#L394)
- [`apps/studio/src/main/ipc-handlers.ts:408`](/Users/sonwork/Workspace/voice-bridge-desktop/apps/studio/src/main/ipc-handlers.ts#L408)
- [`apps/studio/src/main/ipc-handlers.ts:411`](/Users/sonwork/Workspace/voice-bridge-desktop/apps/studio/src/main/ipc-handlers.ts#L411)

But `Orchestrator` only calls callback hooks such as `callbacks.onChunk(...)` and `callbacks.onDone(...)`; it does not emit matching EventEmitter events:

- [`apps/studio/src/main/orchestrator.ts:151`](/Users/sonwork/Workspace/voice-bridge-desktop/apps/studio/src/main/orchestrator.ts#L151)
- [`apps/studio/src/main/orchestrator.ts:235`](/Users/sonwork/Workspace/voice-bridge-desktop/apps/studio/src/main/orchestrator.ts#L235)

Impact:

- The promise created for a skill step never resolves.
- Any slash skill can hang indefinitely on its first step.
- The UI can show a running skill that never completes.

Implemented fix:

- Either emit orchestrator-level `'chunk'` and `'done'` events alongside the existing callbacks, or
- Change skill execution to hook into a completion path that actually exists.

## Notes

- I ran `npm run test:all` in `apps/studio`. The suite is already red in several unrelated areas, so these findings were established primarily by code inspection rather than by a clean test baseline.
