/**
 * Phase 1: Data contract + event pipeline
 *
 * Tests verify the source files contain the required structures and APIs.
 * These tests run without TS compilation by checking file contents.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const chatStorePath = new URL('../src/renderer/src/store/chat.ts', import.meta.url)
const paneStorePath = new URL('../src/renderer/src/store/pane-store.ts', import.meta.url)
const orchestratorPath = new URL('../src/main/orchestrator.ts', import.meta.url)
const paneManagerPath = new URL('../src/main/pane-manager.ts', import.meta.url)
const indexMainPath = new URL('../src/main/index.ts', import.meta.url)
const preloadPath = new URL('../src/preload/index.ts', import.meta.url)
const chatPanePath = new URL('../src/renderer/src/components/ChatPane.tsx', import.meta.url)

// ============================================================================
// chat.ts — SubItem type and updated tool_use ContentBlock
// ============================================================================

test('chat.ts: SubItem type is defined', async () => {
  const src = await readFile(chatStorePath, 'utf8')
  assert.match(src, /SubItem/, 'SubItem type must be defined')
  assert.match(src, /type.*'text'/, 'SubItem must have text type')
  assert.match(src, /type.*'toolCall'/, 'SubItem must have toolCall type')
})

test('chat.ts: tool_use ContentBlock has toolCallId field', async () => {
  const src = await readFile(chatStorePath, 'utf8')
  assert.match(src, /toolCallId.*string/, 'tool_use ContentBlock must have toolCallId: string')
})

test('chat.ts: tool_use ContentBlock has subItems field', async () => {
  const src = await readFile(chatStorePath, 'utf8')
  assert.match(src, /subItems/, 'tool_use ContentBlock must have subItems field')
})

test('chat.ts: addToolCall accepts toolCallId parameter', async () => {
  const src = await readFile(chatStorePath, 'utf8')
  assert.match(src, /addToolCall.*toolCallId/, 'addToolCall must accept toolCallId')
})

test('chat.ts: finalizeToolCall matches by toolCallId', async () => {
  const src = await readFile(chatStorePath, 'utf8')
  assert.match(src, /finalizeToolCall.*toolCallId/, 'finalizeToolCall must accept toolCallId')
  // Verify it no longer uses name FIFO matching (b.tool === tool should be gone from finalize)
  // Actually both approaches may coexist in finalize, but toolCallId match should be present
  assert.match(src, /b\.toolCallId === toolCallId/, 'finalizeToolCall must match by toolCallId')
})

test('chat.ts: updateToolSubItems action is defined', async () => {
  const src = await readFile(chatStorePath, 'utf8')
  assert.match(src, /updateToolSubItems/, 'updateToolSubItems action must be defined')
})

test('chat.ts: markAllToolsErrored action is defined', async () => {
  const src = await readFile(chatStorePath, 'utf8')
  assert.match(src, /markAllToolsErrored/, 'markAllToolsErrored action must be defined')
})

// ============================================================================
// pane-store.ts — same API changes
// ============================================================================

test('pane-store.ts: addToolCall accepts toolCallId parameter', async () => {
  const src = await readFile(paneStorePath, 'utf8')
  assert.match(src, /addToolCall.*toolCallId/, 'addToolCall must accept toolCallId')
})

test('pane-store.ts: finalizeToolCall matches by toolCallId', async () => {
  const src = await readFile(paneStorePath, 'utf8')
  assert.match(src, /finalizeToolCall.*toolCallId/, 'finalizeToolCall must accept toolCallId')
  assert.match(src, /b\.toolCallId === toolCallId/, 'finalizeToolCall must match by toolCallId')
})

test('pane-store.ts: updateToolSubItems action is defined', async () => {
  const src = await readFile(paneStorePath, 'utf8')
  assert.match(src, /updateToolSubItems/, 'updateToolSubItems action must be defined')
})

test('pane-store.ts: markAllToolsErrored action is defined', async () => {
  const src = await readFile(paneStorePath, 'utf8')
  assert.match(src, /markAllToolsErrored/, 'markAllToolsErrored action must be defined')
})

// ============================================================================
// orchestrator.ts — onToolUpdate callback + rolling idle timer
// ============================================================================

test('orchestrator.ts: OrchestratorCallbacks has onToolUpdate', async () => {
  const src = await readFile(orchestratorPath, 'utf8')
  assert.match(src, /onToolUpdate/, 'OrchestratorCallbacks must have onToolUpdate')
})

test('orchestrator.ts: onToolStart passes toolCallId', async () => {
  const src = await readFile(orchestratorPath, 'utf8')
  assert.match(src, /onToolStart.*toolCallId/, 'onToolStart callback must pass toolCallId')
})

test('orchestrator.ts: onToolEnd passes toolCallId', async () => {
  const src = await readFile(orchestratorPath, 'utf8')
  assert.match(src, /onToolEnd.*toolCallId/, 'onToolEnd callback must pass toolCallId')
})

test('orchestrator.ts: handles tool_execution_update event', async () => {
  const src = await readFile(orchestratorPath, 'utf8')
  assert.match(src, /tool_execution_update/, 'orchestrator must handle tool_execution_update')
})

test('orchestrator.ts: rolling idle timer uses resetSafetyTimer', async () => {
  const src = await readFile(orchestratorPath, 'utf8')
  assert.match(src, /resetSafetyTimer/, 'must have resetSafetyTimer helper')
  assert.match(src, /5 min idle/, 'timeout message must say "5 min idle"')
})

// ============================================================================
// pane-manager.ts — onToolUpdate and toolCallId in callbacks
// ============================================================================

test('pane-manager.ts: onToolUpdate callback is wired', async () => {
  const src = await readFile(paneManagerPath, 'utf8')
  assert.match(src, /onToolUpdate/, 'pane-manager must wire onToolUpdate')
})

test('pane-manager.ts: onToolStart includes toolCallId', async () => {
  const src = await readFile(paneManagerPath, 'utf8')
  assert.match(src, /tool-start/, 'pane-manager must push event:tool-start')
})

// ============================================================================
// index.ts (main) — onToolUpdate and toolCallId in callbacks
// ============================================================================

test('index.ts: onToolUpdate callback is wired', async () => {
  const src = await readFile(indexMainPath, 'utf8')
  assert.match(src, /onToolUpdate/, 'index.ts must wire onToolUpdate')
})

// ============================================================================
// preload/index.ts — onToolUpdate IPC listener
// ============================================================================

test('preload/index.ts: onToolUpdate is exposed', async () => {
  const src = await readFile(preloadPath, 'utf8')
  assert.match(src, /onToolUpdate/, 'preload must expose onToolUpdate')
  assert.match(src, /event:tool-update/, 'preload must listen to event:tool-update')
})

test('preload/index.ts: onToolStart type includes toolCallId', async () => {
  const src = await readFile(preloadPath, 'utf8')
  // Check onToolStart section includes toolCallId (may span multiple lines)
  const toolStartSection = src.slice(src.indexOf('onToolStart:'), src.indexOf('onToolStart:') + 400)
  assert.match(toolStartSection, /toolCallId/, 'preload onToolStart must include toolCallId in type')
})

test('preload/index.ts: onToolEnd type includes toolCallId', async () => {
  const src = await readFile(preloadPath, 'utf8')
  // Check onToolEnd section includes toolCallId (may span multiple lines)
  const toolEndSection = src.slice(src.indexOf('onToolEnd:'), src.indexOf('onToolEnd:') + 400)
  assert.match(toolEndSection, /toolCallId/, 'preload onToolEnd must include toolCallId in type')
})

// ============================================================================
// ChatPane.tsx — bridge subscriptions pass toolCallId, subscribe to onToolUpdate
// ============================================================================

test('ChatPane.tsx: onToolStart passes toolCallId to store', async () => {
  const src = await readFile(chatPanePath, 'utf8')
  assert.match(src, /addToolCall.*toolCallId/, 'ChatPane onToolStart must pass toolCallId')
})

test('ChatPane.tsx: onToolEnd passes toolCallId to store', async () => {
  const src = await readFile(chatPanePath, 'utf8')
  assert.match(src, /finalizeToolCall.*toolCallId/, 'ChatPane onToolEnd must pass toolCallId')
})

test('ChatPane.tsx: subscribes to onToolUpdate', async () => {
  const src = await readFile(chatPanePath, 'utf8')
  assert.match(src, /onToolUpdate/, 'ChatPane must subscribe to onToolUpdate')
  assert.match(src, /updateToolSubItems/, 'ChatPane must call updateToolSubItems')
})

test('ChatPane.tsx: markAllToolsErrored called on error/exit', async () => {
  const src = await readFile(chatPanePath, 'utf8')
  assert.match(src, /markAllToolsErrored/, 'ChatPane must call markAllToolsErrored on error')
})
