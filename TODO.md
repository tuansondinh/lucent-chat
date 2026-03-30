# TODO

## UI — Terminal

- [ ] **Embedded terminal pane** — Add a terminal to the app (e.g. using `node-pty` + `xterm.js`) so users can run commands without leaving Lucent Code. Should integrate with the existing pane layout and respect the project root as the working directory.

## Agent Behavior

- [ ] **Copy CLAUDE.md and memory behavior into Lucent Code** — Replicate Claude Code's global `Claude.md` instruction system and auto-memory (per-project `MEMORY.md` index + typed memory files) so the built-in agent follows the same behavior rules and persists knowledge across sessions.

- [ ] **User-defined subagents via `~/.lc/`** — Allow users to drop custom subagent definitions into their `~/.lc/` folder (similar to how skills/agents work in the skill system). The app discovers these at runtime and makes them available alongside built-in subagents. Each subagent definition specifies its system prompt, model, and any tool restrictions.

- [ ] **`lucent-code-guide` skill** — Add a built-in skill that explains how to use Lucent Code, similar to Claude Code's `/help` command. This should cover:
  - App overview and architecture
  - How to use the chat interface and tool calls
  - Pane navigation and keyboard shortcuts
  - Session management and persistence
  - How to configure providers, models, and settings
  - How to use skills and agents
  - Where to find documentation (ARCHITECTURE.md, codebase.md, etc.)

## Security Review (2026-03-28)

### CRITICAL

- [x] **WebBridgeServer ignores `remoteAccessEnabled`** — Server always starts on port 8788/0.0.0.0 even when disabled. Any local process gets unauthenticated access.
  - Fixed: gated startup on `settings.remoteAccessEnabled` in `index.ts`

- [x] **`fs-write-file` not blocked for remote clients** — `web-bridge-server.ts` BLOCKED_CMDS omits `fs-write-file`, so PWA clients can write arbitrary files in the project root. Add to blocklist or create an explicit write-allow opt-in.
  - Fixed: added `fs-write-file` to `BLOCKED_CMDS` in `web-bridge-server.ts`

- [x] **Remote clients can escalate via `set-settings`** — A remote client can change `permissionMode` to `danger-full-access`, set `remoteAccessToken` to `""`, or modify `autoModeRules`. Block security-sensitive fields from remote `set-settings` calls.
  - Fixed: `REMOTE_BLOCKED_SETTING_KEYS` set strips `permissionMode`, `remoteAccessToken`, `autoModeRules`, `remoteAccessEnabled`, `remoteAccessPort`, `tailscaleServeEnabled` from HTTP `set-settings` calls in `web-bridge-server.ts`

- [x] **`remoteAccessToken` not sanitized from renderer responses** — `sanitizeSettingsForRenderer` strips `tavilyApiKey` but passes `remoteAccessToken` through. Add it to the `Omit` in `settings-contract.ts`.
  - Fixed: `RendererSettings` type and `sanitizeSettingsForRenderer` now omit both `tavilyApiKey` and `remoteAccessToken`

### HIGH

- [x] **Localhost auth bypass on 0.0.0.0 binding** — Server binds all interfaces; localhost requests bypass token auth. Any local process (malicious npm script, compromised extension) gets full unauthenticated API access. Bind to `127.0.0.1` by default; only bind `0.0.0.0` when Tailscale serve is enabled.
  - Fixed: `WebBridgeServerOptions.bindAddress` added; server defaults to `127.0.0.1`, binds `0.0.0.0` only when `tailscaleServeEnabled`

- [x] **Token comparison not constant-time** — `web-bridge-server.ts:203` uses `!==` for bearer token check. Use `crypto.timingSafeEqual` instead.
  - Fixed: all three auth points (HTTP API, WebSocket, voice proxy) now use `crypto.timingSafeEqual`

- [x] **Classifier rules trivially bypassed** — Deny rules like `rm *` only match full command text. Chained commands (`&& rm`), absolute paths (`/bin/rm`), subshells (`$(rm)`), and interpreter wrappers (`bash -c "rm"`) all bypass.
  - Fixed: `extractBashSubcommands` now decomposes commands into subcommands, strips paths/env vars, extracts subshells and interpreter wrappers. Deny rules match all candidates; allow rules only match full command.

- [x] **`readFileFull` has no size limit** — `file-service.ts` reads entire file into memory. Add a cap (e.g. 50MB) to prevent OOM from large files or `/dev/zero` symlinks.
  - Fixed: 50MB cap added in `readFileFull`

- [x] **Token logged to stdout** — `server.ts:233` prints the bearer token. Remove or redact.
  - Fixed: removed `console.log([server] token → ${token})`

### MEDIUM

- [x] **Default permission mode is `danger-full-access`** — New installs have zero guardrails. Consider defaulting to `accept-on-edit`.
  - Fixed: fallback changed from `'danger-full-access'` to `'accept-on-edit'` in `server.ts`, `index.ts`, and `pane-manager.ts`

- [x] **TOCTOU in `writeFile` path validation** — Parent directory could be replaced with symlink between check and write. Validate resolved path of parent directory before write.
  - Fixed: added `realpath` re-validation of parent directory after `mkdir` in `file-service.ts`

- [ ] **PWA token persisted in localStorage** — Accessible to any JS on same origin. Any XSS would compromise the token.

- [x] **No request body size limit on HTTP API** — `web-bridge-server.ts` `handleCommand` concatenates body chunks without limit. Add a cap (e.g. 10MB).
  - Fixed: 10MB body limit with 413 response added to `handleCommand`

- [x] **`remoteAccessToken` validation accepts empty string** — `validateSettingsPatch` only checks `typeof === 'string'`. Add minimum length check (≥16 chars).
  - Fixed: minimum length of 16 chars enforced in `validateSettingsPatch`

## UI — Chat

- [ ] **Clickable file references** — File references in chat messages (e.g., `src/main/index.ts:42`) should be clickable. When clicked, they should open the file editor and navigate to the specified file and line number. This involves parsing file paths/line refs in `ChatMessage.tsx` and wiring them to the existing file open logic (similar to how the file tree already opens files).

## UI — Tool Integration

- [x] **`ask_user_questions` tool not rendered in Studio UI** — The GSD runtime's `ask_user_questions` extension sends questions with selectable options, but the Studio frontend renders it as a generic tool call ("ask_user_questions running") with no interactive UI. Need to intercept this tool in `ChatMessage.tsx`, render the questions and answer options as clickable buttons, and send the user's selections back to the runtime so the tool can resolve.
  - Fixed: added `UiSelectCard` component in `ChatPane.tsx`; `agent-bridge.ts` intercepts `extension_ui_request` events and emits `ui-select-request`; preload and PWA bridge wired up; full round-trip via `respondToUiSelect`

## Session Persistence

- [x] **Sessions not persisted reliably** — After a turn completes (`agent_end`), the orchestrator never calls `setActiveSessionId()` to persist the session path. Fix: call `setActiveSessionId` in the orchestrator's `agent_end` handler (or via a callback) so every completed turn persists the active session immediately.
  - Fixed: added `onTurnComplete` callback to `OrchestratorCallbacks`; wired in `pane-manager.ts` `createPane` and `index.ts`

- [x] **Main process doesn't restore persisted session on startup** — `loadActiveSessionId()` reads the path from `~/.lucent/active-session` but never calls `agentBridge.switchSession()` to tell the agent to resume it. The agent starts fresh every time. Fix: after agent reaches `ready` state in `attachAgentBridge()`, if a persisted session exists, call `switchSession()`.
  - Fixed: `attachAgentBridge` in `index.ts` now calls `switchSession()` if the persisted session differs from the agent's current session

## UI — Tool Integration

- [ ] **`ask_user_questions` tool not rendered in Studio UI** — The GSD runtime's `ask_user_questions` extension sends questions with selectable options, but the Studio frontend renders it as a generic tool call ("ask_user_questions running") with no interactive UI. Need to intercept this tool in `ChatMessage.tsx`, render the questions and answer options as clickable buttons, and send the user's selections back to the runtime so the tool can resolve.

## Session Persistence

- [ ] **Sessions not persisted reliably** — After a turn completes (`agent_end`), the orchestrator never calls `setActiveSessionId()` to persist the session path. Persistence only happens on `newSession`, `switchSession`, or agent readiness probes (`getState`). Fix: call `setActiveSessionId` in the orchestrator's `agent_end` handler (or via a callback) so every completed turn persists the active session immediately.

- [ ] **Main process doesn't restore persisted session on startup** — `loadActiveSessionId()` reads the path from `~/.lucent/active-session` but never calls `agentBridge.switchSession()` to tell the agent to resume it. The agent starts fresh every time. Fix: after agent reaches `ready` state in `attachAgentBridge()`, if a persisted session exists, call `switchSession()`.

## Classifier / Auto Mode

- [x] Replace `CLAUDE.md` with `LUCENT.md` as the project instructions file read by the classifier.
  - Fixed: changed `CLAUDE.md` → `LUCENT.md` in `apps/studio/src/main/ipc-handlers.ts`

- [ ] **Configurable classifier model** — The classifier is hardcoded to `claude-haiku-4-5-20251001`. Any model configured as a chat provider should also be selectable as the classifier model. This includes:
  - A `classifierModel` field in app settings (provider + model ID)
  - Settings UI to pick the classifier model from the same model list used in the chat model picker
  - `ClassifierService` reads this setting at call time instead of hardcoding the model/API
  - Multi-provider support: route to Anthropic or Google AI (or others) based on the selected model's provider
  - Goal: allow using e.g. Gemini 3 Flash as classifier while keeping a different model for chat

- [ ] **Configurable subagent model (internal)** — Internal subagents (e.g., `lucent-code-guide`) are currently hardcoded to specific models. Allow per-subagent model configuration so users can override the default model for any built-in subagent. This includes:
  - A `subagentModels` map in app settings (subagent name → provider + model ID)
  - Settings UI to configure models for each internal subagent
  - Subagent spawning reads this setting to override defaults
  - Goal: allow using faster/cheaper models for utility subagents while keeping high-quality models for main chat

## Code Review (2026-03-30)

### HIGH

- [ ] **Remote/PWA bridge is missing auto-mode command support** — The renderer calls `get-auto-mode-state`, `resume-auto-mode`, and `toggle-pane-permission-mode`, but `apps/studio/src/main/server.ts` does not implement these commands. Remote Access clients cannot toggle permission mode or recover paused auto mode.

### MEDIUM

- [ ] **Removing Google Code Assist auth does not remove fallback Gemini credentials** — `getProviderStatuses()` marks `google-gemini-cli` as removable when fallback `google` credentials exist, but `removeApiKey('google-gemini-cli')` only removes the primary provider entry. The Settings UI can show a Remove button that has no effect.

- [ ] **Standalone server does not restart agents after provider auth changes** — Electron restarts agents after saving or removing provider credentials, but `apps/studio/src/main/server.ts` returns auth results directly without restarting pane agents. Remote sessions can keep stale auth/model state until the whole server is restarted.
