# Plan #5: Studio Permission Modes And Edit Approval

Plan ID: #5
Generated: 2026-03-28 08:30 CET
Platform: web
Status: draft

## Phases
1. [x] Phase 1: Bidirectional approval RPC and host confirmation — complexity: standard
   - Implement a new approval request/response RPC over the existing JSON-lines channel between agent child process and main process:
     - Agent side: register a `fileChangeApprovalHandler` during agent startup that sends `{ type: 'approval_request', id, action, path, message }` on stdout and awaits a matching `{ type: 'approval_response', id, approved }` from stdin.
     - Wire `headless-ui.ts:startSupervisedStdinReader` to forward `approval_response` messages to resolve the pending promise.
     - Main side: intercept `approval_request` in `AgentBridge.handleLine()`, show a renderer-side modal (not native dialog — Playwright must be able to interact with it), and write the response back to stdin.
   - Add the renderer-side approval modal component: shows action, file path, and diff preview; has Allow/Deny buttons; emits the decision back to main via IPC.
   - Add preload IPC for the approval flow: `onApprovalRequest` event (main → renderer) and `cmd:approval-respond` command (renderer → main).
   - Pass `LUCENT_CODE_PERMISSION_MODE` into agent `extraEnv` at all spawn sites: `index.ts` (pane-0), `pane-manager.ts` (new panes), `server.ts` (headless mode).
   - Ensure the existing `requestFileChangeApproval` calls in `edit.ts` and `write.ts` work end-to-end: no-op in `danger-full-access`, blocks-until-approved in `accept-on-edit`.
   - Files: `packages/pi-coding-agent/src/core/tool-approval.ts`, `src/headless-ui.ts`, `apps/studio/src/main/agent-bridge.ts`, `apps/studio/src/main/ipc-handlers.ts`, `apps/studio/src/main/process-manager.ts`, `apps/studio/src/main/index.ts`, `apps/studio/src/main/pane-manager.ts`, `apps/studio/src/main/server.ts`, `apps/studio/src/preload/index.ts`, new renderer component for the approval modal.
2. [x] Phase 2: Persisted settings, pane propagation, and shortcut toggle — complexity: standard
   - Add `permissionMode: 'danger-full-access' | 'accept-on-edit'` to `AppSettings` in `settings-service.ts` (default: `danger-full-access`).
   - Add validation for `permissionMode` in `settings-contract.ts:validateSettingsPatch`.
   - Expose `permissionMode` through `sanitizeSettingsForRenderer` and the `RendererSettings` type in `preload/index.ts`.
   - On settings change: inject the new `LUCENT_CODE_PERMISSION_MODE` value into each pane's `extraEnv` and call `paneManager.restartPaneAgent()`. Before restarting, abort any in-progress turn and log a warning. After restart, re-read the active session file so session continuity is preserved (existing `attachBridge` → `getState` → `setActiveSessionId` flow).
   - Add a `Cmd+Shift+E` keyboard shortcut to toggle permission mode (avoids `Shift+Tab` conflict with accessibility/form navigation). Register in Electron's accelerator system and forward to renderer.
   - Surface the current permission mode in the StatusBar component (e.g. shield icon with label). Clicking it also toggles.
   - Ensure remote/web bridge panes receive the updated env on next spawn.
   - Files: `apps/studio/src/main/settings-service.ts`, `apps/studio/src/main/settings-contract.ts`, `apps/studio/src/main/ipc-handlers.ts`, `apps/studio/src/main/pane-manager.ts`, `apps/studio/src/main/index.ts`, `apps/studio/src/preload/index.ts`, `apps/studio/src/renderer/src/components/StatusBar.tsx`.
3. [x] Phase 3: Verification, regression coverage, and cleanup — complexity: standard
   - Add unit tests for: settings validation of `permissionMode`, `sanitizeSettingsForRenderer` including the new field, approval RPC serialization/deserialization in AgentBridge.
   - Add integration test: mock agent process sends `approval_request`, verify AgentBridge emits event and correctly writes `approval_response` back on approval/denial.
   - Verify that blocked edit/write operations do not modify files when approval is denied (tool-level test with a mock handler).
   - Verify that approved operations complete normally.
   - Run the relevant Studio main/renderer test suites and fix any regressions.
   - Files: `apps/studio/test/settings-contract.test.ts`, `apps/studio/test/orchestrator.test.ts`, new test file for approval RPC round-trip.

## Acceptance Criteria
- Studio exposes two permission modes: `danger-full-access` and `accept-on-edit`.
- Pressing `Cmd+Shift+E` toggles between those modes and the change persists in settings.
- In `accept-on-edit`, runtime file mutation tools (`edit`, `write`) are blocked until the host confirms via a renderer-side modal.
- The approval modal shows the action, file path, and diff preview with Allow/Deny buttons.
- Declining approval leaves files unchanged and the agent receives an error message.
- The same approval policy applies to text and voice initiated turns (inherent — both use the same tool execution path).
- Existing non-mutating tool behavior remains unchanged.
- Session continuity is preserved across pane restarts triggered by mode changes.

## Verification
Tool: Playwright
Scenarios:
- Permission mode toggle — launch Studio, press `Cmd+Shift+E`, confirm the StatusBar reflects the new mode, reload the app, and confirm the mode persists.
- Edit approval allow path — switch to `accept-on-edit`, trigger a small file edit, confirm the approval modal appears with file path and diff, click Allow, and confirm the file changes land successfully.
- Edit approval deny path — switch to `accept-on-edit`, trigger a file edit, confirm the approval modal appears, click Deny, and confirm the file stays unchanged and the agent reports the block.
- StatusBar click toggle — click the permission mode indicator in the StatusBar, confirm it toggles and persists.

## Review Log
- **2026-03-28 review (pre-build)**: Identified 5 critical/moderate gaps in draft. Updated plan:
  1. Added explicit bidirectional approval RPC design (agent stdout → main → renderer modal → main stdin → agent) to Phase 1.
  2. Changed shortcut from `Shift+Tab` to `Cmd+Shift+E` to avoid accessibility/form-nav conflicts.
  3. Added session continuity handling during pane restart to Phase 2.
  4. Chose renderer-side modal over native dialog for Playwright testability.
  5. Listed all affected files per phase.
  6. Removed redundant voice-parity verification scenario (voice/text share the same tool execution path).
  7. Added `LUCENT_CODE_PERMISSION_MODE` env injection to all agent spawn sites.

---

## Review

Date: 2026-03-28
Reviewer: Opus
Base commit: cae8d4f7a9ec329cddac7b07c73dc3b883724d36
Head commit: ef645ff5
Verdict: PASS

### Findings

**Blocking**

(none)

**Fixed by reviewer**

(none)

**Non-blocking**

- [ ] `apps/studio/src/renderer/src/lib/web-bridge.ts:276` — `onAppShortcut` callback type is missing `'toggle-permission-mode'` from the action union. The method is a no-op stub (returns empty unsubscribe), so no runtime impact, but the type will drift from the preload Bridge type.
- [ ] `packages/pi-coding-agent/src/core/tool-approval.ts` — `pendingApprovals` map entries are never cleaned up on timeout. If the host process crashes mid-approval or the renderer is closed, the pending promise will leak indefinitely. Consider adding a configurable timeout (e.g. 5 minutes) that auto-rejects.
- [ ] `apps/studio/src/main/ipc-handlers.ts` — the `cmd:set-settings` handler restarts all pane agents sequentially when `permissionMode` changes. For many panes this could take several seconds. An `await Promise.all(...)` or at least a log of total elapsed time would improve observability and perceived responsiveness.
- [ ] The approval RPC tests in `approval-rpc.test.ts` use a `MockAgentBridge` rather than the real `AgentBridge` class. While the mock faithfully replicates the parsing logic, a test against the real class (with a mock ChildProcess) would catch future regressions if `handleLine` is refactored.

### Build / Test Status

- Tests: **pass** — all 4 relevant test suites pass (settings-contract: 10/10, approval-rpc: 8/8, tool-approval-integration: 7/7, orchestrator: 15/15).
- TypeScript: 17 errors total, 16 pre-existing. The 1 new error (`orchestrator.ts:328` — `"agent-header"` not assignable to `"text" | "toolCall"`) was introduced by Plan 6 commit `5a62fada`, not by this build.

### Acceptance Criteria

- [x] Studio exposes two permission modes: `danger-full-access` and `accept-on-edit` — implemented in `settings-service.ts` (AppSettings type + defaults), `settings-contract.ts` (validation), `preload/index.ts` (RendererSettings type), and `tool-approval.ts` (runtime check via `getPermissionMode()`).
- [x] Pressing `Cmd+Shift+E` toggles between those modes and the change persists in settings — `index.ts` registers the shortcut via `before-input-event` (guarded by `input.meta`), forwards to renderer as `toggle-permission-mode` action, App.tsx calls `handleTogglePermissionMode` which updates state and calls `bridge.setSettings()`.
- [x] In `accept-on-edit`, runtime file mutation tools (`edit`, `write`) are blocked until the host confirms via a renderer-side modal — `edit.ts` and `write.ts` both call `requestFileChangeApproval()` before writing. In `accept-on-edit` mode, this sends an `approval_request` on stdout, which AgentBridge intercepts and forwards to the renderer. The `ApprovalModal` component shows the request, and the decision is sent back via `cmd:approval-respond` IPC.
- [x] The approval modal shows the action, file path, and diff preview with Allow/Deny buttons — `ApprovalModal.tsx` renders the action label, file path (with `data-testid="approval-modal-path"`), diff preview section, and Allow/Deny buttons with `data-testid` attributes.
- [x] Declining approval leaves files unchanged and the agent receives an error message — `requestFileChangeApproval` throws `"User declined {action} for {path}"` when the handler returns false, which is caught by the tool executor. The `tool-approval-integration.test.ts` tests verify this for both `edit` and `write` tools.
- [x] The same approval policy applies to text and voice initiated turns — both use the same tool execution path (`createEditTool`/`createWriteTool`), which call `requestFileChangeApproval` unconditionally. No separate code paths.
- [x] Existing non-mutating tool behavior remains unchanged — `requestFileChangeApproval` only gates `edit` and `write` tools. Other tools (bash, read, grep, etc.) do not import or call it. The `danger-full-access` mode test confirms the approval handler is bypassed entirely.
- [x] Session continuity is preserved across pane restarts triggered by mode changes — `ipc-handlers.ts:cmd:set-settings` calls `abortCurrentTurn()`, then `restartPaneAgentWithEnv()`, then re-reads state with `getState()` and calls `setActiveSessionId()`.

### Coverage Summary

Three new test files were added:
- `apps/studio/test/settings-contract.test.ts` (10 tests) — validates `permissionMode` setting, `sanitizeSettingsForRenderer` pass-through, and pane root policy.
- `apps/studio/test/approval-rpc.test.ts` (8 tests) — approval request parsing, allow/deny response writing, non-approval event passthrough, headless-ui forwarding, and mock approval handler behavior.
- `apps/studio/test/tool-approval-integration.test.ts` (7 tests) — real `createWriteTool`/`createEditTool` with mock file ops: denied writes leave files untouched, approved writes succeed, `danger-full-access` bypasses approval, and request fields are correct.

All acceptance criteria are met. The implementation is well-structured with clean separation: `tool-approval.ts` handles the agent-side approval logic, `AgentBridge` intercepts and relays requests, the preload/IPC layer bridges to the renderer, and the `ApprovalModal` component provides the user-facing decision UI. The `LUCENT_CODE_PERMISSION_MODE` env is correctly injected at all three spawn sites (index.ts, pane-manager.ts, server.ts).
