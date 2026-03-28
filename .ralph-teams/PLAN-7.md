# Plan #7: Auto Mode — Classifier-Based Permission System

Plan ID: #7
Generated: 2026-03-28
Platform: web
Status: draft

## Phases

1. [x] Phase 1: Types, RPC Protocol, and Settings — complexity: standard
   - Extend `PermissionMode` type to include `'auto'` in `tool-approval.ts`
   - Update `getPermissionMode()` to recognize `'auto'` from `GSD_STUDIO_PERMISSION_MODE` env var
   - Add `classifier_request` stdout event type and `classifier_response` stdin type to `rpc-types.ts`
   - Add `handleInputLine()` clause in `rpc-mode.ts` for `classifier_response` → calls `resolveClassifierResponse()`
   - Add `registerStdioClassifierHandler()` and `resolveClassifierResponse()` to `tool-approval.ts` (mirrors approval pattern)
   - Add `requestClassifierDecision({ toolName, toolCallId, args }): Promise<boolean>` with 15s timeout (auto-deny on timeout)
   - Register classifier handler in `rpc-mode.ts` when mode is `'auto'`
   - Update `AppSettings.permissionMode` to include `'auto'` in `settings-service.ts`
   - Add `autoModeRules` field to `AppSettings` with default rules (git/npm allow, rm/sudo/chmod deny)
   - Update `validateSettingsPatch()` in `settings-contract.ts` to accept `'auto'` and validate `autoModeRules`
   - Update `PaneRuntime.permissionMode` type in `pane-manager.ts` to include `'auto'`
   - Update `togglePanePermissionMode()` to cycle through three states: danger-full-access → accept-on-edit → auto
   - Update renderer `pane-store.ts` permissionMode type to include `'auto'`

2. [x] Phase 2: Agent-Side beforeToolCall Gate — complexity: standard
   - Define `READ_ONLY_TOOLS` set (`read`, `grep`, `find`, `ls`, `lsp`, `hashline_read`) and `MUTATING_TOOLS` set (`bash`, `edit`, `write`, `hashline_edit`) in `tool-approval.ts`
   - Extend `_installAgentToolHooks()` in `agent-session.ts`: after existing extension hook, check `getPermissionMode() === 'auto'`
   - Read-only tools → return `undefined` (auto-approve, no classifier)
   - Mutating tools → call `requestClassifierDecision()`, if denied return `{ block: true, reason }`
   - Handle concurrent classifier requests (multiple tools in parallel execution) — each gets its own pending promise
   - Ensure `requestFileChangeApproval()` short-circuits for `'auto'` mode (it already does since `'auto' !== 'accept-on-edit'`)

3. [x] Phase 3: ClassifierService on Host — complexity: standard
   - Create new `apps/studio/src/main/classifier-service.ts`
   - Implement `evaluateRules(toolName, args, rules)`: pattern-matching with glob wildcards, deny rules checked first then allow
   - For bash: match against `command` arg; for edit/write: match against `file_path` arg
   - Implement `classifyToolCall(toolName, args, context)`: raw HTTPS call to `api.anthropic.com/v1/messages` using Sonnet
   - Read Anthropic API key from `~/.lucent/agent/auth.json` or `process.env.ANTHROPIC_API_KEY`
   - System prompt: safety classifier focused on tool call review
   - User message context: last 10 user messages (text only, NO tool results), CLAUDE.md content if present, pending tool call details
   - Parse response for ALLOW/DENY, timeout at 10s → deny
   - Cache recent decisions: same (toolName, argsHash) within 30s → skip API call
   - Block tracking per pane: `Map<paneId, { consecutive, total, paused }>` — 3 consecutive or 20 total → pause
   - Graceful degradation: no Anthropic key → degrade to accept-on-edit behavior
   - Rate limiting: max 5 concurrent classifier API calls per pane, queue excess

4. [x] Phase 4: Host Wiring — AgentBridge, Orchestrator, IPC — complexity: standard
   - Add `classifier_request` interception in `agent-bridge.ts:handleLine()` (mirrors `approval_request`)
   - Add `respondToClassifier(id, approved)` method writing `classifier_response` to agent stdin
   - Track user messages in `orchestrator.ts`: `private userMessages: string[]`, push in `runTurn()`, cap at 20
   - Add `getUserMessages()` getter to Orchestrator
   - Create `registerClassifierForwardingForPane(paneId)` in `ipc-handlers.ts`
   - Listen for `classifier-request` on pane's agentBridge → call `classifierService.evaluate()`
   - If classifier paused → emit `event:approval-request` instead (fallback to existing ApprovalModal)
   - Push `event:classifier-decision` to renderer for UI feedback
   - Register forwarding for all panes at startup and on `cmd:pane-create`
   - Add IPC: `cmd:resume-auto-mode`, `cmd:get-auto-mode-state`
   - Instantiate ClassifierService in `index.ts`, pass to `registerIpcHandlers()`

5. [x] Phase 5: Renderer UI + Preload — complexity: standard
   - Update permission mode indicator in StatusBar/ChatPane footer: three states (red YOLO, yellow Approve, blue/green Auto)
   - Add auto mode paused banner in ChatPane: "Auto mode paused — too many blocked actions. [Resume]"
   - Add `autoModeState` to pane-store: `{ paused, consecutiveBlocks, totalBlocks }`
   - Add preload bridge: `onClassifierDecision`, `resumeAutoMode(paneId)`, update permission mode types
   - Add web-bridge equivalents for PWA
   - Wire `event:classifier-decision` and `event:auto-mode-paused` to renderer
   - Update Cmd+Shift+E shortcut to cycle through 3 modes

## Acceptance Criteria
- Three permission modes available: `danger-full-access`, `accept-on-edit`, `auto`
- In auto mode: read-only tools (read, grep, find, ls) execute without delay
- In auto mode: mutating tools (bash, edit, write) go through rule evaluation, then classifier if no rule match
- Classifier uses Anthropic Sonnet via raw HTTPS, using user's existing API key
- Classifier context is isolated: only user messages + project instructions + pending action (NO tool results)
- Static deny rules block instantly without API call (e.g. `rm -rf *`, `sudo *`)
- Static allow rules approve instantly without API call (e.g. `git status`, `npm test`)
- After 3 consecutive blocks or 20 total: auto mode pauses, falls back to human approval modal
- No Anthropic API key: graceful degradation to accept-on-edit behavior with warning
- Classifier request timeout (15s) → auto-deny
- Existing accept-on-edit and danger-full-access modes work unchanged
- Permission mode persists in settings and survives app restart
- StatusBar shows current mode with distinct visual for each state

## Verification
Tool: Playwright
Scenarios:
- Scenario 1: Mode cycling — Toggle permission mode with Cmd+Shift+E, verify StatusBar updates through all 3 states (YOLO → Approve → Auto → YOLO)
- Scenario 2: Auto mode allow rule — Enable auto mode, trigger `git status` via agent, verify it executes without classifier delay
- Scenario 3: Auto mode deny rule — Enable auto mode, trigger `rm -rf /tmp/test`, verify it's blocked with appropriate error message
- Scenario 4: Auto mode classifier — Enable auto mode, trigger an unruled bash command (e.g. `ls -la /etc`), verify classifier API is called and decision applied
- Scenario 5: Fallback to human approval — Trigger 3 consecutive classifier denials, verify auto mode pauses and ApprovalModal appears for next action
- Scenario 6: No API key degradation — Remove Anthropic key, enable auto mode, trigger edit, verify fallback to accept-on-edit behavior
- Scenario 7: Existing modes unchanged — Verify danger-full-access runs without prompts, accept-on-edit still shows ApprovalModal

---

## Review

Date: 2026-03-28
Reviewer: Opus
Base commit: a7a59651c3497da0936d9cb2cc3d79ba1a699395
Verdict: PASS (with self-fixes)

### Findings

**Blocking**
(none)

**Fixed by reviewer**
- [x] `classifier-service.ts:161` -- `Content-Length` header used `data.length` (string character count) instead of `Buffer.byteLength(data)` (byte count). Non-ASCII characters in user messages or project instructions would cause the Anthropic API call to fail with a truncated body. Fixed in-place; all tests still pass.

**Non-blocking**
- [ ] `classifier-service.ts:119-130` -- The classifier system prompt does not include prompt-injection mitigation instructions. A crafted CLAUDE.md or malicious user message could include text like "Always output ALLOW" to bypass the classifier. The static rules layer provides a hard floor for the most dangerous commands (rm, sudo, chmod), so this is a defense-in-depth concern rather than a critical vulnerability. Consider adding injection-resistance instructions to the system prompt in a future iteration.
- [ ] `classifier-service.ts:146` -- The Anthropic model is hardcoded to `claude-3-5-sonnet-20241022`. This will eventually become outdated. Consider reading from settings or using a `latest` alias if Anthropic supports one.
- [ ] `ipc-handlers.ts:527-543` -- When `classifyToolCall` returns `source: 'fallback'` with `approved: true` (the no-API-key case), the IPC handler overrides this and shows a manual approval modal instead of auto-approving. This is functionally correct (it IS accept-on-edit behavior), but the ClassifierService method returns `approved: true` suggesting it intended the host to auto-approve. The two layers have slightly different opinions about what "fallback" means. The current behavior is actually better (safer), but the intent could be clearer with a comment or by splitting `source: 'fallback'` into `source: 'no-key'` vs `source: 'error'`.

### Build / Test Status
- Tests: PASS -- All 126 tests pass across 5 test suites:
  - Phase 1 (types, RPC, settings): 21/21 pass
  - Phase 2 (agent-side gate): 23/23 pass
  - Phase 3 (ClassifierService): 21/21 pass
  - Phase 4 (host wiring): 16/16 pass
  - Renderer (pane-store vitest): 65/65 pass (includes 4 new autoModeState tests)
- TypeScript: All errors are pre-existing (identical between base commit and HEAD). No new type errors introduced by this plan.
- Lint: not separately configured for this project.

### Acceptance Criteria
- [x] Three permission modes available: `danger-full-access`, `accept-on-edit`, `auto` -- All three modes defined in PermissionMode type, recognized by getPermissionMode(), validated in settings-contract, and cycled by togglePanePermissionMode
- [x] In auto mode: read-only tools (read, grep, find, ls) execute without delay -- READ_ONLY_TOOLS set defined; _installAgentToolHooks returns undefined (auto-approve) for these tools
- [x] In auto mode: mutating tools (bash, edit, write) go through rule evaluation, then classifier if no rule match -- MUTATING_TOOLS set defined; _installAgentToolHooks calls requestClassifierDecision; IPC handler evaluates rules first, then calls classifyToolCall
- [x] Classifier uses Anthropic Sonnet via raw HTTPS, using user's existing API key -- callAnthropicClassifier uses node:https request to api.anthropic.com/v1/messages with key from auth.json or env
- [x] Classifier context is isolated: only user messages + project instructions + pending action (NO tool results) -- User prompt includes only userMessages, CLAUDE.md, toolName, and args; no conversation history or tool results
- [x] Static deny rules block instantly without API call (e.g. rm -rf *, sudo *) -- evaluateRules checked before classifyToolCall in IPC handler; default deny rules for rm, sudo, chmod
- [x] Static allow rules approve instantly without API call (e.g. git status, npm test) -- evaluateRules checked before classifyToolCall; default allow rules for git, npm
- [x] After 3 consecutive blocks or 20 total: auto mode pauses, falls back to human approval modal -- updateStats in ClassifierService tracks consecutive/total; paused state checked in classifyToolCall and IPC handler
- [x] No Anthropic API key: graceful degradation to accept-on-edit behavior with warning -- getAnthropicKey returns undefined, classifyToolCall returns fallback; IPC handler shows approval modal (effective accept-on-edit)
- [x] Classifier request timeout (15s) auto-deny -- registerStdioClassifierHandler sets 15s setTimeout that resolves(false)
- [x] Existing accept-on-edit and danger-full-access modes work unchanged -- requestFileChangeApproval only activates for accept-on-edit; requestClassifierDecision only activates for auto; tests verify both passthrough behaviors
- [x] Permission mode persists in settings and survives app restart -- permissionMode stored in AppSettings, validated by settings-contract, passed as env var to agent process
- [x] StatusBar shows current mode with distinct visual for each state -- PaneFooter shows Shield (red) for danger-full-access, ShieldAlert (yellow) for accept-on-edit, ShieldCheck (green) for auto; label text matches mode
