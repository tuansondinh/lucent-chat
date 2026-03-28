# Plan #6: Subagent Tool Call Visibility

Plan ID: #6
Generated: 2026-03-28
Platform: web
Status: complete

## Problem

When a subagent is running in Lucent Code, the user has no visibility into what the subagent is doing — they only see a spinning loader for the `subagent` tool. In the GSD CLI, subagent tool calls are rendered live (e.g., `→ $ ls -la`, `→ read README.md`, `→ read package.json`), giving the user confidence the agent isn't stuck.

Additionally, the 5-minute safety timeout in the orchestrator is a fixed timer that fires even when the agent is actively working (e.g., a subagent running for 10+ minutes producing events), killing legitimate long-running turns.

## Root Cause

The runtime already emits `tool_execution_update` events containing subagent display items (tool call names, text output). But:
1. The **Orchestrator** only handles `tool_execution_start` and `tool_execution_end` — it ignores `tool_execution_update`
2. The **store** has no field for sub-activity within a `tool_use` block, and matches tool blocks by name FIFO (not by `toolCallId`), which is unsafe for concurrent same-name tools
3. The **ChatMessage UI** renders tool_use blocks as flat status items with no child activity
4. The 5-minute safety timer is absolute, not idle-based

## Architecture

Data flow (existing → new):

```
Runtime subprocess (RPC mode)
  └─ session.subscribe(output) → emits tool_execution_update with:
       { toolCallId, toolName, args, partialResult: { details: { results: [{ messages }] } } }
                    │
                    ▼
AgentBridge (main process)
  └─ emits 'agent-event' → { type: 'tool_execution_update', ... }
                    │
                    ▼
Orchestrator (main process) ← NEW: handle tool_execution_update
  └─ callbacks.onToolUpdate({ turn_id, tool, toolCallId, subItems })
                    │
                    ▼
PaneManager → pushEvent('event:tool-update', ...)
                    │
                    ▼
Preload → ipcRenderer.on('event:tool-update', ...)
                    │
                    ▼
ChatPane → store.getState().updateToolSubItems(turn_id, toolCallId, subItems)
                    │
                    ▼
ChatMessage → ToolCallItem renders subItems as indented activity list
```

### Key Design Decisions

1. **toolCallId end-to-end**: All tool operations (add, update, finalize) use `toolCallId` for matching, not tool name. The `tool_execution_start` event already provides `toolCallId`; propagate it through the store's `tool_use` ContentBlock and use it for all lookups.

2. **Replace-not-append semantics**: The subagent's `getDisplayItems()` rebuilds the full display item list from the complete `messages` array each time. Therefore `tool_execution_update` delivers a **full snapshot** of sub-items, not a delta. The store must **replace** `subItems` on each update, not append. Truncation/counting for the "N earlier" indicator happens at render time in the UI, not in the store.

3. **Ephemeral sub-items**: `subItems` are ephemeral UI state — not persisted to session JSONL. On session reload, completed tools show as collapsed with no sub-item history (just the final output from `tool_execution_end`). This avoids session bloat.

4. **Error/lifecycle handling**: When `tool_execution_end` arrives, `subItems` are cleared (collapsed to summary). When `agent_process_exit` fires, all in-flight tool blocks are marked `done=true` with `isError=true` — any `subItems` are frozen as-is for debugging visibility.

## Phases

1. [x] Phase 1: Data contract + event pipeline (commit cf59eefc) — complexity: standard
   - **Carry `toolCallId` end-to-end**: Add `toolCallId` field to `tool_use` ContentBlock type. Update `addToolCall` in pane-store.ts and chat.ts to accept and store `toolCallId`. Update `finalizeToolCall` to match by `toolCallId` instead of tool name FIFO. Update orchestrator's `onToolStart`/`onToolEnd` callbacks to pass `toolCallId` from the event. Update IPC payloads, preload listeners, and bridge methods to carry `toolCallId`.
   - **Add `onToolUpdate` callback**: Add to `OrchestratorCallbacks` interface. Handle `tool_execution_update` in Orchestrator's event handler — extract subItems from `partialResult.details.results[].messages[]` using the same display-item extraction logic as the CLI (text items + toolCall items). Forward via `onToolUpdate({ turn_id, tool, toolCallId, subItems })`.
   - **Replace-not-append store action**: Add `subItems` field to `tool_use` ContentBlock: `subItems?: Array<{ type: 'text' | 'toolCall'; text?: string; name?: string; args?: Record<string, any> }>`. Add `updateToolSubItems(turn_id, toolCallId, subItems)` action that **replaces** (not appends) the `subItems` array on the matching block.
   - **Fix safety timeout**: Convert the 5-minute `safetyTimer` in `orchestrator.ts:357` from a fixed `setTimeout` to a **rolling idle timeout**: reset on every received event. Only fires after 5 minutes of **silence**, not 5 minutes total.
   - **Wire through all paths**: PaneManager, index.ts, server.ts callbacks → `pushEvent('event:tool-update', ...)`. Preload `onToolUpdate` IPC listener. web-bridge.ts `onToolUpdate` method. ChatPane subscription calling `store.getState().updateToolSubItems(...)`.
   - **Lifecycle**: On `agent_process_exit` or abort, freeze in-flight subItems as-is and mark tool blocks as errored. On `tool_execution_end`, clear `subItems` (the final output replaces them).

2. [x] Phase 2: Render subagent activity in ToolCallItem UI (commit 0634d5fb) — complexity: standard
   - Modify `ToolCallItem` in ChatMessage.tsx to render `subItems` when present and tool is running (`!done`)
   - Show each sub-item as an indented line: `→ name` for toolCall items, truncated text preview for text items
   - Only show the last N items (e.g., 8) at render time with a "... N earlier" indicator when truncated
   - When the tool completes (`done=true`), if subItems were present, show a collapsed summary: "N tool calls" (count derived from toolCall-type items seen during the session — store a `subItemCount` counter on the block, incremented on each update's toolCall items)
   - Keep the existing expandable input/output detail panel intact
   - Ensure non-subagent tools (which never receive `tool_execution_update`) render unchanged

## Acceptance Criteria
- When a subagent runs, its tool calls appear in real-time within the subagent's tool_use block
- Tool calls show as indented `→ toolName` lines (matching GSD CLI style)
- The display is bounded (max ~8 recent items visible, with "... N earlier" indicator)
- When the subagent completes, the activity collapses to a summary
- Concurrent same-name tools are tracked independently via `toolCallId`
- No regressions to existing tool call, text streaming, or thinking block behavior
- Works in both Electron IPC path and PWA WebSocket path
- Long-running subagents (>5 min) no longer get killed by the safety timeout as long as events are still flowing
- subItems are ephemeral (not persisted to session JSONL); reopened sessions show completed tools without sub-item history
- Abort/crash during subagent: in-flight subItems freeze for debugging, tool block marked as errored

## Verification
Tool: Playwright
Scenarios:
- Scenario 1: Subagent activity renders — trigger a prompt that spawns a subagent → verify tool_use block shows `→` activity lines before completion
- Scenario 2: Activity collapses on completion — wait for subagent to finish → verify sub-items collapse to summary
- Scenario 3: Non-subagent tools unaffected — trigger a regular tool (e.g., read) → verify it renders the same as before (no sub-items)
- Scenario 4: Concurrent same-name tools — trigger two parallel subagent calls → verify each tracks its own subItems independently
- Scenario 5: Abort mid-subagent — abort while subagent is running → verify subItems freeze and tool shows error state
- Scenario 6: Rolling timeout — long-running subagent producing events past 5 min → verify turn is NOT killed

## Review (Codex gpt-5.4)

Reviewed by Codex CLI. Key findings incorporated:
1. ✅ toolCallId carried end-to-end (was missing — store matched by name FIFO)
2. ✅ Replace-not-append semantics defined (source data is snapshot, not delta)
3. ✅ Lifecycle/error handling added (abort, crash, stale subItems)
4. ✅ Persistence decision: ephemeral subItems, not persisted to session JSONL
5. ✅ Verification expanded (concurrent tools, abort, timeout, reconnect scenarios)

---

## Review

Date: 2026-03-28
Reviewer: Opus
Base commit: e5ba908273c544b2e0178eba3f5d8ed676ba2cae
Verdict: PASS (with self-fixes)

### Findings

**Fixed by reviewer** (already applied)
- [x] `server_tool_use` and `web_search_result` handlers in `studio/src/main/orchestrator.ts:261-275` were missing the required `toolCallId` field when calling `onToolStart`/`onToolEnd`. The `OrchestratorCallbacks` interface now requires `toolCallId: string` on both, so omitting it would cause a TypeScript compile error. Fixed by adding `toolCallId: amEvent.id ?? ...` to both call sites.
- [x] `updateToolSubItems` in both `studio/src/renderer/src/store/chat.ts:309` and `studio/src/renderer/src/store/pane-store.ts:297` was accumulating `subItemCount` additively (`(b.subItemCount ?? 0) + toolCallCount`) on every update. Since the plan's design decision #2 states subItems is a **full snapshot** (not a delta), the same tool calls appear in every snapshot, causing `subItemCount` to grow unboundedly (e.g., 10 real tool calls across 100 updates would show as ~5000). Fixed by using `Math.max(b.subItemCount ?? 0, toolCallCount)` which correctly reflects the highest count seen.

**Non-blocking**
- [ ] The tests (Phase 1 and Phase 2) are source-text regex tests that verify structural patterns in file contents (e.g., `assert.match(src, /SubItem/)`) rather than behavioral unit tests. They confirm the required APIs, types, and wiring exist at the source level, but do not exercise runtime behavior (e.g., calling `updateToolSubItems` and asserting the resulting state). Consider adding zustand store behavioral tests in a future pass.
- [ ] The `ToolCallActivity` component uses array index as the React `key` (`key={idx}`) at lines 316/330 in `ChatMessage.tsx`. Since the sub-items list is a replace-not-append snapshot that shifts (last 8 items), this can cause unnecessary re-renders. A composite key like `${item.type}-${item.name ?? idx}` would be more stable, though the visual impact is minimal.

### Build / Test Status
- Tests: PASS -- 45/45 tests pass (26 Phase 1 pipeline + 15 Phase 2 UI + 2 tokens + 2 git-service)
- Lint: not run (no lint script configured in studio package.json)

### Acceptance Criteria
- [x] When a subagent runs, its tool calls appear in real-time within the subagent's tool_use block -- `tool_execution_update` handled in orchestrator, forwarded through IPC pipeline, `updateToolSubItems` replaces subItems on matching toolCallId block
- [x] Tool calls show as indented `→ toolName` lines (matching GSD CLI style) -- `ToolCallActivity` renders `→ name` with arg summary via `formatSubItemArgs`
- [x] The display is bounded (max ~8 recent items visible, with "... N earlier" indicator) -- `MAX_SUB_ITEMS = 8`, `slice(-MAX_SUB_ITEMS)`, "... N earlier" indicator
- [x] When the subagent completes, the activity collapses to a summary -- `finalizeToolCall` clears `subItems`, done state shows "N tool calls" summary via `subItemCount`
- [x] Concurrent same-name tools are tracked independently via `toolCallId` -- all add/finalize/update operations match by `b.toolCallId === toolCallId`, not tool name FIFO
- [x] No regressions to existing tool call, text streaming, or thinking block behavior -- all 45 tests pass; non-subagent tools render unchanged (gated on `tc.subItems?.length`)
- [x] Works in Electron IPC path -- `onToolUpdate` wired through preload, index.ts, pane-manager, ChatPane subscription
- [ ] Works in PWA WebSocket path -- N/A: PWA web-bridge infrastructure was removed in upstream refactor before this build; no server.ts or web-bridge.ts exists in current studio directory. Not a build defect.
- [x] Long-running subagents (>5 min) no longer get killed by the safety timeout as long as events are still flowing -- `resetSafetyTimer()` called on every event; timeout message updated to "5 min idle"
- [x] subItems are ephemeral (not persisted to session JSONL); reopened sessions show completed tools without sub-item history -- subItems exist only in zustand store state; `finalizeToolCall` clears them; `loadHistory` creates plain text blocks with no subItems
- [x] Abort/crash during subagent: in-flight subItems freeze for debugging, tool block marked as errored -- `markAllToolsErrored` called on `onError`; sets `done: true, isError: true` on all in-flight tool blocks; subItems are not cleared (frozen as-is)

---

## Verification

Date: 2026-03-28
Verified by: User
Summary: 6 passed, 0 failed, 0 skipped

- ✓ Scenario 1: Subagent activity renders — PASS
- ✓ Scenario 2: Activity collapses on completion — PASS
- ✓ Scenario 3: Non-subagent tools unaffected — PASS
- ✓ Scenario 4: Concurrent same-name tools (parallel subagents) — PASS
- ✓ Scenario 5: Abort mid-subagent — PASS (fixed: "0" render bug from subItemCount=0 in JSX && expression)
- ✓ Scenario 6: Rolling timeout — PASS (verified with 10s timeout; turn stays alive while events flow)

### Post-verification fixes
- `subItemCount` set to 0 on early empty updates → changed to only update when `toolCallCount > 0`
- `showSummary = tc.done && tc.subItemCount && ...` → `tc.subItemCount = 0` rendered as literal "0" in JSX; fixed to `(tc.subItemCount ?? 0) > 0`
- Text colour too grey → bumped `text-text-tertiary` → `text-text-secondary` throughout `ToolCallActivity`

---

## Documentation

Date: 2026-03-28
Updated by: Scribe

Files updated:
- **ARCHITECTURE.md** — Added "Subagent Tool Call Visibility (Electron)" data flow section describing the end-to-end pipeline from runtime event through Electron UI
- **apps/studio/ARCHITECTURE.md** — Added "Subagent Tool Call Visibility Flow" diagram and characteristics explaining the data flow and key design decisions
- **apps/studio/README.md** — Added "Subagent visibility" to Key Features list
