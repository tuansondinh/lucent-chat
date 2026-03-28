# Plan #5: Studio Permission Modes And Edit Approval

Plan ID: #5
Generated: 2026-03-28 08:30 CET
Platform: web
Status: draft

## Phases
1. [ ] Phase 1: Bidirectional approval RPC and host confirmation — complexity: standard
   - Implement a new approval request/response RPC over the existing JSON-lines channel between agent child process and main process:
     - Agent side: register a `fileChangeApprovalHandler` during agent startup that sends `{ type: 'approval_request', id, action, path, message }` on stdout and awaits a matching `{ type: 'approval_response', id, approved }` from stdin.
     - Wire `headless-ui.ts:startSupervisedStdinReader` to forward `approval_response` messages to resolve the pending promise.
     - Main side: intercept `approval_request` in `AgentBridge.handleLine()`, show a renderer-side modal (not native dialog — Playwright must be able to interact with it), and write the response back to stdin.
   - Add the renderer-side approval modal component: shows action, file path, and diff preview; has Allow/Deny buttons; emits the decision back to main via IPC.
   - Add preload IPC for the approval flow: `onApprovalRequest` event (main → renderer) and `cmd:approval-respond` command (renderer → main).
   - Pass `GSD_STUDIO_PERMISSION_MODE` into agent `extraEnv` at all spawn sites: `index.ts` (pane-0), `pane-manager.ts` (new panes), `server.ts` (headless mode).
   - Ensure the existing `requestFileChangeApproval` calls in `edit.ts` and `write.ts` work end-to-end: no-op in `danger-full-access`, blocks-until-approved in `accept-on-edit`.
   - Files: `packages/pi-coding-agent/src/core/tool-approval.ts`, `src/headless-ui.ts`, `apps/studio/src/main/agent-bridge.ts`, `apps/studio/src/main/ipc-handlers.ts`, `apps/studio/src/main/process-manager.ts`, `apps/studio/src/main/index.ts`, `apps/studio/src/main/pane-manager.ts`, `apps/studio/src/main/server.ts`, `apps/studio/src/preload/index.ts`, new renderer component for the approval modal.
2. [ ] Phase 2: Persisted settings, pane propagation, and shortcut toggle — complexity: standard
   - Add `permissionMode: 'danger-full-access' | 'accept-on-edit'` to `AppSettings` in `settings-service.ts` (default: `danger-full-access`).
   - Add validation for `permissionMode` in `settings-contract.ts:validateSettingsPatch`.
   - Expose `permissionMode` through `sanitizeSettingsForRenderer` and the `RendererSettings` type in `preload/index.ts`.
   - On settings change: inject the new `GSD_STUDIO_PERMISSION_MODE` value into each pane's `extraEnv` and call `paneManager.restartPaneAgent()`. Before restarting, abort any in-progress turn and log a warning. After restart, re-read the active session file so session continuity is preserved (existing `attachBridge` → `getState` → `setActiveSessionId` flow).
   - Add a `Cmd+Shift+E` keyboard shortcut to toggle permission mode (avoids `Shift+Tab` conflict with accessibility/form navigation). Register in Electron's accelerator system and forward to renderer.
   - Surface the current permission mode in the StatusBar component (e.g. shield icon with label). Clicking it also toggles.
   - Ensure remote/web bridge panes receive the updated env on next spawn.
   - Files: `apps/studio/src/main/settings-service.ts`, `apps/studio/src/main/settings-contract.ts`, `apps/studio/src/main/ipc-handlers.ts`, `apps/studio/src/main/pane-manager.ts`, `apps/studio/src/main/index.ts`, `apps/studio/src/preload/index.ts`, `apps/studio/src/renderer/src/components/StatusBar.tsx`.
3. [ ] Phase 3: Verification, regression coverage, and cleanup — complexity: standard
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
  7. Added `GSD_STUDIO_PERMISSION_MODE` env injection to all agent spawn sites.
