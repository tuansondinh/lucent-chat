# Plan #3: Subagents, Skills/Workflows + PWA with Tailscale

Plan ID: #3
Generated: 2026-03-27
Platform: web
Status: approved

## Context

**A. Subagents + Skills** — Spawn isolated child agent processes (worker, scout, reviewer) from the main agent. Skill system with `/command` invocation handled by agent's LLM reasoning. Subagent activity visible inline in chat as collapsible nested blocks.

**B. PWA + Tailscale** — Serve Studio renderer as mobile-optimized PWA. Bridge adapter pattern (`getBridge()`) swaps IPC↔WebSocket. Tailscale tunnel for HTTPS remote access with token auth.

### Key Architecture

- **Subagents:** Separate processes via ProcessManager, each with own AgentBridge. Max 4 concurrent. Orchestrator tracks parent→child, routes events. Cleanup on crash/abort/pane-close.
- **Skills:** Simple filesystem discovery from `~/.lc/agent/skills/` (global) and `.lc/skills/` (project-local). `/skill-name` in chat sent as message to agent. Agent handles skill invocation via Skill tool in reasoning loop.
- **Bridge Adapter:** `getBridge()` returns IPC bridge (Electron) or WebSocket bridge (PWA). Refactored early so PWA server just serves the existing adapter. Remote clients get capability-scoped access (no terminal, no filesystem write).
- **Persistence:** New `subagent` content block type added to session JSONL. Existing sessions load fine (unknown types render as collapsed info blocks).

## Phases

### Phase 1: Subagent System (Infra + UI) — complexity: standard ✅
1. Extend `ProcessManager` with `spawnNamedProcess(name, cmd, args, opts)` for dynamic child processes beyond "agent"/"sidecar" slots. Add `killNamed(name)`, `getNamedProcess(name)`.
2. Add `SubagentManager` — spawns/tracks child agents each with own AgentBridge, maps parent `turn_id` → child agent ID. Enforces max 4 concurrent subagents. Handles child crash (emit error event, cleanup), orphan cleanup on parent abort, and `shutdownAll()` on app quit.
3. Port agent definitions from gsd-2 `src/resources/agents/` (worker.md, scout.md, researcher.md) into `apps/studio/src/resources/agents/`. Add `AgentDefinitionLoader` to parse frontmatter (name, description) + extract system prompt body.
4. Extend `Orchestrator` with `submitSubagentTurn(parentTurnId, agentType, prompt)` — creates child context, spawns via SubagentManager, routes events (chunks, tool calls, done) tagged with `subagentId`. Handle pane close / session switch during active subagent: abort children, emit cleanup events.
5. Add IPC + preload bridge: `cmd:subagent-spawn/list/abort`, events `event:subagent-chunk/tool-start/tool-end/done/state`.
6. Add `subagent` content block type to chat store — `{ type: 'subagent'; id; agentType; prompt; status: 'running'|'done'|'error'; children: ContentBlock[] }`. Existing sessions with unknown block types render as collapsed info blocks (forward compatibility).
7. Create `SubagentBlock` component — collapsible inline block with left border accent + agent type badge. Collapsed = summary (type + status + duration). Expanded = full nested tool call trace. Reuses `ChatMessage` content block rendering.
8. Wire subagent events in `ChatPane`, render in `ChatMessage`, show active-subagent count in `StatusBar`.

### Phase 2: Skill System (Engine + UI) — complexity: standard ✅ (simplified)

**Status: Simplified post-Plan #3 — multi-step execution removed, agent-native invocation**

The skill system was originally designed with `SkillRegistry`, `SkillExecutor`, multi-step chains, and progress tracking. This has been simplified:

**Files removed:**
- `apps/studio/src/main/skill-registry.ts` — SkillRegistry class
- `apps/studio/src/main/skill-executor.ts` — SkillExecutor class with multi-step execution, abort, progress events
- `apps/studio/src/renderer/src/components/SkillProgressBlock.tsx` — skill progress UI
- `apps/studio/test/skill-phase2.test.mjs` — skill system tests
- IPC handlers: `cmd:skill-execute`, `cmd:skill-abort`
- Preload bridge methods: `skillExecute`, `skillAbort`, `onSkillProgress`, `onSkillComplete`
- Store types: `SkillBlock`, `SkillStepState`
- Store actions: `addSkillBlock`, `updateSkillStep`, `finalizeSkillBlock`

**What changed:**
- `cmd:skill-list` IPC handler now scans `~/.lc/agent/skills/` and `.lc/skills/` directly via filesystem (no registry validation)
- `/skill-name` in chat is sent as a regular message to the agent
- Agent handles skill invocation via the Skill tool (in `packages/pi-coding-agent/src/core/skills.ts`)
- User-facing config directory renamed from `.pi` to `.lc` (piConfig in `packages/pi-coding-agent/package.json`)
- Skill autocomplete dropdown in ChatInput now floats above with max-height (improved UX)
- Command palette skill actions send `/skill-name` as a message instead of executing directly

**What stayed the same:**
- `packages/pi-coding-agent/src/core/skills.ts` — agent-side skill discovery and Skill tool (unchanged)
- Skills tab in Settings — sources from `cmd:skill-list`, displays available skills
- Skill autocomplete in ChatInput — works, floats above input
- Skills section in CommandPalette — works, sends messages
- Bundled skills in `src/resources/skills/` and `apps/studio/src/resources/skills/` (unchanged)

### Phase 3: PWA + Mobile + Tailscale — complexity: standard ✅
1. **Bridge abstraction (do first):** Create `getBridge()` adapter — checks `window.__ELECTRON__` flag. Electron path: returns existing `window.bridge` (IPC). PWA path: returns `WebBridge` class (fetch for commands, WebSocket for events, same `Bridge` interface). Refactor all 21 `window.bridge` call sites to `getBridge()`. Set `window.__ELECTRON__ = true` in preload script.
2. Create `WebBridgeServer` (main process, Node `http` + `ws`) — mirrors preload bridge RPC: `POST /api/cmd/:name` for commands, WebSocket for bidirectional events. Bearer token auth on all requests. **Capability scoping for remote clients:** no `cmd:terminal-*`, no `cmd:fs-*` write ops, no `cmd:pick-folder`. CORS: Tailscale origins + localhost only.
3. Add PWA vite config (`vite.pwa.config.ts`), `manifest.webmanifest` (Lucent Code, icons 192+512, standalone, dark theme), service worker (app shell cache, versioned). npm scripts: `build:pwa`, `serve:pwa`. Output: `dist/pwa/`.
4. Add responsive mobile CSS — sidebar → bottom nav on `<768px`, single stacked pane, 44px touch targets, bottom sheet command palette. CSS container queries + media queries.
5. Create `TailscaleService` — detect hostname via `tailscale status --json` (fallback: macOS app binary path), `enableServe(port)` runs `tailscale serve --bg http://localhost:<port>`, `getServeStatus()`. Handle: Tailscale not installed, signed out, `serve` port conflict.
6. Add "Remote Access" Settings section — toggle WebBridgeServer on/off, display local URL + Tailscale HTTPS URL + QR code (`qrcode.react`), token display with copy + rotate button. Settings fields: `remoteAccessEnabled`, `remoteAccessPort` (8788), `remoteAccessToken` (auto-generated), `tailscaleServeEnabled`.
7. Wire auto-start on app launch from settings. Handle concurrent PWA clients (multiple phones). Token rotation disconnects existing sessions (clients must re-auth).

## Acceptance Criteria

### Subagent System (Phase 1) ✅
- [x] Main agent spawns subagents (worker, scout, reviewer) in isolated processes, max 4 concurrent
- [x] Subagent crash/abort properly cleans up child processes
- [x] Subagent tool calls visible inline as collapsible nested blocks in chat

### Skill System (Phase 2) ✅ (simplified)
- [x] Skills discoverable via `cmd:skill-list` from `~/.lc/agent/skills/` and `.lc/skills/`
- [x] `/skill-name` in chat sent as regular message (agent handles via Skill tool)
- [x] Skill autocomplete dropdown in ChatInput (floats above, max-height)
- [x] Skills section in CommandPalette (Cmd+K) sends `/skill-name` messages
- [x] Skills tab in Settings shows available skills
- [x] Existing sessions load without errors

### PWA + Mobile + Tailscale (Phase 3) ✅
- [x] PWA builds from same React codebase via `getBridge()` adapter, connects via WebSocket
- [x] PWA installable on mobile with manifest + icons
- [x] Mobile layout responsive with touch-friendly targets (44px min)
- [x] Remote PWA clients have capability-scoped access (no terminal, no fs writes)
- [x] Tailscale HTTPS URL detected, QR displayed in Settings
- [x] Remote access token-protected; unauthorized requests rejected; rotation works
- [x] Existing Electron desktop app unchanged

## Verification

### Subagent System (Phase 1)
Tool: Playwright
- Subagent spawn: prompt triggers subagent → nested block with tool calls in chat
- Subagent crash: kill child process → error state shown, no orphan processes
- Subagent collapse: toggle → summary line vs full trace

### Skill System (Phase 2 - Simplified)
Tool: Manual
- Skill discovery: `/` keystroke shows available skills in dropdown
- Skill autocomplete: type `/commit` → dropdown → select → sent as message
- Skill in command palette: Cmd+K → search "commit" → executes
- Skills settings tab: lists available skills from both global and project directories
- Agent skill handling: `/skill-name` message received by agent, Skill tool invoked

### PWA + Mobile + Tailscale (Phase 3)
Tool: Playwright
- PWA build: `npm run build:pwa` → serve → installable in Chrome
- PWA chat: mobile browser → send message → streamed response
- PWA capability scope: remote client → terminal/fs-write commands rejected
- Mobile layout: 375px viewport → bottom nav, stacked panes, 44px targets
- Remote access: enable in Settings → Tailscale URL + QR → works on phone
- Token auth: no-token request → 401; rotate token → existing sessions disconnected
- Desktop regression: `npm run dev -w @lc/studio` → works as before
