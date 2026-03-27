# Plan #3: Subagents, Skills/Workflows + PWA with Tailscale

Plan ID: #3
Generated: 2026-03-27
Platform: web
Status: approved

## Context

**A. Subagents + Skills/Workflows** — Spawn isolated child agent processes (worker, scout, reviewer) from the main agent. Skill system with `/command` invocation, multi-step chaining, and subagent delegation. Subagent activity visible inline in chat as collapsible nested blocks.

**B. PWA + Tailscale** — Serve Studio renderer as mobile-optimized PWA. Bridge adapter pattern (`getBridge()`) swaps IPC↔WebSocket. Tailscale tunnel for HTTPS remote access with token auth.

### Key Architecture

- **Subagents:** Separate processes via ProcessManager, each with own AgentBridge. Max 4 concurrent. Orchestrator tracks parent→child, routes events. Cleanup on crash/abort/pane-close.
- **Skills:** Markdown + YAML frontmatter in `src/resources/skills/`. SkillRegistry validates (no duplicate triggers, no cycles). SkillExecutor chains steps, delegates to subagents.
- **Bridge Adapter:** `getBridge()` returns IPC bridge (Electron) or WebSocket bridge (PWA). Refactored early so PWA server just serves the existing adapter. Remote clients get capability-scoped access (no terminal, no filesystem write).
- **Persistence:** New `subagent`/`skill` content block types added to session JSONL. Existing sessions load fine (unknown types render as collapsed info blocks).

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

### Phase 2: Skill System (Engine + UI) — complexity: standard ✅
1. Create `apps/studio/src/resources/skills/` with 5 skill `.md` files: `commit` (stage + commit), `review-code` (spawn reviewer on diff), `explain` (explain file/selection), `refactor` (spawn worker), `test` (generate tests). YAML frontmatter: `name`, `description`, `trigger`, `steps[]` (prompt template + optional `agentType`).
2. Create `SkillRegistry` (main process) — discovers skills at startup, validates (no duplicate triggers, no cyclic step chains, valid agentType references), registers trigger→skill map. Create `SkillExecutor` — runs steps sequentially, chains step N output → step N+1 context, delegates to subagents for steps with `agentType`, emits `skill-progress` events per step.
3. Add IPC + preload bridge: `cmd:skill-list/execute/abort`, events `event:skill-progress/complete`.
4. Wire `/command` detection in `ChatInput` submit handler — look up SkillRegistry, execute via SkillExecutor. Add skill autocomplete dropdown on `/` keystroke — filter-as-you-type, Tab/Enter to select.
5. Add `skill` content block type to chat store — `{ type: 'skill'; id; skillName; steps: SkillStep[]; status }`. Create `SkillProgressBlock` — shows step N/M progress, nested subagent blocks for delegating steps.
6. Wire skill events in `ChatPane`, integrate skills into `CommandPalette` (Cmd+K), add skills list section in Settings.

### Phase 3: PWA + Mobile + Tailscale — complexity: standard
1. **Bridge abstraction (do first):** Create `getBridge()` adapter — checks `window.__ELECTRON__` flag. Electron path: returns existing `window.bridge` (IPC). PWA path: returns `WebBridge` class (fetch for commands, WebSocket for events, same `Bridge` interface). Refactor all 21 `window.bridge` call sites to `getBridge()`. Set `window.__ELECTRON__ = true` in preload script.
2. Create `WebBridgeServer` (main process, Node `http` + `ws`) — mirrors preload bridge RPC: `POST /api/cmd/:name` for commands, WebSocket for bidirectional events. Bearer token auth on all requests. **Capability scoping for remote clients:** no `cmd:terminal-*`, no `cmd:fs-*` write ops, no `cmd:pick-folder`. CORS: Tailscale origins + localhost only.
3. Add PWA vite config (`vite.pwa.config.ts`), `manifest.webmanifest` (Lucent Chat, icons 192+512, standalone, dark theme), service worker (app shell cache, versioned). npm scripts: `build:pwa`, `serve:pwa`. Output: `dist/pwa/`.
4. Add responsive mobile CSS — sidebar → bottom nav on `<768px`, single stacked pane, 44px touch targets, bottom sheet command palette. CSS container queries + media queries.
5. Create `TailscaleService` — detect hostname via `tailscale status --json` (fallback: macOS app binary path), `enableServe(port)` runs `tailscale serve --bg http://localhost:<port>`, `getServeStatus()`. Handle: Tailscale not installed, signed out, `serve` port conflict.
6. Add "Remote Access" Settings section — toggle WebBridgeServer on/off, display local URL + Tailscale HTTPS URL + QR code (`qrcode.react`), token display with copy + rotate button. Settings fields: `remoteAccessEnabled`, `remoteAccessPort` (8788), `remoteAccessToken` (auto-generated), `tailscaleServeEnabled`.
7. Wire auto-start on app launch from settings. Handle concurrent PWA clients (multiple phones). Token rotation disconnects existing sessions (clients must re-auth).

## Acceptance Criteria
- [ ] Main agent spawns subagents (worker, scout, reviewer) in isolated processes, max 4 concurrent
- [ ] Subagent crash/abort properly cleans up child processes
- [ ] Subagent tool calls visible inline as collapsible nested blocks in chat
- [ ] 5 predefined skills invocable via `/command` with autocomplete
- [ ] Multi-step skills chain correctly; subagent-delegating steps show nested blocks
- [ ] Existing sessions load without errors (unknown block types handled gracefully)
- [ ] PWA builds from same React codebase via `getBridge()` adapter, connects via WebSocket
- [ ] PWA installable on mobile with manifest + icons
- [ ] Mobile layout responsive with touch-friendly targets (44px min)
- [ ] Remote PWA clients have capability-scoped access (no terminal, no fs writes)
- [ ] Tailscale HTTPS URL detected, QR displayed in Settings
- [ ] Remote access token-protected; unauthorized requests rejected; rotation works
- [ ] Existing Electron desktop app unchanged

## Verification
Tool: Playwright
Scenarios:
- Subagent spawn: prompt triggers subagent → nested block with tool calls in chat
- Subagent crash: kill child process → error state shown, no orphan processes
- Subagent collapse: toggle → summary line vs full trace
- Skill autocomplete: type `/` → dropdown → select `commit` → executes
- Multi-step skill: `/review-code` → progress block with subagent delegation
- PWA build: `npm run build:pwa` → serve → installable in Chrome
- PWA chat: mobile browser → send message → streamed response
- PWA capability scope: remote client → terminal/fs-write commands rejected
- Mobile layout: 375px viewport → bottom nav, stacked panes, 44px targets
- Remote access: enable in Settings → Tailscale URL + QR → works on phone
- Token auth: no-token request → 401; rotate token → existing sessions disconnected
- Desktop regression: `npm run dev -w @lc/studio` → works as before
